import VexonTGBot from "./telegram-bot.js"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ACTIVE_BOTS_FILE = path.resolve(__dirname, "active_bots.json")

class TelegramBotManager {
    constructor() {
        this.activeBots = new Map()
        this.loadActiveBots()
    }

    loadActiveBots() {
        if (fs.existsSync(ACTIVE_BOTS_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(ACTIVE_BOTS_FILE, "utf8"))
                this.activeBots = new Map(Object.entries(data))
            } catch (e) {
                console.error("Error loading active bots:", e)
                this.activeBots = new Map()
            }
        }
    }

    saveActiveBots() {
        const data = Object.fromEntries(this.activeBots)
        fs.writeFileSync(ACTIVE_BOTS_FILE, JSON.stringify(data, null, 2), "utf8")
    }

    /**
     * Start a Telegram bot with the given token
     * @param {string} botToken - Telegram bot token
     * @param {string|number} [allowedChatId] - Telegram chat ID of allowed user
     * @returns {Promise<{success: boolean, message: string, botId?: string}>}
     */
    async startBot(botToken, allowedChatId) {
        try {
            // Validate token format
            if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
                return {
                    success: false,
                    message: "Invalid bot token format",
                }
            }

            // Check if already running
            if (this.activeBots.has(botToken)) {
                return {
                    success: false,
                    message: "Bot with this token is already running",
                }
            }

            // Create and launch bot
            const bot = new VexonTGBot(botToken, allowedChatId)
            await bot.launch()

            // Store bot reference
            this.activeBots.set(botToken, {
                token: botToken,
                allowedChatId,
                startedAt: new Date().toISOString(),
                instance: bot,
            })

            this.saveActiveBots()

            return {
                success: true,
                message: "Bot started successfully",
                botId: botToken,
            }
        } catch (error) {
            console.error("Error starting bot:", error)
            return {
                success: false,
                message: `Failed to start bot: ${error.message}`,
            }
        }
    }

    /**
     * Stop a Telegram bot
     * @param {string} botToken - Telegram bot token
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async stopBot(botToken) {
        try {
            const botData = this.activeBots.get(botToken)
            if (!botData) {
                return {
                    success: false,
                    message: "Bot not found",
                }
            }

            await botData.instance.stop()
            this.activeBots.delete(botToken)
            this.saveActiveBots()

            return {
                success: true,
                message: "Bot stopped successfully",
            }
        } catch (error) {
            console.error("Error stopping bot:", error)
            return {
                success: false,
                message: `Failed to stop bot: ${error.message}`,
            }
        }
    }

    /**
     * Get status of all active bots
     * @returns {Array} Array of active bot information
     */
    getStatus() {
        const bots = []
        this.activeBots.forEach((botData, token) => {
            bots.push({
                token: token.substring(0, 10) + "***",
                startedAt: botData.startedAt,
                status: "running",
            })
        })
        return bots
    }

    /**
     * Get favorites from a specific bot
     * @param {string} botToken - Telegram bot token
     * @returns {Object} Favorites data
     */
    getFavorites(botToken) {
        const botData = this.activeBots.get(botToken)
        if (!botData || !botData.instance) {
            return {}
        }
        return botData.instance.userFavorites || {}
    }

    /**
     * Sync favorites from Telegram to VexonTV format
     * @param {string} botToken - Telegram bot token
     * @param {number} chatId - Telegram chat ID
     * @param {string} [listId] - VexonTV source list ID (optional; falls back to botToken)
     * @returns {Array} Array of favorites in VexonTV format
     */
    syncFavoritesToVexon(botToken, chatId, listId) {
        const botData = this.activeBots.get(botToken)
        if (!botData || !botData.instance) {
            return []
        }

        const resolvedListId = listId || botToken
        const telegramFavs = botData.instance.userFavorites[chatId.toString()] || []
        return telegramFavs.map((fav) => ({
            url: fav.url,
            name: fav.name,
            group: fav.group || "Telegram",
            logo: fav.logo || "",
            listId: resolvedListId,
        }))
    }

    /**
     * Get all active bot tokens
     * @returns {Array} Array of active bot tokens
     */
    getActiveBotTokens() {
        return Array.from(this.activeBots.keys())
    }

    /**
     * Check if a bot is running
     * @param {string} botToken - Telegram bot token
     * @returns {boolean}
     */
    isBotRunning(botToken) {
        return this.activeBots.has(botToken)
    }
}

export default new TelegramBotManager()
