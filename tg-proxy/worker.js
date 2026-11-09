/**
 * VexonTV — Telegram file proxy worker
 *
 * Fetches a file from api.telegram.org/file/ and returns it with
 * Access-Control-Allow-Origin: * so the TV browser can read it.
 *
 * Deploy to Cloudflare Workers (free tier is plenty):
 *   https://dash.cloudflare.com → Workers & Pages → Create Worker → paste this
 *
 * Usage from the TV app:
 *   GET https://<your-worker>.workers.dev/?token=BOT_TOKEN&path=FILE_PATH
 *
 * FILE_PATH comes from Telegram's getFile API response (file.file_path).
 * The token is the bot token already in memory in the TV app.
 *
 * Security notes:
 * - Only proxies api.telegram.org/file/* — nothing else is reachable.
 * - The token travels in the query string over HTTPS (safe).
 * - No token is stored in the worker itself.
 */

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS })
        }

        if (request.method !== "GET") {
            return new Response("Method not allowed", {
                status: 405,
                headers: CORS_HEADERS,
            })
        }

        const url = new URL(request.url)
        const token = url.searchParams.get("token")
        const filePath = url.searchParams.get("path")

        if (!token || !filePath) {
            return new Response(JSON.stringify({ error: "Missing token or path" }), {
                status: 400,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            })
        }

        // Strictly only allow Telegram file paths — no path traversal
        // file_path from Telegram looks like "documents/file_123.bak" or "photos/file_0.jpg"
        if (!/^[\w\-./]+$/.test(filePath) || filePath.includes("..")) {
            return new Response(JSON.stringify({ error: "Invalid path" }), {
                status: 400,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            })
        }

        const telegramUrl = `https://api.telegram.org/file/bot${token}/${filePath}`

        try {
            const tgResponse = await fetch(telegramUrl)

            if (!tgResponse.ok) {
                return new Response(
                    JSON.stringify({ error: `Telegram returned ${tgResponse.status}` }),
                    {
                        status: tgResponse.status,
                        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
                    },
                )
            }

            const body = await tgResponse.text()

            return new Response(body, {
                status: 200,
                headers: {
                    ...CORS_HEADERS,
                    "Content-Type": "text/plain; charset=utf-8",
                    // Don't cache — backup files change
                    "Cache-Control": "no-store",
                },
            })
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 502,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            })
        }
    },
}
