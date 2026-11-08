var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.telegramService = (function () {
    const TELEGRAM_API = "https://api.telegram.org"
    const activeBots = {}
    const userPlaylists = {}
    const userSearch = {}

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
            // If playlist is too large for localStorage quota, keep in memory only
            console.warn("Could not save playlist to localStorage (may exceed quota):", e.message)
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

            function done(result) {
                if (settled) return
                settled = true
                clearTimeout(timer)
                if (successTimer) clearTimeout(successTimer)
                if (video) {
                    try {
                        video.pause()
                        video.removeAttribute("src")
                        video.load()
                    } catch {}
                    if (video.parentNode) video.parentNode.removeChild(video)
                }
                resolve(result)
            }

            const timer = setTimeout(() => {
                done({ ok: false, error: "The channel took too long to answer" })
            }, timeout)

            const video = document.createElement("video")
            video.preload = "auto"
            video.muted = true
            video.playsInline = true
            video.style.display = "none"
            document.body.appendChild(video)

            function onActivePlayback() {
                if (settled || successTimer) return
                // Require playing stream for 2.5s without error before declaring OK
                successTimer = setTimeout(() => {
                    done({ ok: true })
                }, 2500)
            }

            video.addEventListener("playing", onActivePlayback)
            video.addEventListener("timeupdate", () => {
                if (video.currentTime > 0) onActivePlayback()
            })

            video.addEventListener(
                "error",
                () => {
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
                },
                { once: true },
            )

            try {
                video.src = url
                const playPromise = video.play()
                if (playPromise && playPromise.catch) {
                    playPromise.catch((err) => {
                        if (err && err.name === "AbortError") return
                        done({
                            ok: false,
                            error: err ? err.message : "Could not play the channel",
                        })
                    })
                }
            } catch (err) {
                done({ ok: false, error: err.message || "Could not play the channel" })
            }
        })
    }

    async function callTg(token, method, data) {
        const url = `${TELEGRAM_API}/bot${token}/${method}`
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        })
        const json = await res.json()
        if (!json.ok) {
            throw new Error(json.description || "Telegram API call failed")
        }
        return json.result
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

    async function handleMessage(botEntry, msg) {
        if (!msg || !msg.text) return
        const token = botEntry.token
        const chatId = msg.chat.id
        const userTgName = msg.from && msg.from.username
        const text = msg.text.trim()
        const userName = msg.from.first_name || "friend"

        if (!isAllowed(botEntry, userTgName)) {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: "Access denied: Unauthorized username.",
            }).catch(() => {})
            return
        }

        if (text === "/start") {
            const welcomeText =
                `Welcome ${userName}!\n\n` +
                `I can help you manage your IPTV playlists in VexonTV.\n\n` +
                `Send me your M3U playlist link using the format:\n` +
                `/load <url.m3u>\n\n` +
                `Or view your saved favorites with /favorites`
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text: welcomeText,
            })
            return
        }

        if (text === "/help") {
            await callTg(token, "sendMessage", {
                chat_id: chatId,
                text:
                    `*VexonTV Telegram Bot Commands*\n\n` +
                    `/load <url> - Load an M3U playlist\n` +
                    `/favorites - View your favorite channels\n` +
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
                    `App connection: Connected to VexonTV`,
                parse_mode: "Markdown",
            })
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
                            [{ text: "🔍 Search Again", callback_data: "search_channel" }],
                            [{ text: "📂 Browse Categories", callback_data: "show_categories" }],
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
                text: "⏳ Downloading and parsing M3U playlist, please wait...",
            })

            try {
                const res = await fetch(url)
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
                }
                const content = await res.text()
                const playlistData = parseM3U(content)

                if (!playlistData.channels.length) {
                    await callTg(token, "sendMessage", {
                        chat_id: chatId,
                        text: "⚠️ No valid channels found in that playlist.",
                    })
                    return
                }

                savePlaylist(chatId, playlistData)

                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text:
                        `✅ Playlist loaded successfully!\n` +
                        `📁 Found ${playlistData.categories.length} categories and ${playlistData.channels.length} channels.\n\n` +
                        `Choose an option below:`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "📂 Browse Categories", callback_data: "show_categories" }],
                            [{ text: "🔍 Search for Channel", callback_data: "search_channel" }],
                            [{ text: "⭐ View Favorites", callback_data: "show_favorites" }],
                        ],
                    },
                })
            } catch (err) {
                console.error("Error loading M3U in bot:", err)
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `❌ Failed to fetch playlist: ${err.message}`,
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
                    [{ text: "🔍 Search Again", callback_data: "search_channel" }],
                    [{ text: "📂 Browse Categories", callback_data: "show_categories" }],
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
            return [
                {
                    text: ch.name,
                    callback_data: `srchch_${globalChIdx}_${safePage}`,
                },
            ]
        })

        if (totalPages > 1) {
            const navRow = []
            if (safePage > 0) {
                navRow.push({
                    text: "⬅️ Previous",
                    callback_data: `srchpage_${safePage - 1}`,
                })
            }
            navRow.push({
                text: `${safePage + 1}/${totalPages}`,
                callback_data: `srchpage_${safePage}`,
            })
            if (safePage < totalPages - 1) {
                navRow.push({
                    text: "Next ➡️",
                    callback_data: `srchpage_${safePage + 1}`,
                })
            }
            rows.push(navRow)
        }

        rows.push([
            { text: "🔍 Search Again", callback_data: "search_channel" },
            { text: "📂 Browse Categories", callback_data: "show_categories" },
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

    async function showFavoritesView(token, chatId, messageId) {
        const favs = App.store.state.favorites || []
        if (favs.length === 0) {
            const text = "⭐ You have no favorite channels saved yet in VexonTV."
            const keyboard = {
                inline_keyboard: [
                    [{ text: "📂 Browse Categories", callback_data: "show_categories" }],
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

        const buttons = favs.slice(0, 30).map((f, index) => {
            return [{ text: `⭐ ${f.name}`, callback_data: `favview_${index}` }]
        })
        buttons.push([{ text: "📂 Browse Categories", callback_data: "show_categories" }])

        const text = `⭐ *Your Favorite Channels (${favs.length}):*`
        const markup = { inline_keyboard: buttons }

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
            if (data.startsWith("catspage_")) {
                page = parseInt(data.replace("catspage_", ""), 10) || 0
            }

            const total = pl.categories.length
            const totalPages = Math.ceil(total / PAGE_SIZE)
            if (page >= totalPages) page = Math.max(0, totalPages - 1)

            const startIdx = page * PAGE_SIZE
            const pageCategories = pl.categories.slice(startIdx, startIdx + PAGE_SIZE)

            const rows = []
            for (let i = 0; i < pageCategories.length; i += 2) {
                const globalIdx1 = startIdx + i
                const row = [
                    {
                        text: pageCategories[i],
                        callback_data: `cat_${globalIdx1}_${page}`,
                    },
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
                if (page > 0) {
                    navRow.push({ text: "⬅️ Previous", callback_data: `catspage_${page - 1}` })
                }
                navRow.push({
                    text: `${page + 1}/${totalPages}`,
                    callback_data: `catspage_${page}`,
                })
                if (page < totalPages - 1) {
                    navRow.push({ text: "Next ➡️", callback_data: `catspage_${page + 1}` })
                }
                rows.push(navRow)
            }

            rows.push([
                { text: "🔍 Search", callback_data: "search_channel" },
                { text: "⭐ View Favorites", callback_data: "show_favorites" },
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
                text:
                    `*${channel.name}*\n` +
                    `Category: ${channel.category || channel.group || "General"}\n` +
                    `Stream URL: \`${channel.url}\``,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `srchtest_${chIndex}` }],
                        [{ text: favText, callback_data: favAction }],
                        [{ text: "⬅️ Back to list", callback_data: `srchpage_${srchPage}` }],
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
                        [{ text: "⬅️ Back to list", callback_data: `srchpage_${srchPage}` }],
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
                        [{ text: "⬅️ Back to list", callback_data: `srchpage_${srchPage}` }],
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
            await answer("Testing channel in player...")

            const probe = await probeStream(channel.url, 8000)
            if (probe.ok) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Stream Status: OK\n\`${channel.url}\``,
                })
            } else {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Stream Status: Failed\n${probe.error}\n\`${channel.url}\``,
                })
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
                if (safeChPage > 0) {
                    navRow.push({
                        text: "⬅️ Previous",
                        callback_data: `cat_${catIndex}_${catReturnPage}_${safeChPage - 1}`,
                    })
                }
                navRow.push({
                    text: `${safeChPage + 1}/${totalChPages}`,
                    callback_data: `cat_${catIndex}_${catReturnPage}_${safeChPage}`,
                })
                if (safeChPage < totalChPages - 1) {
                    navRow.push({
                        text: "Next ➡️",
                        callback_data: `cat_${catIndex}_${catReturnPage}_${safeChPage + 1}`,
                    })
                }
                rows.push(navRow)
            }

            rows.push([
                { text: "⬅️ Back to Categories", callback_data: `catspage_${catReturnPage}` },
            ])

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
                text:
                    `*${channel.name}*\n` +
                    `Category: ${channel.category || channel.group || "General"}\n` +
                    `Stream URL: \`${channel.url}\``,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `test_${catIndex}_${chIndex}` }],
                        [{ text: favText, callback_data: favAction }],
                        [
                            {
                                text: "⬅️ Back to Channels",
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
            await answer("Testing channel in player...")

            const probe = await probeStream(channel.url, 8000)
            if (probe.ok) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Stream Status: OK\n\`${channel.url}\``,
                })
            } else {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Stream Status: Failed\n${probe.error}\n\`${channel.url}\``,
                })
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
                                text: "⬅️ Back to Channels",
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
                                text: "⬅️ Back to Channels",
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

        if (data.startsWith("favview_")) {
            const favIndex = parseInt(data.replace("favview_", ""), 10)
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
                text:
                    `⭐ *[Favorite] ${channel.name}*\n` +
                    `📁 Category: ${channel.category || channel.group || "General"}\n` +
                    `🔗 Stream URL: \`${channel.url}\``,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Test Stream", callback_data: `favtest_${favIndex}` }],
                        [{ text: "Remove from Favorites", callback_data: `favdel_${favIndex}` }],
                        [{ text: "Back to Favorites", callback_data: "show_favorites" }],
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
            await answer("Testing channel in player...")

            const probe = await probeStream(channel.url, 8000)
            if (probe.ok) {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Stream Status: OK\n\`${channel.url}\``,
                })
            } else {
                await callTg(token, "sendMessage", {
                    chat_id: chatId,
                    text: `Stream Status: Failed\n${probe.error}\n\`${channel.url}\``,
                })
            }
            return
        }

        if (data.startsWith("favdel_")) {
            const favIndex = parseInt(data.replace("favdel_", ""), 10)
            const favs = App.store.state.favorites || []
            const channel = favs[favIndex]
            if (channel) {
                App.store.toggleFavorite(channel, channel.listId || listId)
                App.store.notify(`Telegram removed: ${channel.name}`)
                await answer("🗑️ Removed from favorites!")
            } else {
                await answer("Channel not found.")
            }
            await showFavoritesView(token, chatId, messageId)
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
                // Network glitch or timeout — retry after brief pause
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
            const botEntry = {
                token,
                listId,
                chatId: safeChatId,
                botInfo: me,
                running: true,
            }
            activeBots[token] = botEntry
            registerCommands(token)
            pollUpdates(botEntry)
            return {
                success: true,
                message: `Bot @${me.username || me.first_name} started!`,
                bot: me,
            }
        } catch (err) {
            return {
                success: false,
                message: err.message || "Failed to connect to Telegram bot",
            }
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

    return {
        init,
        startBot,
        stopBot,
        validateToken,
        getBotUsername,
    }
})()
