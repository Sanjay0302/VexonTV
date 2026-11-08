var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.telegramClient = (function () {
    const API_BASE = "http://localhost:3000/api/telegram"
    const TIMEOUT_MS = 15000

    function request(method, endpoint, data) {
        return new Promise((resolve, reject) => {
            const url = API_BASE + endpoint
            const timer = setTimeout(() => {
                reject(new Error("Telegram server not responding. Run: pnpm run telegram"))
            }, TIMEOUT_MS)

            const options = {
                method,
                headers: { "Content-Type": "application/json" },
            }

            if (data) options.body = JSON.stringify(data)

            fetch(url, options)
                .then((res) => {
                    clearTimeout(timer)
                    return res.json()
                })
                .then((json) => {
                    resolve(json)
                })
                .catch((error) => {
                    clearTimeout(timer)
                    // Provide a friendly error when the server is not running
                    if (error.message && error.message.indexOf("fetch") !== -1) {
                        reject(
                            new Error(
                                "Cannot reach Telegram server. Start it with: pnpm run telegram",
                            ),
                        )
                    } else {
                        reject(error)
                    }
                })
        })
    }

    function startBot(token, name, chatId) {
        return request("POST", "/start", { token, name, chatId })
    }

    function stopBot(token) {
        return request("POST", "/stop", { token })
    }

    function getStatus() {
        return request("GET", "/status", null)
    }

    function isBotRunning(token) {
        return request("GET", `/is-running/${encodeURIComponent(token)}`, null)
    }

    // Returns favorites in VexonTV format: [{url, name, group, logo, listId}]
    function syncFavorites(token, chatId, listId) {
        return request(
            "GET",
            `/sync-favorites/${encodeURIComponent(token)}/${chatId}/${encodeURIComponent(listId)}`,
            null,
        )
    }

    function getActiveBots() {
        return request("GET", "/active-tokens", null)
    }

    function checkConnection() {
        return fetch("http://localhost:3000/health")
            .then((res) => {
                return res.json()
            })
            .then(() => {
                return true
            })
            .catch(() => {
                return false
            })
    }

    return {
        startBot,
        stopBot,
        getStatus,
        isBotRunning,
        syncFavorites,
        getActiveBots,
        checkConnection,
    }
})()
