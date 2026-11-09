var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.telegramService = (function () {
    const TELEGRAM_API = "https://api.telegram.org"

    // Cloudflare Worker proxies (tg-proxy/worker.js). They fetch Telegram files
    // server-side and add the CORS header the TV browser needs.
    // Tried in order: the first is the main account, the next are fallbacks
    // used only if the previous one fails.
    const PROXY_URLS = [
        "https://vexontv-tg-proxy.widely-yelp-mural.workers.dev",
        "https://vexontv-tg-proxy.probable-dock-kept.workers.dev",
    ]

    // Telegram file IDs are long URL-safe strings, e.g. "BQACAgIAAxkBAAIB...".
    const FILE_ID_RE = /^[A-Za-z0-9_-]{20,}$/
    const SRC_PAGE_SIZE = 12
    const MAX_NAME_LENGTH = 60
    // Limits so one slow request cannot freeze the update loop for ever.
    const TG_TIMEOUT_MS = 30000
    const FILE_TIMEOUT_MS = 60000

    const activeBots = {}
    const userPlaylists = {}
    const userSearch = {}
    const testingInProgress = {}
    // chatIds that sent /import and are waiting for a file or a file ID
    const pendingImport = {}
    // chatIds in the /addsrc flow:
    // { step: "source" | "name", promptId, draft, count }
    // promptId is the message the user must reply to.
    const pendingAddSrc = {}

    function proxyReady() {
        return PROXY_URLS.length > 0
    }

    function getPlaylist(chatId) {
        if (userPlaylists[chatId]) return userPlaylists[chatId]
        try {
            const raw = localStorage.getItem(`ts.tg.pl.${chatId}`)
            if (raw) {
                userPlaylists[chatId] = JSON.parse(raw)
                return userPlaylists[chatId]
            }
        } catch (e) {
            console.error("Error reading saved TG playlist:", e)
        }
        return null
    }

    function savePlaylist(chatId, data) {
        userPlaylists[chatId] = data
        try {
            localStorage.setItem(`ts.tg.pl.${chatId}`, JSON.stringify(data))
        } catch (e) {
            console.warn("Could not save playlist to localStorage:", e.message)
        }
    }

    function isAllowed(botEntry, username) {
        if (!botEntry || !botEntry.chatId) return true
        const allowed = String(botEntry.chatId).trim().toLowerCase().replace(/^@/, "")
        const uName = username ? String(username).trim().toLowerCase().replace(/^@/, "") : ""
        return uName.length > 0 && uName === allowed
    }

    function probeStream(url, timeoutMs) {
        return new Promise((resolve) => {
            const timeout = timeoutMs || 10000
            let settled = false
            let successTimer = null
            let timer = null

            const video = document.createElement("video")
            video.preload = "auto"
            video.muted = true
            video.playsInline = true
            video.style.display = "none"

            function cleanup() {
                if (timer) clearTimeout(timer)
                if (successTimer) clearTimeout(successTimer)
                video.removeEventListener("playing", onPlaying)
                video.removeEventListener("timeupdate", onTimeUpdate)
                video.removeEventListener("error", onError)
                try {
                    video.pause()
                    video.removeAttribute("src")
                    video.load()
                } catch {}
                if (video.parentNode) video.parentNode.removeChild(video)
            }

            function done(result) {
                if (settled) return
                settled = true
                cleanup()
                resolve(result)
            }

            timer = setTimeout(() => {
                done({ ok: false, error: "The channel took too long to answer" })
            }, timeout)

            function onPlaying() {
                if (settled || successTimer) return
                successTimer = setTimeout(() => {
                    done({ ok: true })
                }, 2000)
            }

            function onTimeUpdate() {
                if (video.currentTime > 0) onPlaying()
            }

            function onError() {
                const err = video.error
                let msg = "Could not play the channel"
                if (err) {
                    if (err.code === 1) msg = "Playback aborted"
                    else if (err.code === 2) msg = "Network error while loading stream"
                    else if (err.code === 3) msg = "Media decoding error"
                    else if (err.code === 4)
                        msg = "Failed to load because no supported source was found"
                }
                done({ ok: false, error: msg })
            }

            video.addEventListener("playing", onPlaying)
            video.addEventListener("timeupdate", onTimeUpdate)
            video.addEventListener("error", onError, { once: true })

            document.body.appendChild(video)

            try {
                video.src = url
                const playPromise = video.play()
                if (playPromise && playPromise.catch) {
                    playPromise.catch((err) => {
                        if (settled) return
                        if (err && err.name === "AbortError") return
                        done({ ok: false, error: err ? err.message : "Could not play the channel" })
                    })
                }
            } catch (err) {
                done({ ok: false, error: err.message || "Could not play the channel" })
            }
        })
    }

    // Every Telegram API call has a time limit, so a stuck request reports an
    // error instead of blocking the update loop.
    async function callTg(token, method, data) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS)
        try {
            const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
                signal: controller.signal,
            })
            const json = await res.json()
            if (!json.ok) throw new Error(json.description || "Telegram API call failed")
            return json.result
        } catch (err) {
            if (err.name === "AbortError") throw new Error("Telegram did not answer in time")
            throw err
        } finally {
            clearTimeout(timer)
        }
    }

    // Upload a file with multipart/form-data. Uploads work from the browser;
    // only downloads from api.telegram.org/file/ are blocked by CORS.
    async function callTgSendDocument(token, chatId, content, filename, caption) {
        const url = `${TELEGRAM_API}/bot${token}/sendDocument`
        const blob = new Blob([content], { type: "application/octet-stream" })
        const form = new FormData()
        form.append("chat_id", String(chatId))
        form.append("document", blob, filename)
        if (caption) form.append("caption", caption)
        const res = await fetch(url, { method: "POST", body: form })
        const json = await res.json()
        if (!json.ok) throw new Error(json.description || "sendDocument failed")
        return json.result
    }

    // Read one proxy URL with a time limit.
    async function fetchText(url) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS)
        try {
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) throw new Error(`Proxy returned HTTP ${res.status}`)
            return await res.text()
        } catch (err) {
            if (err.name === "AbortError") throw new Error("The file server did not answer in time")
            throw err
        } finally {
            clearTimeout(timer)
        }
    }

    // Download a Telegram file through the proxies, in order. The first one
    // that answers wins; a failure moves on to the next.
    async function downloadTgFile(token, fileId) {
        if (!proxyReady()) throw new Error("The file proxy is not configured in the app.")

        const info = await callTg(token, "getFile", { file_id: fileId })
        const filePath = info && info.file_path
        if (!filePath) throw new Error("Telegram did not return a file path for that file ID")

        let lastError = null
        for (const base of PROXY_URLS) {
            try {
                return await fetchText(
                    `${base}/?token=${encodeURIComponent(token)}&path=${encodeURIComponent(filePath)}`,
                )
            } catch (err) {
                lastError = err
                console.warn("File proxy failed, trying the next one:", base, err.message)
            }
        }
        throw lastError || new Error("All file proxies failed")
    }

    async function validateToken(token) {
        return callTg(token, "getMe", {})
    }

    function parseM3U(text) {
        const lines = (text || "").split("\n")
        const channels = []
        const categoriesMap = {}
        let currentChannel = null

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line) continue

            if (line.startsWith("#EXTINF")) {
                currentChannel = {}
                const logoMatch = line.match(/tvg-logo="([^"]*)"/i)
                const groupMatch = line.match(/group-title="([^"]*)"/i)
                currentChannel.logo = logoMatch ? logoMatch[1] : ""
                const groupTitle = groupMatch ? groupMatch[1].trim() : ""
                currentChannel.group = groupTitle.length > 0 ? groupTitle : "General"
                currentChannel.category = currentChannel.group
                const commaIndex = line.lastIndexOf(",")
                currentChannel.name =
                    commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : "Unknown Channel"
            } else if (!line.startsWith("#") && currentChannel) {
                currentChannel.url = line
                if (currentChannel.name && currentChannel.url) {
                    channels.push(currentChannel)
                    if (!categoriesMap[currentChannel.category]) {
                        categoriesMap[currentChannel.category] = []
                    }
                    categoriesMap[currentChannel.category].push(currentChannel)
                }
                currentChannel = null
            }
        }

        return {
            channels,
            categories: Object.keys(categoriesMap).sort(),
            byCategory: categoriesMap,
        }
    }

    // /export: one message. The backup file goes out with a caption, and Telegram
    // only returns the file ID after the upload, so the same message's caption is
    // edited to add the copyable ID.
    async function handleExport(token, chatId) {
        const favs = App.store.state.favorites || []
        if (favs.length === 0) {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: "You have no favorite channels to export yet.",
            })
            return
        }

        const backup = {
            version: 1,
            exported: new Date().toISOString(),
            favorites: favs.map((f) => ({
                listId: f.listId || "",
                url: f.url || "",
                name: f.name || "",
                group: f.group || "",
                logo: f.logo || "",
            })),
        }

        const json = JSON.stringify(backup, null, 2)
        const filename = `favorites_${new Date().toISOString().slice(0, 10)}.bak`
        const summary = `Exported ${favs.length} favorite channel${favs.length === 1 ? "" : "s"}`

        const sent = await callTgSendDocument(token, chatId, json, filename, summary)

        const fileId = sent && sent.document && sent.document.file_id
        if (!fileId) return

        // Same message, caption updated with the copyable ID. A failure here leaves
        // the file and its summary in place, so it is not treated as an export error.
        await callTg(token, "editMessageCaption", {
            chat_id: chatId,
            message_id: sent.message_id,
            caption:
                `${summary}\n\n` +
                `File ID (tap to copy):\n` +
                `\`${fileId}\`\n\n` +
                `Send /import and paste it, no need to upload the file again.`,
            parse_mode: "Markdown",
        }).catch((err) => console.warn("Could not add file ID to caption:", err.message))
    }

    // Merge imported favorites, skipping duplicates by listId + url.
    function mergeImportedFavorites(incoming) {
        const existing = App.store.state.favorites || []
        const seen = new Set(existing.map((f) => `${f.listId || ""}::${f.url || ""}`))

        let added = 0
        let skipped = 0

        incoming.forEach((fav) => {
            if (!fav.url) {
                skipped++
                return
            }
            const key = `${fav.listId || ""}::${fav.url}`
            if (seen.has(key)) {
                skipped++
                return
            }
            seen.add(key)
            App.store.state.favorites = App.store.state.favorites.concat([
                {
                    listId: fav.listId || "",
                    url: fav.url,
                    name: fav.name || "Unknown",
                    group: fav.group || "Imported",
                    logo: fav.logo || "",
                },
            ])
            added++
        })

        try {
            localStorage.setItem("ts.favorites", JSON.stringify(App.store.state.favorites))
        } catch {}

        return { added, skipped }
    }

    // One import path for both a file and a pasted file ID.
    async function importBackup(token, chatId, fileId) {
        if (!proxyReady()) {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: "Import is not available: the file proxy is not configured in the app.",
            })
            return
        }

        // Temporary progress message. It is deleted once the import finishes,
        // so the chat only keeps the result.
        const progress = await callTg(token, "sendMessage", {
            chat_id: chatId,
            text: "Downloading and importing your backup...",
        }).catch(() => null)

        const clearProgress = () => {
            if (!progress || !progress.message_id) return Promise.resolve()
            return callTg(token, "deleteMessage", {
                chat_id: chatId,
                message_id: progress.message_id,
            }).catch(() => {})
        }

        try {
            const raw = await downloadTgFile(token, fileId)
            let backup
            try {
                backup = JSON.parse(raw)
            } catch {
                throw new Error("The file is not valid JSON.")
            }
            if (!backup || !Array.isArray(backup.favorites)) {
                throw new Error("The file does not look like a VexonTV favorites backup.")
            }

            const { added, skipped } = mergeImportedFavorites(backup.favorites)
            if (App.ui && App.ui.render) App.ui.render()

            await clearProgress()
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text:
                    `Import complete!\n\n` +
                    `• Added: ${added} channel${added === 1 ? "" : "s"}\n` +
                    `• Skipped (duplicates): ${skipped}`,
            })
        } catch (err) {
            await clearProgress()
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: `Import failed: ${err.message}`,
            })
        }
    }

    // ── /addsrc ──────────────────────────────────────────────────────────────

    // Sends the question for the current step with force-reply, and remembers
    // the message the user has to reply to.
    async function askForInput(token, chatId, pending) {
        const isSource = pending.step === "source"
        const text = isSource
            ? "Add a source\n\n" +
              "Reply to this message with an M3U link (http or https), or send an .m3u file as a reply to this message.\n\n" +
              "Send /cancel to stop."
            : "Reply to this message with the name to save this source as.\n\n" +
              "Send /cancel to stop."
        const sent = await callTg(token, "sendMessage", {
            chat_id: chatId,
            text,
            reply_markup: {
                force_reply: true,
                input_field_placeholder: isSource
                    ? "M3U link or .m3u file"
                    : "Name for this source",
            },
        })
        pending.promptId = sent.message_id
    }

    async function handleAddSrcInput(botEntry, msg, text) {
        const token = botEntry.token
        const chatId = msg.chat.id
        const pending = pendingAddSrc[chatId]

        // Every answer must be a reply to the bot's latest prompt.
        const isReplyToPrompt =
            !!msg.reply_to_message && msg.reply_to_message.message_id === pending.promptId
        if (!isReplyToPrompt) {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text:
                    "Please press Reply on my last message and send your answer there.\n\n" +
                    "Send /cancel to stop.",
            })
            return
        }

        // One status message for this attempt. The first status sends it, and every
        // later status edits it, so the chat does not fill up with progress lines.
        let statusId = null
        const showStatus = async (line) => {
            if (statusId === null) {
                const sent = await callTg(token, "sendMessage", { chat_id: chatId, text: line })
                statusId = sent.message_id
                return
            }
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: statusId,
                text: line,
            }).catch(() => {})
        }

        // Shows the problem in the status message, then asks again with a fresh reply prompt.
        const reject = async (reason) => {
            await showStatus(`Error: ${reason}`)
            if (pendingAddSrc[chatId]) await askForInput(token, chatId, pending)
        }

        try {
            if (pending.step === "source") {
                let draft = null

                if (msg.document) {
                    const fileName = msg.document.file_name || ""
                    if (!/\.(m3u8?|txt)$/i.test(fileName)) {
                        return reject("Please send an .m3u or .m3u8 file, or an http(s) M3U link.")
                    }
                    if (!proxyReady()) {
                        delete pendingAddSrc[chatId]
                        await callTg(token, "sendMessage", {
                            chat_id: chatId,
                            text: "Adding files is not available: the file proxy is not configured in the app.",
                        })
                        return
                    }
                    await showStatus("Reading the file...")
                    const body = await downloadTgFile(token, msg.document.file_id)
                    const built = App.store.buildSource("file", { text: body, fileName })
                    if (built.error) return reject(built.error)
                    draft = built.list
                } else if (/^https?:\/\//i.test(text)) {
                    const built = App.store.buildSource("url", { url: text })
                    if (built.error) return reject(built.error)
                    draft = built.list
                } else {
                    return reject("Send an http(s) M3U link or an .m3u file.")
                }

                await showStatus("Checking the playlist...")
                let channels = null
                try {
                    channels = await App.api.load(draft)
                } catch (err) {
                    return reject(`That playlist could not be loaded: ${err.message}`)
                }
                const count = channels ? channels.length : 0
                if (!count) return reject("The playlist has no channels.")

                // The status message is done; the next question is a new message with force-reply.
                await showStatus(`Valid playlist with ${count} channel${count === 1 ? "" : "s"}.`)
                pending.step = "name"
                pending.draft = draft
                pending.count = count
                await askForInput(token, chatId, pending)
                return
            }

            // Name step
            if (msg.document || !text || text.startsWith("/")) {
                return reject("Send the name as plain text.")
            }
            const draft = pending.draft
            draft.name = text.slice(0, MAX_NAME_LENGTH)

            await showStatus("Adding the source...")
            // store.addList loads the channels, saves the source and refreshes the TV
            await App.store.addList(draft)
            delete pendingAddSrc[chatId]
            await showStatus(
                `Source added: ${draft.name} (${pending.count} channel${pending.count === 1 ? "" : "s"})`,
            )
        } catch (err) {
            console.error("addsrc error:", err)
            await reject(`Something went wrong: ${err.message}`)
        }
    }

    // ── /removesrc ───────────────────────────────────────────────────────────

    // Telegram-type sources are not offered: removing one would stop the bot itself.
    function removableSources() {
        return (App.store.state.lists || []).filter(
            (list) => App.store.listKind(list) !== "telegram",
        )
    }

    function sourceAddressOf(list) {
        if (list.source === "text") return "Pasted playlist text (no address)"
        return list.url || list.origin || "No address"
    }

    async function sendRemovePage(token, chatId, messageId, page) {
        const sources = removableSources()
        if (!sources.length) {
            const text = "There are no sources to remove."
            if (messageId) {
                await callTg(token, "editMessageText", {
                    chat_id: chatId,
                    message_id: messageId,
                    text,
                })
            } else {
                await callTg(token, "sendMessage", { chat_id: chatId, text })
            }
            return
        }

        const totalPages = Math.ceil(sources.length / SRC_PAGE_SIZE)
        const safePage = Math.min(Math.max(0, page || 0), totalPages - 1)
        const startIdx = safePage * SRC_PAGE_SIZE
        const pageSources = sources.slice(startIdx, startIdx + SRC_PAGE_SIZE)

        const rows = pageSources.map((list) => [
            { text: list.name || "Unnamed", callback_data: `rmsrc_pick_${list.id}` },
        ])

        if (totalPages > 1) {
            const navRow = []
            if (safePage > 0)
                navRow.push({ text: "Previous", callback_data: `rmsrc_page_${safePage - 1}` })
            navRow.push({
                text: `${safePage + 1}/${totalPages}`,
                callback_data: `rmsrc_page_${safePage}`,
            })
            if (safePage < totalPages - 1)
                navRow.push({ text: "Next", callback_data: `rmsrc_page_${safePage + 1}` })
            rows.push(navRow)
        }

        const text = `Remove a source (page ${safePage + 1}/${totalPages}):`
        const markup = { inline_keyboard: rows }

        if (messageId) {
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text,
                reply_markup: markup,
            })
        } else {
            await callTg(token, "sendMessage", { chat_id: chatId, text, reply_markup: markup })
        }
    }

    async function handleRemoveCallback(token, chatId, messageId, data, answer) {
        if (data.startsWith("rmsrc_page_")) {
            await answer()
            const page = parseInt(data.replace("rmsrc_page_", ""), 10) || 0
            await sendRemovePage(token, chatId, messageId, page)
            return
        }

        if (data.startsWith("rmsrc_pick_")) {
            const id = data.replace("rmsrc_pick_", "")
            const list = App.store.listById(id)
            if (!list || App.store.listKind(list) === "telegram") {
                await answer("Source not found.")
                return
            }
            await answer()
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text:
                    `Delete this source?\n\n` +
                    `Name: ${list.name}\n` +
                    `URL: ${sourceAddressOf(list)}\n\n` +
                    `This cannot be undone.`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Yes, delete", callback_data: `rmsrc_yes_${id}` }],
                        [{ text: "Cancel", callback_data: "rmsrc_page_0" }],
                    ],
                },
            })
            return
        }

        if (data.startsWith("rmsrc_yes_")) {
            const id = data.replace("rmsrc_yes_", "")
            const list = App.store.listById(id)
            if (!list) {
                await answer("Source not found.")
                return
            }
            const name = list.name
            App.store.removeList(id)
            await answer("Deleted")
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: `🗑 Removed: ${name}`,
                reply_markup: {
                    inline_keyboard: [[{ text: "Back to sources", callback_data: "rmsrc_page_0" }]],
                },
            })
        }
    }

    // ── Messages ─────────────────────────────────────────────────────────────

    function isImportPrompt(msg) {
        return !!(
            msg.reply_to_message &&
            msg.reply_to_message.text &&
            msg.reply_to_message.text.includes("Restore Favorites")
        )
    }

    async function handleMessage(botEntry, msg) {
        if (!msg) return
        const token = botEntry.token
        const chatId = msg.chat.id
        const userTgName = msg.from && msg.from.username
        const rawText = msg.text || msg.caption || ""
        const text = rawText.trim()
        const userName = msg.from && msg.from.first_name ? msg.from.first_name : "friend"

        if (!isAllowed(botEntry, userTgName)) {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: "Access denied: Unauthorized username.",
            }).catch(() => {})
            return
        }

        // ── /cancel stops any flow in progress ──────────────────────────────
        if (text === "/cancel") {
            const had = !!pendingAddSrc[chatId] || !!pendingImport[chatId]
            delete pendingAddSrc[chatId]
            delete pendingImport[chatId]
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: had ? "Cancelled." : "Nothing to cancel.",
            })
            return
        }

        // ── /addsrc flow: link or file, then name. Each answer is a reply. ──
        if (pendingAddSrc[chatId]) {
            await handleAddSrcInput(botEntry, msg, text)
            return
        }

        const awaitingImport = !!pendingImport[chatId] || isImportPrompt(msg)

        // ── A file sent while an import is pending ──────────────────────────
        if (msg.document && awaitingImport) {
            delete pendingImport[chatId]
            const name = (msg.document.file_name || "").toLowerCase()
            if (!name.endsWith(".bak") && !name.endsWith(".json")) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: "Please send a .bak or .json file exported by VexonTV.",
                })
                return
            }
            await importBackup(token, chatId, msg.document.file_id)
            return
        }

        // ── A file ID pasted while an import is pending ─────────────────────
        if (text && awaitingImport && !text.startsWith("/") && FILE_ID_RE.test(text)) {
            delete pendingImport[chatId]
            await importBackup(token, chatId, text)
            return
        }

        if (text === "/start") {
            const welcomeText =
                `Welcome ${userName}!\n\n` +
                `I can help you manage your IPTV playlists in VexonTV.\n\n` +
                `Send me your M3U playlist link using the format:\n` +
                `/load <url.m3u>\n\n` +
                `Or view your saved favorites with /favorites\n\n` +
                `Backup commands:\n` +
                `/export — Send your favorites as a .bak file and a file ID\n` +
                `/import — Restore favorites from a file or a file ID\n\n` +
                `Source commands:\n` +
                `/addsrc — Add an M3U link or file as a source\n` +
                `/removesrc — Remove a source\n` +
                `/cancel — Stop the current step`
            await callTg(token, "sendMessage", { chat_id: chatId, text: welcomeText })
            return
        }

        if (text === "/help") {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text:
                    `*VexonTV Telegram Bot Commands*\n\n` +
                    `/load <url> - Load an M3U playlist\n` +
                    `/favorites - View your favorite channels\n` +
                    `/export - Send favorites as a .bak file with a copyable file ID\n` +
                    `/import - Restore favorites from a .bak file or a file ID\n` +
                    `/addsrc - Add an M3U link or file as a source\n` +
                    `/removesrc - Remove a source\n` +
                    `/cancel - Stop the current step\n` +
                    `/status - Check bot status\n\n` +
                    `Channels added to favorites will appear immediately on your TV!`,
                parse_mode: "Markdown",
            })
            return
        }

        if (text === "/status") {
            const pl = getPlaylist(chatId)
            const favCount = (App.store.state.favorites || []).length
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text:
                    `*Bot Status*\n\n` +
                    `Playlist loaded: ${pl ? "Yes" : "No"}\n` +
                    `VexonTV Total Favorites: ${favCount}\n` +
                    `File proxy: ${proxyReady() ? `${PROXY_URLS.length} configured` : "Not configured"}\n` +
                    `App connection: Connected to VexonTV`,
                parse_mode: "Markdown",
            })
            return
        }

        if (text === "/export") {
            await handleExport(token, chatId)
            return
        }

        // /import, or /import <fileId> to skip the prompt entirely
        if (text === "/import" || text.startsWith("/import ")) {
            const inlineId = text.slice("/import".length).trim()
            if (inlineId && FILE_ID_RE.test(inlineId)) {
                delete pendingImport[chatId]
                await importBackup(token, chatId, inlineId)
                return
            }
            if (!proxyReady()) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: "Import is not available yet: the file proxy is not configured in the app.",
                })
                return
            }
            pendingImport[chatId] = true
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text:
                    "*Restore Favorites*\n\n" +
                    "Reply to this message with your `.bak` file, or paste the file ID from /export.\n\n" +
                    "_Duplicates will be skipped automatically._",
                parse_mode: "Markdown",
                reply_markup: {
                    force_reply: true,
                    input_field_placeholder: "Send the .bak file or paste the file ID…",
                },
            })
            return
        }

        if (text === "/addsrc") {
            const pending = { step: "source", promptId: null }
            pendingAddSrc[chatId] = pending
            await askForInput(token, chatId, pending)
            return
        }

        if (text === "/removesrc") {
            await sendRemovePage(token, chatId, null, 0)
            return
        }

        const isReplyToPrompt =
            msg.reply_to_message &&
            msg.reply_to_message.text &&
            msg.reply_to_message.text.includes("M3U playlist URL")

        const isReplyToSearch =
            msg.reply_to_message &&
            msg.reply_to_message.text &&
            msg.reply_to_message.text.includes("channel name to search")

        if (isReplyToSearch) {
            const query = text.toLowerCase()
            const pl = getPlaylist(chatId)
            if (!pl) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: "No playlist loaded. Please use /load <url> first.",
                })
                return
            }
            const matches = pl.channels.filter((c) => (c.name || "").toLowerCase().includes(query))
            if (matches.length === 0) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `No channels found matching "${text}".`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Search Again", callback_data: "search_channel" }],
                            [{ text: "Browse Categories", callback_data: "show_categories" }],
                        ],
                    },
                })
                return
            }
            userSearch[chatId] = { query: text, matches }
            await renderSearchResults(token, chatId, null, 0)
            return
        }

        if (text.startsWith("/load") || isReplyToPrompt) {
            let url = ""
            if (isReplyToPrompt && !text.startsWith("/")) {
                url = text
            } else {
                const parts = text.split(" ")
                url = parts.slice(1).join(" ").trim()
            }

            if (!url || !/^https?:\/\//i.test(url)) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text:
                        "*Please reply to this message with your M3U playlist URL*:\n\n" +
                        "Example:\n`https://iptv-org.github.io/iptv/index.m3u`",
                    parse_mode: "Markdown",
                    reply_markup: {
                        force_reply: true,
                        input_field_placeholder: "Paste M3U playlist URL here...",
                    },
                })
                return
            }

            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: "Downloading and parsing M3U playlist, please wait...",
            })

            try {
                const res = await fetch(url)
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
                const content = await res.text()
                const playlistData = parseM3U(content)

                if (!playlistData.channels.length) {
                    await callTg(token, "sendMessage", {
                        chat_id: chatId,
                        text: "No valid channels found in that playlist.",
                    })
                    return
                }

                savePlaylist(chatId, playlistData)

                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text:
                        `Playlist loaded successfully!\n` +
                        `Found ${playlistData.categories.length} categories and ${playlistData.channels.length} channels.\n\n` +
                        `Choose an option below:`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Browse Categories", callback_data: "show_categories" }],
                            [{ text: "Search for Channel", callback_data: "search_channel" }],
                            [{ text: "View Favorites", callback_data: "show_favorites" }],
                        ],
                    },
                })
            } catch (err) {
                console.error("Error loading M3U in bot:", err)
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Failed to fetch playlist: ${err.message}`,
                })
            }
            return
        }

        if (text === "/favorites") {
            await showFavoritesView(token, chatId, null)
            return
        }
    }

    async function renderSearchResults(token, chatId, messageId, page) {
        const entry = userSearch[chatId]
        if (!entry || !entry.matches || !entry.matches.length) {
            const emptyText = "No search results found."
            const emptyKeyboard = {
                inline_keyboard: [
                    [{ text: "Search Again", callback_data: "search_channel" }],
                    [{ text: "Browse Categories", callback_data: "show_categories" }],
                ],
            }
            if (messageId) {
                await callTg(token, "editMessageText", {
                    chat_id: chatId,
                    message_id: messageId,
                    text: emptyText,
                    reply_markup: emptyKeyboard,
                })
            } else {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: emptyText,
                    reply_markup: emptyKeyboard,
                })
            }
            return
        }

        const CH_PAGE_SIZE = 12
        const total = entry.matches.length
        const totalPages = Math.ceil(total / CH_PAGE_SIZE)
        const safePage = Math.min(Math.max(0, page), Math.max(0, totalPages - 1))
        const startIdx = safePage * CH_PAGE_SIZE
        const pageChannels = entry.matches.slice(startIdx, startIdx + CH_PAGE_SIZE)

        const rows = pageChannels.map((ch, idx) => {
            const globalChIdx = startIdx + idx
            return [{ text: ch.name, callback_data: `srchch_${globalChIdx}_${safePage}` }]
        })

        if (totalPages > 1) {
            const navRow = []
            if (safePage > 0)
                navRow.push({ text: "Previous", callback_data: `srchpage_${safePage - 1}` })
            navRow.push({
                text: `${safePage + 1}/${totalPages}`,
                callback_data: `srchpage_${safePage}`,
            })
            if (safePage < totalPages - 1)
                navRow.push({ text: "Next", callback_data: `srchpage_${safePage + 1}` })
            rows.push(navRow)
        }

        rows.push([
            { text: "Search Again", callback_data: "search_channel" },
            { text: "Browse Categories", callback_data: "show_categories" },
        ])

        const text = `Search results for "${entry.query}" (page ${safePage + 1}/${totalPages}, total ${total}):`
        if (messageId) {
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text,
                reply_markup: { inline_keyboard: rows },
            })
        } else {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text,
                reply_markup: { inline_keyboard: rows },
            })
        }
    }

    async function showFavoritesView(token, chatId, messageId, page) {
        const favs = App.store.state.favorites || []
        if (favs.length === 0) {
            const text = "You have no favorite channels saved yet in VexonTV."
            const keyboard = {
                inline_keyboard: [
                    [{ text: "Browse Categories", callback_data: "show_categories" }],
                ],
            }
            if (messageId) {
                await callTg(token, "editMessageText", {
                    chat_id: chatId,
                    message_id: messageId,
                    text,
                    reply_markup: keyboard,
                })
            } else {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text,
                    reply_markup: keyboard,
                })
            }
            return
        }

        const FAV_PAGE_SIZE = 12
        const total = favs.length
        const totalPages = Math.ceil(total / FAV_PAGE_SIZE)
        const safePage = Math.min(Math.max(0, page || 0), Math.max(0, totalPages - 1))
        const startIdx = safePage * FAV_PAGE_SIZE
        const pageFavs = favs.slice(startIdx, startIdx + FAV_PAGE_SIZE)

        const rows = pageFavs.map((f, idx) => {
            const globalIdx = startIdx + idx
            return [{ text: `${f.name}`, callback_data: `favview_${globalIdx}_${safePage}` }]
        })

        if (totalPages > 1) {
            const navRow = []
            if (safePage > 0)
                navRow.push({ text: "Previous", callback_data: `favpage_${safePage - 1}` })
            navRow.push({
                text: `${safePage + 1}/${totalPages}`,
                callback_data: `favpage_${safePage}`,
            })
            if (safePage < totalPages - 1)
                navRow.push({ text: "Next", callback_data: `favpage_${safePage + 1}` })
            rows.push(navRow)
        }

        rows.push([{ text: "Browse Categories", callback_data: "show_categories" }])

        const text = `*Your Favorite Channels* (page ${safePage + 1}/${totalPages}, total ${total}):`
        const markup = { inline_keyboard: rows }

        if (messageId) {
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text,
                parse_mode: "Markdown",
                reply_markup: markup,
            })
        } else {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
                reply_markup: markup,
            })
        }
    }

    async function handleCallback(botEntry, cb) {
        const token = botEntry.token
        const listId = botEntry.listId
        const chatId = cb.message && cb.message.chat ? cb.message.chat.id : null
        const userTgName = cb.from ? cb.from.username : null
        const messageId = cb.message ? cb.message.message_id : null
        const data = cb.data

        if (!isAllowed(botEntry, userTgName)) {
            await callTg(token, "answerCallbackQuery", {
                callback_query_id: cb.id,
                text: "Unauthorized",
                show_alert: true,
            }).catch(() => {})
            return
        }

        const answer = (text) => {
            return callTg(token, "answerCallbackQuery", {
                callback_query_id: cb.id,
                text: text || "",
            }).catch(() => {})
        }

        // /removesrc menu and its confirmation
        if (data.startsWith("rmsrc_")) {
            await handleRemoveCallback(token, chatId, messageId, data, answer)
            return
        }

        const pl = getPlaylist(chatId)

        if (data === "show_categories" || data.startsWith("catspage_")) {
            if (!pl) {
                await answer("No playlist loaded.")
                await callTg(token, "editMessageText", {
                    chat_id: chatId,
                    message_id: messageId,
                    text: "No playlist loaded. Please send /load <url> first.",
                })
                return
            }
            await answer()
            const PAGE_SIZE = 12
            let page = 0
            if (data.startsWith("catspage_"))
                page = parseInt(data.replace("catspage_", ""), 10) || 0

            const total = pl.categories.length
            const totalPages = Math.ceil(total / PAGE_SIZE)
            if (page >= totalPages) page = Math.max(0, totalPages - 1)

            const startIdx = page * PAGE_SIZE
            const pageCategories = pl.categories.slice(startIdx, startIdx + PAGE_SIZE)

            const rows = []
            for (let i = 0; i < pageCategories.length; i += 2) {
                const globalIdx1 = startIdx + i
                const row = [
                    { text: pageCategories[i], callback_data: `cat_${globalIdx1}_${page}` },
                ]
                if (pageCategories[i + 1]) {
                    const globalIdx2 = startIdx + i + 1
                    row.push({
                        text: pageCategories[i + 1],
                        callback_data: `cat_${globalIdx2}_${page}`,
                    })
                }
                rows.push(row)
            }

            if (totalPages > 1) {
                const navRow = []
                if (page > 0)
                    navRow.push({ text: "Previous", callback_data: `catspage_${page - 1}` })
                navRow.push({
                    text: `${page + 1}/${totalPages}`,
                    callback_data: `catspage_${page}`,
                })
                if (page < totalPages - 1)
                    navRow.push({ text: "Next", callback_data: `catspage_${page + 1}` })
                rows.push(navRow)
            }

            rows.push([
                { text: "Search", callback_data: "search_channel" },
                { text: "View Favorites", callback_data: "show_favorites" },
            ])

            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: `*Select a Category* (${page + 1}/${totalPages}):`,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: rows },
            })
            return
        }

        if (data === "search_channel") {
            await answer()
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: "Please reply to this message with the channel name to search:",
                reply_markup: {
                    force_reply: true,
                    input_field_placeholder: "Type channel name...",
                },
            })
            return
        }

        if (data.startsWith("srchpage_")) {
            await answer()
            const page = parseInt(data.replace("srchpage_", ""), 10) || 0
            await renderSearchResults(token, chatId, messageId, page)
            return
        }

        if (data.startsWith("srchch_")) {
            const parts = data.split("_")
            const chIndex = parseInt(parts[1], 10)
            const srchPage = parseInt(parts[2], 10) || 0
            const entry = userSearch[chatId]
            const channel = entry && entry.matches ? entry.matches[chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            await answer()
            const isFav = App.store.isFavorite(listId, channel.url)
            const favText = isFav ? "Remove from Favorites" : "Add to Favorites"
            const favAction = isFav
                ? `srchfavrem_${chIndex}_${srchPage}`
                : `srchfavadd_${chIndex}_${srchPage}`
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: `*${channel.name}*\nCategory: ${channel.category || channel.group || "General"}\nStream URL: \`${channel.url}\``,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `srchtest_${chIndex}` }],
                        [{ text: favText, callback_data: favAction }],
                        [{ text: "Back to list", callback_data: `srchpage_${srchPage}` }],
                    ],
                },
            })
            return
        }

        if (data.startsWith("srchfavadd_")) {
            const parts = data.split("_")
            const chIndex = parseInt(parts[1], 10)
            const srchPage = parseInt(parts[2], 10) || 0
            const entry = userSearch[chatId]
            const channel = entry && entry.matches ? entry.matches[chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (!App.store.isFavorite(listId, channel.url)) {
                App.store.toggleFavorite(channel, listId)
                App.store.notify(`Telegram added: ${channel.name}`)
            }
            await answer("Added to favorites")
            await callTg(token, "editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `srchtest_${chIndex}` }],
                        [
                            {
                                text: "Remove from Favorites",
                                callback_data: `srchfavrem_${chIndex}_${srchPage}`,
                            },
                        ],
                        [{ text: "Back to list", callback_data: `srchpage_${srchPage}` }],
                    ],
                },
            })
            return
        }

        if (data.startsWith("srchfavrem_")) {
            const parts = data.split("_")
            const chIndex = parseInt(parts[1], 10)
            const srchPage = parseInt(parts[2], 10) || 0
            const entry = userSearch[chatId]
            const channel = entry && entry.matches ? entry.matches[chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (App.store.isFavorite(listId, channel.url)) {
                App.store.toggleFavorite(channel, listId)
                App.store.notify(`Telegram removed: ${channel.name}`)
            }
            await answer("Removed from favorites")
            await callTg(token, "editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `srchtest_${chIndex}` }],
                        [
                            {
                                text: "Add to Favorites",
                                callback_data: `srchfavadd_${chIndex}_${srchPage}`,
                            },
                        ],
                        [{ text: "Back to list", callback_data: `srchpage_${srchPage}` }],
                    ],
                },
            })
            return
        }

        if (data.startsWith("srchtest_")) {
            const chIndex = parseInt(data.replace("srchtest_", ""), 10)
            const entry = userSearch[chatId]
            const channel = entry && entry.matches ? entry.matches[chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (testingInProgress[chatId]) {
                await answer("Test already in progress. Please wait.")
                return
            }
            testingInProgress[chatId] = true
            await answer("Testing channel in player...")
            try {
                const probe = await probeStream(channel.url, 10000)
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: probe.ok
                        ? `Stream Status: OK\n\`${channel.url}\``
                        : `Stream Status: Failed\n${probe.error}\n\`${channel.url}\``,
                    parse_mode: "Markdown",
                })
            } finally {
                delete testingInProgress[chatId]
            }
            return
        }

        if (data === "show_favorites") {
            await answer()
            await showFavoritesView(token, chatId, messageId)
            return
        }

        if (data.startsWith("cat_")) {
            if (!pl) {
                await answer("No playlist loaded.")
                return
            }
            const catParts = data.split("_")
            const catIndex = parseInt(catParts[1], 10)
            const catReturnPage = catParts[2] ? parseInt(catParts[2], 10) : 0
            const chPage = catParts[3] ? parseInt(catParts[3], 10) : 0
            const catName = pl.categories[catIndex]
            if (!catName || !pl.byCategory[catName]) {
                await answer("Category not found.")
                return
            }
            await answer()
            const channels = pl.byCategory[catName]
            const CH_PAGE_SIZE = 12
            const totalChPages = Math.ceil(channels.length / CH_PAGE_SIZE)
            const safeChPage = Math.min(Math.max(0, chPage), Math.max(0, totalChPages - 1))
            const startIdx = safeChPage * CH_PAGE_SIZE
            const pageChannels = channels.slice(startIdx, startIdx + CH_PAGE_SIZE)

            const rows = pageChannels.map((ch, idx) => {
                const globalChIdx = startIdx + idx
                return [
                    {
                        text: ch.name,
                        callback_data: `ch_${catIndex}_${globalChIdx}_${catReturnPage}_${safeChPage}`,
                    },
                ]
            })

            if (totalChPages > 1) {
                const navRow = []
                if (safeChPage > 0)
                    navRow.push({
                        text: "Previous",
                        callback_data: `cat_${catIndex}_${catReturnPage}_${safeChPage - 1}`,
                    })
                navRow.push({
                    text: `${safeChPage + 1}/${totalChPages}`,
                    callback_data: `cat_${catIndex}_${catReturnPage}_${safeChPage}`,
                })
                if (safeChPage < totalChPages - 1)
                    navRow.push({
                        text: "Next",
                        callback_data: `cat_${catIndex}_${catReturnPage}_${safeChPage + 1}`,
                    })
                rows.push(navRow)
            }

            rows.push([{ text: "Back to Categories", callback_data: `catspage_${catReturnPage}` }])

            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: `Channels in *${catName}* (${safeChPage + 1}/${totalChPages}, total ${channels.length}):`,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: rows },
            })
            return
        }

        if (data.startsWith("ch_")) {
            if (!pl) {
                await answer("Playlist not loaded. Please use /load <url>")
                return
            }
            const parts = data.split("_")
            const catIndex = parseInt(parts[1], 10)
            const chIndex = parseInt(parts[2], 10)
            const catReturnPage = parts[3] ? parseInt(parts[3], 10) : 0
            const chReturnPage = parts[4] ? parseInt(parts[4], 10) : 0
            const catName = pl.categories[catIndex]
            const channels = catName ? pl.byCategory[catName] : null
            const channel = channels ? channels[chIndex] : null
            if (!channel) {
                await answer("Channel not found. Please reopen category.")
                return
            }
            await answer()
            const isFav = App.store.isFavorite(listId, channel.url)
            const favText = isFav ? "Remove from Favorites" : "Add to Favorites"
            const favAction = isFav
                ? `favrem_${catIndex}_${chIndex}_${catReturnPage}_${chReturnPage}`
                : `favadd_${catIndex}_${chIndex}_${catReturnPage}_${chReturnPage}`
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: `*${channel.name}*\nCategory: ${channel.category || channel.group || "General"}\nStream URL: \`${channel.url}\``,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `test_${catIndex}_${chIndex}` }],
                        [{ text: favText, callback_data: favAction }],
                        [
                            {
                                text: "Back to Channels",
                                callback_data: `cat_${catIndex}_${catReturnPage}_${chReturnPage}`,
                            },
                        ],
                        [
                            {
                                text: "Back to Categories",
                                callback_data: `catspage_${catReturnPage}`,
                            },
                        ],
                    ],
                },
            })
            return
        }

        if (data.startsWith("test_")) {
            if (!pl) {
                await answer("Playlist not loaded.")
                return
            }
            const parts = data.split("_")
            const catIndex = parseInt(parts[1], 10)
            const chIndex = parseInt(parts[2], 10)
            const catName = pl.categories[catIndex]
            const channel =
                catName && pl.byCategory[catName] ? pl.byCategory[catName][chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (testingInProgress[chatId]) {
                await answer("Test already in progress. Please wait.")
                return
            }
            testingInProgress[chatId] = true
            await answer("Testing channel in player...")
            try {
                const probe = await probeStream(channel.url, 10000)
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: probe.ok
                        ? `Stream Status: OK\n\`${channel.url}\``
                        : `Stream Status: Failed\n${probe.error}\n\`${channel.url}\``,
                    parse_mode: "Markdown",
                })
            } finally {
                delete testingInProgress[chatId]
            }
            return
        }

        if (data.startsWith("favadd_")) {
            if (!pl) {
                await answer("Playlist not loaded.")
                return
            }
            const parts = data.split("_")
            const catIndex = parseInt(parts[1], 10)
            const chIndex = parseInt(parts[2], 10)
            const catReturnPage = parts[3] ? parseInt(parts[3], 10) : 0
            const chReturnPage = parts[4] ? parseInt(parts[4], 10) : 0
            const catName = pl.categories[catIndex]
            const channel =
                catName && pl.byCategory[catName] ? pl.byCategory[catName][chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (!App.store.isFavorite(listId, channel.url)) {
                App.store.toggleFavorite(channel, listId)
                App.store.notify(`Telegram added: ${channel.name}`)
            }
            await answer("Added to favorites")
            await callTg(token, "editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `test_${catIndex}_${chIndex}` }],
                        [
                            {
                                text: "Remove from Favorites",
                                callback_data: `favrem_${catIndex}_${chIndex}_${catReturnPage}_${chReturnPage}`,
                            },
                        ],
                        [
                            {
                                text: "Back to Channels",
                                callback_data: `cat_${catIndex}_${catReturnPage}_${chReturnPage}`,
                            },
                        ],
                        [
                            {
                                text: "Back to Categories",
                                callback_data: `catspage_${catReturnPage}`,
                            },
                        ],
                    ],
                },
            })
            return
        }

        if (data.startsWith("favrem_")) {
            if (!pl) {
                await answer("Playlist not loaded.")
                return
            }
            const parts = data.split("_")
            const catIndex = parseInt(parts[1], 10)
            const chIndex = parseInt(parts[2], 10)
            const catReturnPage = parts[3] ? parseInt(parts[3], 10) : 0
            const chReturnPage = parts[4] ? parseInt(parts[4], 10) : 0
            const catName = pl.categories[catIndex]
            const channel =
                catName && pl.byCategory[catName] ? pl.byCategory[catName][chIndex] : null
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (App.store.isFavorite(listId, channel.url)) {
                App.store.toggleFavorite(channel, listId)
                App.store.notify(`Telegram removed: ${channel.name}`)
            }
            await answer("Removed from favorites")
            await callTg(token, "editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `test_${catIndex}_${chIndex}` }],
                        [
                            {
                                text: "Add to Favorites",
                                callback_data: `favadd_${catIndex}_${chIndex}_${catReturnPage}_${chReturnPage}`,
                            },
                        ],
                        [
                            {
                                text: "Back to Channels",
                                callback_data: `cat_${catIndex}_${catReturnPage}_${chReturnPage}`,
                            },
                        ],
                        [
                            {
                                text: "Back to Categories",
                                callback_data: `catspage_${catReturnPage}`,
                            },
                        ],
                    ],
                },
            })
            return
        }

        if (data.startsWith("favpage_")) {
            await answer()
            const page = parseInt(data.replace("favpage_", ""), 10) || 0
            await showFavoritesView(token, chatId, messageId, page)
            return
        }

        if (data.startsWith("favview_")) {
            const parts = data.split("_")
            const favIndex = parseInt(parts[1], 10)
            const favReturnPage = parts[2] ? parseInt(parts[2], 10) : 0
            const favs = App.store.state.favorites || []
            const channel = favs[favIndex]
            if (!channel) {
                await answer("Favorite channel not found.")
                return
            }
            await answer()
            await callTg(token, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: `*[Favorite] ${channel.name}*\nCategory: ${channel.category || channel.group || "General"}\nStream URL: \`${channel.url}\``,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `favtest_${favIndex}` }],
                        [
                            {
                                text: "Remove from Favorites",
                                callback_data: `favdel_${favIndex}_${favReturnPage}`,
                            },
                        ],
                        [{ text: "Back to Favorites", callback_data: `favpage_${favReturnPage}` }],
                    ],
                },
            })
            return
        }

        if (data.startsWith("favtest_")) {
            const favIndex = parseInt(data.replace("favtest_", ""), 10)
            const favs = App.store.state.favorites || []
            const channel = favs[favIndex]
            if (!channel) {
                await answer("Channel not found.")
                return
            }
            if (testingInProgress[chatId]) {
                await answer("Test already in progress. Please wait.")
                return
            }
            testingInProgress[chatId] = true
            await answer("Testing channel in player...")
            try {
                const probe = await probeStream(channel.url, 10000)
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: probe.ok
                        ? `Stream Status: OK\n\`${channel.url}\``
                        : `Stream Status: Failed\n${probe.error}\n\`${channel.url}\``,
                    parse_mode: "Markdown",
                })
            } finally {
                delete testingInProgress[chatId]
            }
            return
        }

        if (data.startsWith("favdel_")) {
            const parts = data.split("_")
            const favIndex = parseInt(parts[1], 10)
            const favReturnPage = parts[2] ? parseInt(parts[2], 10) : 0
            const favs = App.store.state.favorites || []
            const channel = favs[favIndex]
            if (channel) {
                App.store.toggleFavorite(channel, channel.listId || listId)
                App.store.notify(`Telegram removed: ${channel.name}`)
                await answer("Removed from favorites")
            } else {
                await answer("Channel not found.")
            }
            await showFavoritesView(token, chatId, messageId, favReturnPage)
            return
        }
    }

    async function pollUpdates(botEntry) {
        let offset = 0
        while (botEntry.running) {
            try {
                const url = `${TELEGRAM_API}/bot${botEntry.token}/getUpdates?offset=${offset}&timeout=20`
                const res = await fetch(url)
                if (!res.ok) {
                    if (res.status === 401) {
                        console.error("Telegram bot token invalid/unauthorized.")
                        botEntry.running = false
                        break
                    }
                    await new Promise((r) => setTimeout(r, 4000))
                    continue
                }
                const data = await res.json()
                if (data.ok && Array.isArray(data.result)) {
                    for (const update of data.result) {
                        offset = update.update_id + 1
                        if (update.message) {
                            await handleMessage(botEntry, update.message).catch((e) =>
                                console.error("Msg err:", e),
                            )
                        } else if (update.callback_query) {
                            await handleCallback(botEntry, update.callback_query).catch((e) =>
                                console.error("Cb err:", e),
                            )
                        }
                    }
                }
            } catch {
                if (!botEntry.running) break
                await new Promise((r) => setTimeout(r, 3000))
            }
        }
    }

    async function registerCommands(token) {
        try {
            await callTg(token, "setMyCommands", {
                commands: [
                    { command: "start", description: "Start the bot & show welcome message" },
                    { command: "load", description: "Load an M3U playlist (/load <url>)" },
                    { command: "favorites", description: "View & manage your favorite channels" },
                    {
                        command: "export",
                        description: "Send favorites as a .bak file with a file ID",
                    },
                    {
                        command: "import",
                        description: "Restore favorites from a file or a file ID",
                    },
                    { command: "addsrc", description: "Add an M3U link or file as a source" },
                    { command: "removesrc", description: "Remove a source" },
                    { command: "cancel", description: "Stop the current step" },
                    { command: "status", description: "Check bot and playlist status" },
                    { command: "help", description: "Show available commands & guide" },
                ],
            })
        } catch (e) {
            console.warn("Could not register bot commands menu:", e.message)
        }
    }

    async function startBot(token, listId, allowedChatId) {
        if (!token) return { success: false, message: "Token is required" }
        const safeChatId =
            allowedChatId !== undefined && allowedChatId !== null
                ? String(allowedChatId).trim()
                : ""
        if (activeBots[token] && activeBots[token].running) {
            activeBots[token].chatId = safeChatId
            activeBots[token].listId = listId
            return { success: true, message: "Bot is already running" }
        }

        try {
            const me = await validateToken(token)
            const botEntry = { token, listId, chatId: safeChatId, botInfo: me, running: true }
            activeBots[token] = botEntry
            registerCommands(token)
            pollUpdates(botEntry)
            return {
                success: true,
                message: `Bot @${me.username || me.first_name} started!`,
                bot: me,
            }
        } catch (err) {
            return { success: false, message: err.message || "Failed to connect to Telegram bot" }
        }
    }

    function stopBot(token) {
        if (activeBots[token]) {
            activeBots[token].running = false
            delete activeBots[token]
            return { success: true }
        }
        return { success: false, message: "Bot not running" }
    }

    function getBotUsername(token) {
        if (activeBots[token] && activeBots[token].botInfo && activeBots[token].botInfo.username) {
            return activeBots[token].botInfo.username
        }
        return null
    }

    function init() {
        const lists = App.store.state.lists || []
        lists.forEach((list) => {
            if (list.kind === "telegram" && list.token) {
                startBot(list.token, list.id, list.chatId).then((res) => {
                    if (res && res.bot && res.bot.username && !list.botUsername) {
                        list.botUsername = res.bot.username
                    }
                })
            }
        })
    }

    return { init, startBot, stopBot, validateToken, getBotUsername }
})()
