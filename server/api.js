import express from "express"
import cors from "cors"
import telegramManager from "./telegram-manager.js"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")

const app = express()
const PORT = process.env.TELEGRAM_API_PORT || 3000

app.use(cors())
app.use(express.json())

// Serve static app files (HTML, CSS, JS, vendor)
app.use(express.static(rootDir))

/**
 * POST /api/telegram/start
 * Start a Telegram bot with the given token
 */
app.post("/api/telegram/start", async (req, res) => {
    try {
        const { token, name, chatId } = req.body

        if (!token) {
            return res.status(400).json({
                success: false,
                error: "Bot token is required",
            })
        }

        const result = await telegramManager.startBot(token, chatId)
        return res.status(result.success ? 200 : 400).json(result)
    } catch (error) {
        console.error("Error in /api/telegram/start:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * POST /api/telegram/stop
 * Stop a Telegram bot
 */
app.post("/api/telegram/stop", async (req, res) => {
    try {
        const { token } = req.body

        if (!token) {
            return res.status(400).json({
                success: false,
                error: "Bot token is required",
            })
        }

        const result = await telegramManager.stopBot(token)
        return res.status(result.success ? 200 : 400).json(result)
    } catch (error) {
        console.error("Error in /api/telegram/stop:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * GET /api/telegram/status
 * Get status of all active bots
 */
app.get("/api/telegram/status", (req, res) => {
    try {
        const status = telegramManager.getStatus()
        res.json({
            success: true,
            activeBots: status,
            count: status.length,
        })
    } catch (error) {
        console.error("Error in /api/telegram/status:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * GET /api/telegram/is-running/:token
 * Check if a specific bot is running
 */
app.get("/api/telegram/is-running/:token", (req, res) => {
    try {
        const { token } = req.params
        const isRunning = telegramManager.isBotRunning(token)
        res.json({
            success: true,
            token: token.substring(0, 10) + "***",
            isRunning,
        })
    } catch (error) {
        console.error("Error in /api/telegram/is-running:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * GET /api/telegram/favorites/:token/:chatId
 * Get favorites for a specific chat
 */
app.get("/api/telegram/favorites/:token/:chatId", (req, res) => {
    try {
        const { token, chatId } = req.params
        const favorites = telegramManager.syncFavoritesToVexon(token, chatId)
        res.json({
            success: true,
            favorites,
            count: favorites.length,
        })
    } catch (error) {
        console.error("Error in /api/telegram/favorites:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * GET /api/telegram/sync-favorites/:token/:chatId/:listId
 * Pull Telegram-bot favorites in VexonTV format.
 * listId (URL-encoded) is the VexonTV source ID; it becomes the listId on each
 * returned favorite so VexonTV can correlate the channel back to its source.
 */
app.get("/api/telegram/sync-favorites/:token/:chatId/:listId", (req, res) => {
    try {
        const { token, chatId, listId } = req.params
        const favorites = telegramManager.syncFavoritesToVexon(token, chatId, listId)
        res.json({
            success: true,
            favorites,
            count: favorites.length,
        })
    } catch (error) {
        console.error("Error in /api/telegram/sync-favorites:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * GET /api/telegram/active-tokens
 * Get all active bot tokens
 */
app.get("/api/telegram/active-tokens", (req, res) => {
    try {
        const tokens = telegramManager.getActiveBotTokens()
        res.json({
            success: true,
            tokens: tokens.map((t) => t.substring(0, 10) + "***"),
            count: tokens.length,
        })
    } catch (error) {
        console.error("Error in /api/telegram/active-tokens:", error)
        res.status(500).json({
            success: false,
            error: error.message,
        })
    }
})

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "VexonTV Telegram Bot API",
        uptime: process.uptime(),
    })
})

/**
 * Error handling middleware
 */
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err)
    res.status(500).json({
        success: false,
        error: "Internal server error",
    })
})

/**
 * Start the server
 */
app.listen(PORT, () => {
    console.log(`🚀 VexonTV Telegram Bot API running on http://localhost:${PORT}`)
    console.log(`📡 Health check: http://localhost:${PORT}/health`)
})
