import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FAVORITES_FILE = path.resolve(__dirname, "favorites.json")
const PLAYLISTS_FILE = path.resolve(__dirname, "playlists.json")

class VexonTGBot {
    constructor(botToken, allowedChatId) {
        this.bot = new Telegraf(botToken)
        this.allowedChatId = allowedChatId ? String(allowedChatId).trim() : null
        this.userPlaylists = {}
        this.userFavorites = this.loadFavorites()
        this.setupHandlers()
    }

    loadFavorites() {
        if (fs.existsSync(FAVORITES_FILE)) {
            try {
                return JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"))
            } catch (e) {
                console.error("Error loading favorites:", e)
                return {}
            }
        }
        return {}
    }

    saveFavorites() {
        fs.writeFileSync(FAVORITES_FILE, JSON.stringify(this.userFavorites, null, 2), "utf8")
    }

    encodeUrlKey(url) {
        return Buffer.from(url).toString("base64").replace(/=/g, "")
    }

    decodeUrlKey(key) {
        const padded = key + "===".slice((key.length + 3) % 4)
        return Buffer.from(padded, "base64").toString("ascii")
    }

    parseM3U(url, text) {
        const channels = []
        const categoriesSet = new Set()
        let currentChannel = {}

        const lines = (text || "").split("\n")

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()

            if (line.indexOf("#EXTINF") === 0) {
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
            } else if (line && !line.startsWith("#")) {
                currentChannel.url = line
                if (currentChannel.name && currentChannel.url) {
                    channels.push(currentChannel)
                }
            }
        }

        return {
            channels,
            categories: Array.from(categoriesSet).sort(),
        }
    }

    setupHandlers() {
        this.bot.telegram
            .setMyCommands([
                { command: "start", description: "Start the bot & show welcome message" },
                { command: "load", description: "Load an M3U playlist (/load <url>)" },
                { command: "favorites", description: "View & manage your favorite channels" },
                { command: "status", description: "Check bot and playlist status" },
                { command: "help", description: "Show available commands & guide" },
                { command: "clear", description: "Clear stored playlist & favorites" },
            ])
            .catch((err) => {
                console.warn("Could not register bot commands menu:", err.message)
            })

        if (this.allowedChatId) {
            const allowed = this.allowedChatId.toLowerCase().replace(/^@/, "")
            this.bot.use(async (ctx, next) => {
                const username =
                    ctx.from && ctx.from.username
                        ? String(ctx.from.username).toLowerCase().replace(/^@/, "")
                        : ""
                if (username && username === allowed) {
                    return next()
                }
                if (ctx.callbackQuery) {
                    return ctx.answerCbQuery("Unauthorized", { show_alert: true })
                }
                return ctx.reply("Access denied: Unauthorized username.")
            })
        }

        this.bot.start((ctx) => {
            const userName = ctx.from.first_name || "friend"
            ctx.reply(
                `👋 Welcome ${userName}!\n\n` +
                    `I can help you manage your IPTV playlists from VexonTV.\n\n` +
                    `Use /load <m3u_url> to load a playlist\n` +
                    `Use /favorites to view your saved channels\n` +
                    `Use /help for more options`,
            )
        })

        this.bot.command("help", (ctx) => {
            ctx.reply(
                `📖 *VexonTV Telegram Bot Commands*\n\n` +
                    `/load <url> - Load an M3U playlist\n` +
                    `/favorites - View your favorite channels\n` +
                    `/status - Check bot status\n` +
                    `/clear - Clear all data\n\n` +
                    `Use inline buttons below messages to navigate and manage channels.`,
                { parse_mode: "Markdown" },
            )
        })

        this.bot.command("status", (ctx) => {
            const chatId = ctx.chat.id.toString()
            const hasPlaylist = !!this.userPlaylists[chatId]
            const favCount = (this.userFavorites[chatId] || []).length
            ctx.reply(
                `📊 *Bot Status*\n\n` +
                    `Playlist loaded: ${hasPlaylist ? "✅ Yes" : "❌ No"}\n` +
                    `Favorite channels: ${favCount}\n` +
                    `Bot uptime: Running`,
                { parse_mode: "Markdown" },
            )
        })

        this.bot.command("load", async (ctx) => {
            const text = ctx.message.text
            const url = text.split(" ").slice(1).join(" ").trim()

            if (!url) {
                return ctx.reply(
                    "📥 *Please reply to this message with your M3U playlist URL*:\n\n" +
                        "Example:\n`https://iptv-org.github.io/iptv/index.m3u`",
                    {
                        parse_mode: "Markdown",
                        reply_markup: {
                            force_reply: true,
                            input_field_placeholder: "Paste M3U playlist URL here...",
                        },
                    },
                )
            }

            const chatId = ctx.chat.id
            await ctx.reply("⏳ Downloading and parsing M3U playlist, please wait...")

            try {
                const response = await axios.get(url, {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    timeout: 30000,
                })

                const playlistData = this.parseM3U(url, response.data)
                this.userPlaylists[chatId] = playlistData

                const categories = [...new Set(playlistData.channels.map((ch) => ch.category))]

                ctx.reply(
                    `✅ Playlist loaded successfully!\n` +
                        `📁 Found ${categories.length} categories and ${playlistData.channels.length} channels.\n\n` +
                        `Choose an option below:`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback("📂 Browse Categories", "show_categories")],
                        [Markup.button.callback("⭐ View Favorites", "show_favorites")],
                    ]),
                )
            } catch (err) {
                console.error("Error loading playlist:", err)
                ctx.reply(
                    `❌ Failed to fetch or parse the M3U file.\n\nError: ${err.message}\n\nPlease check the URL and try again.`,
                )
            }
        })

        this.bot.action(/^show_categories(?:_(\d+))?$/, async (ctx) => {
            const chatId = ctx.chat.id
            const data = this.userPlaylists[chatId]

            if (!data) {
                return ctx.editMessageText(
                    "Session expired or no playlist loaded. Please use /load <url> first.",
                )
            }

            const page = ctx.match[1] ? parseInt(ctx.match[1], 10) : 0
            const PAGE_SIZE = 12
            const categories = [...new Set(data.channels.map((ch) => ch.category))]
            const totalPages = Math.ceil(categories.length / PAGE_SIZE)
            const safePage = Math.min(Math.max(0, page), Math.max(0, totalPages - 1))

            const startIdx = safePage * PAGE_SIZE
            const pageCategories = categories.slice(startIdx, startIdx + PAGE_SIZE)

            const rows = []
            for (let i = 0; i < pageCategories.length; i += 2) {
                const row = [
                    Markup.button.callback(
                        pageCategories[i],
                        `cat_${Buffer.from(pageCategories[i]).toString("base64")}_${safePage}`,
                    ),
                ]
                if (pageCategories[i + 1]) {
                    row.push(
                        Markup.button.callback(
                            pageCategories[i + 1],
                            `cat_${Buffer.from(pageCategories[i + 1]).toString("base64")}_${safePage}`,
                        ),
                    )
                }
                rows.push(row)
            }

            if (totalPages > 1) {
                const navRow = []
                if (safePage > 0) {
                    navRow.push(
                        Markup.button.callback("⬅️ Previous", `show_categories_${safePage - 1}`),
                    )
                }
                navRow.push(
                    Markup.button.callback(
                        `${safePage + 1}/${totalPages}`,
                        `show_categories_${safePage}`,
                    ),
                )
                if (safePage < totalPages - 1) {
                    navRow.push(
                        Markup.button.callback("Next ➡️", `show_categories_${safePage + 1}`),
                    )
                }
                rows.push(navRow)
            }

            rows.push([Markup.button.callback("View Favorites", "show_favorites")])

            await ctx.editMessageText(`*Select a Category* (${safePage + 1}/${totalPages}):`, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(rows),
            })
        })

        this.bot.action(/^cat_(.+)_(.+?)(?:_(\d+))?$/, async (ctx) => {
            const chatId = ctx.chat.id
            const selectedCategoryB64 = ctx.match[1]
            const catReturnPage = parseInt(ctx.match[2], 10) || 0
            const chPage = ctx.match[3] ? parseInt(ctx.match[3], 10) : 0
            const selectedCategory = Buffer.from(selectedCategoryB64, "base64").toString("utf8")
            const data = this.userPlaylists[chatId]

            if (!data) {
                return ctx.editMessageText("Session expired. Please use /load <url> again.")
            }

            const filteredChannels = data.channels.filter((c) => c.category === selectedCategory)
            const CH_PAGE_SIZE = 12
            const totalChPages = Math.ceil(filteredChannels.length / CH_PAGE_SIZE)
            const safeChPage = Math.min(Math.max(0, chPage), Math.max(0, totalChPages - 1))
            const startIdx = safeChPage * CH_PAGE_SIZE
            const pageChannels = filteredChannels.slice(startIdx, startIdx + CH_PAGE_SIZE)

            const channelButtons = pageChannels.map((ch, idx) => {
                const globalIdx = startIdx + idx
                return Markup.button.callback(
                    ch.name,
                    `ch_${selectedCategoryB64}_${globalIdx}_${catReturnPage}_${safeChPage}`,
                )
            })

            const rows = channelButtons.map((btn) => [btn])

            if (totalChPages > 1) {
                const navRow = []
                if (safeChPage > 0) {
                    navRow.push(
                        Markup.button.callback(
                            "⬅️ Previous",
                            `cat_${selectedCategoryB64}_${catReturnPage}_${safeChPage - 1}`,
                        ),
                    )
                }
                navRow.push(
                    Markup.button.callback(
                        `${safeChPage + 1}/${totalChPages}`,
                        `cat_${selectedCategoryB64}_${catReturnPage}_${safeChPage}`,
                    ),
                )
                if (safeChPage < totalChPages - 1) {
                    navRow.push(
                        Markup.button.callback(
                            "Next ➡️",
                            `cat_${selectedCategoryB64}_${catReturnPage}_${safeChPage + 1}`,
                        ),
                    )
                }
                rows.push(navRow)
            }

            rows.push([
                Markup.button.callback("⬅️ Back to Categories", `show_categories_${catReturnPage}`),
            ])

            await ctx.editMessageText(
                `Channels in *${selectedCategory}* (${safeChPage + 1}/${totalChPages}, total ${filteredChannels.length}):`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(rows),
                },
            )
        })

        this.bot.action(/^ch_(.+)_(.+)_(.+)_(.+)$/, async (ctx) => {
            const chatId = ctx.chat.id.toString()
            const selectedCategoryB64 = ctx.match[1]
            const selectedCategory = Buffer.from(selectedCategoryB64, "base64").toString("utf8")
            const index = parseInt(ctx.match[2], 10)
            const catReturnPage = parseInt(ctx.match[3], 10) || 0
            const chReturnPage = parseInt(ctx.match[4], 10) || 0
            const data = this.userPlaylists[ctx.chat.id]

            if (!data) {
                return ctx.editMessageText("Session expired. Please use /load <url> again.")
            }

            const filteredChannels = data.channels.filter((c) => c.category === selectedCategory)
            const channel = filteredChannels[index]

            if (!channel) {
                return ctx.answerCbQuery("Channel not found.")
            }

            if (!this.userFavorites[chatId]) {
                this.userFavorites[chatId] = []
            }

            const userFavs = this.userFavorites[chatId]
            const isFav = userFavs.some((f) => f.url === channel.url)

            const favButtonText = isFav ? "Remove from Favorites" : "Add to Favorites"
            const urlKey = this.encodeUrlKey(channel.url)
            const favAction = isFav ? `fav_rem_${urlKey}` : `fav_add_${urlKey}`

            await ctx.editMessageText(
                `*${channel.name}*\n` +
                    `Category: ${selectedCategory}\n` +
                    `Stream URL: \`${channel.url}\``,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("Test Stream", `test_${urlKey}`)],
                        [Markup.button.callback(favButtonText, favAction)],
                        [
                            Markup.button.callback(
                                "⬅️ Back to Channels",
                                `cat_${selectedCategoryB64}_${catReturnPage}_${chReturnPage}`,
                            ),
                        ],
                        [
                            Markup.button.callback(
                                "Back to Categories",
                                `show_categories_${catReturnPage}`,
                            ),
                        ],
                    ]),
                },
            )
        })

        this.bot.action(/^test_(.+)$/, async (ctx) => {
            const urlKey = ctx.match[1]
            let channelUrl
            try {
                channelUrl = this.decodeUrlKey(urlKey)
            } catch (e) {
                return ctx.answerCbQuery("Invalid stream link.")
            }

            await ctx.answerCbQuery("🧪 Testing stream connection...")

            try {
                const response = await axios.get(channelUrl, {
                    timeout: 5000,
                    headers: { "User-Agent": "VLC/3.0.16" },
                    maxRedirects: 3,
                })

                if (response.status >= 200 && response.status < 400) {
                    await ctx.reply(
                        `🟢 *Stream Online!*\nConnection successful for:\n\`${channelUrl}\``,
                        { parse_mode: "Markdown" },
                    )
                } else {
                    await ctx.reply(`🔴 *Stream Returned Status:* ${response.status}`)
                }
            } catch (err) {
                if (err.code === "ECONNABORTED") {
                    await ctx.reply(`⚠️ *Stream Timeout:* The server took too long to respond.`)
                } else {
                    await ctx.reply(`🔴 *Stream Offline / Unreachable:* ${err.message}`)
                }
            }
        })

        this.bot.action(/^fav_add_(.+)$/, async (ctx) => {
            const chatId = ctx.chat.id.toString()
            const urlKey = ctx.match[1]
            let channelUrl
            try {
                channelUrl = this.decodeUrlKey(urlKey)
            } catch (e) {
                return ctx.answerCbQuery("Invalid channel data.")
            }

            let channel = null
            const data = this.userPlaylists[ctx.chat.id]
            if (data) {
                channel = data.channels.find((c) => c.url === channelUrl)
            }

            if (!this.userFavorites[chatId]) {
                this.userFavorites[chatId] = []
            }

            if (!channel) {
                const existing = this.userFavorites[chatId].find((f) => f.url === channelUrl)
                if (existing) channel = existing
            }

            if (!channel) {
                return ctx.answerCbQuery("Channel info not found. Please reload playlist.")
            }

            if (!this.userFavorites[chatId].some((f) => f.url === channel.url)) {
                this.userFavorites[chatId].push({
                    url: channel.url,
                    name: channel.name,
                    group: channel.group,
                    category: channel.category,
                    logo: channel.logo,
                })
                this.saveFavorites()
                await ctx.answerCbQuery("⭐ Added to favorites!")
            } else {
                await ctx.answerCbQuery("Already in favorites!")
            }

            await ctx.editMessageReplyMarkup(
                Markup.inlineKeyboard([
                    [Markup.button.callback("🧪 Test Stream", `test_${urlKey}`)],
                    [Markup.button.callback("❌ Remove from Favorites", `fav_rem_${urlKey}`)],
                    [Markup.button.callback("📂 Main Categories", "show_categories")],
                ]).reply_markup,
            )
        })

        this.bot.action(/^fav_rem_(.+)$/, async (ctx) => {
            const chatId = ctx.chat.id.toString()
            const urlKey = ctx.match[1]
            let channelUrl
            try {
                channelUrl = this.decodeUrlKey(urlKey)
            } catch (e) {
                return ctx.answerCbQuery("Invalid channel data.")
            }

            if (!this.userFavorites[chatId]) {
                this.userFavorites[chatId] = []
            }

            this.userFavorites[chatId] = this.userFavorites[chatId].filter(
                (f) => f.url !== channelUrl,
            )
            this.saveFavorites()
            await ctx.answerCbQuery("🗑️ Removed from favorites!")

            const userFavs = this.userFavorites[chatId] || []
            if (userFavs.length === 0) {
                return ctx.editMessageText(
                    "⭐ You have no favorite channels saved yet.",
                    Markup.inlineKeyboard([
                        [Markup.button.callback("📂 Browse Categories", "show_categories")],
                    ]),
                )
            }

            const buttons = userFavs.map((fav, index) =>
                Markup.button.callback(`⭐ ${fav.name}`, `fav_view_${index}`),
            )
            const rows = buttons.map((btn) => [btn])
            rows.push([Markup.button.callback("📂 Browse Categories", "show_categories")])

            await ctx.editMessageText(`⭐ *Your Favorite Channels (${userFavs.length}):*`, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(rows),
            })
        })

        const showFavoritesHandler = async (ctx) => {
            const chatId = ctx.chat.id.toString()
            if (!this.userFavorites[chatId]) {
                this.userFavorites[chatId] = []
            }
            const userFavs = this.userFavorites[chatId]

            if (userFavs.length === 0) {
                const content = "⭐ You have no favorite channels saved yet."
                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("📂 Browse Categories", "show_categories")],
                ])

                if (ctx.callbackQuery) {
                    return ctx.editMessageText(content, keyboard)
                }
                return ctx.reply(content, keyboard)
            }

            const buttons = userFavs.map((fav, index) =>
                Markup.button.callback(`⭐ ${fav.name}`, `fav_view_${index}`),
            )

            const rows = buttons.map((btn) => [btn])
            rows.push([Markup.button.callback("📂 Browse Categories", "show_categories")])

            const content = `⭐ *Your Favorite Channels (${userFavs.length}):*`
            const keyboard = Markup.inlineKeyboard(rows)

            if (ctx.callbackQuery) {
                return ctx.editMessageText(content, { parse_mode: "Markdown", ...keyboard })
            }
            ctx.reply(content, { parse_mode: "Markdown", ...keyboard })
        }

        this.bot.command("favorites", showFavoritesHandler)
        this.bot.action("show_favorites", showFavoritesHandler)

        this.bot.action(/^fav_view_(\d+)$/, async (ctx) => {
            const chatId = ctx.chat.id.toString()
            const index = parseInt(ctx.match[1], 10)
            if (!this.userFavorites[chatId]) {
                this.userFavorites[chatId] = []
            }
            const userFavs = this.userFavorites[chatId]
            const channel = userFavs[index]

            if (!channel) {
                return ctx.answerCbQuery("Channel not found in favorites.")
            }

            const urlKey = this.encodeUrlKey(channel.url)

            await ctx.editMessageText(
                `⭐ *[Favorite] ${channel.name}*\n` +
                    `📁 Category: ${channel.category}\n` +
                    `🔗 Stream URL: \`${channel.url}\``,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🧪 Test Stream", `test_${urlKey}`)],
                        [Markup.button.callback("❌ Remove from Favorites", `fav_rem_${urlKey}`)],
                        [Markup.button.callback("⭐ Back to Favorites", "show_favorites")],
                    ]),
                },
            )
        })

        this.bot.command("clear", (ctx) => {
            const chatId = ctx.chat.id.toString()
            delete this.userFavorites[chatId]
            delete this.userPlaylists[chatId]
            this.saveFavorites()
            ctx.reply("🗑️ All your data has been cleared.")
        })
    }

    launch() {
        return this.bot.launch()
    }

    stop() {
        return this.bot.stop()
    }
}

// Main execution if run directly: node server/telegram-bot.js
const isDirectRun =
    process.argv[1] &&
    (process.argv[1].endsWith("telegram-bot.js") || process.argv[1].endsWith("telegram-bot"))

if (isDirectRun) {
    const botToken = process.env.BOT_TOKEN
    if (!botToken || botToken === "your_actual_bot_token_from_botfather_here") {
        console.error("❌ BOT_TOKEN environment variable is not set or invalid in .env")
        console.error("Please set a valid BOT_TOKEN in your .env file to run standalone bot")
        process.exit(1)
    }

    const vexonBot = new VexonTGBot(botToken)
    vexonBot
        .launch()
        .then(() => console.log("🤖 VexonTV Telegram Bot server is running!"))
        .catch((err) => {
            console.error("Failed to start bot:", err)
            process.exit(1)
        })

    process.once("SIGINT", () => {
        vexonBot.stop("SIGINT").then(() => process.exit(0))
    })
    process.once("SIGTERM", () => {
        vexonBot.stop("SIGTERM").then(() => process.exit(0))
    })
}

export default VexonTGBot
