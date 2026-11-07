var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

;(function () {
    const store = App.store
    const tv = App.tv
    const player = App.player
    const ui = App.ui

    function zone(name, selector, options) {
        tv.define(
            name,
            () => {
                return tv.rows(ui.qsa(selector))
            },
            options,
        )
    }

    function defineZones() {
        zone("rail", ".rail .rail-btn, .rail .rail-src", {
            onEdge: function (dir) {
                if (dir !== "right") return
                const screen = store.state.screen
                if (screen === "home") tv.set("types", 0, 0)
                else if (screen === "tv") tv.set("tvActions", 0, 0)
                else if (screen === "recents") tv.set("recentsSearch", 0, 0)
                else if (screen === "favs") tv.set("favsSearch", 0, 0)
                else if (screen === "cats") tv.set("catActions", 0, 0)
                else if (screen === "add") tv.set(store.state.addType ? "fields" : "addTypes", 0, 0)
                else if (screen === "edit") tv.set("fields", 0, 0)
                else if (screen === "player")
                    tv.set(store.state.playError ? "playError" : "overlay", 0, 0)
                else tv.set("sources", 0, 0)
            },
        })

        zone("homeActions", "#homeActions .btn", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("types", 0, 0)
                else if (dir === "left" || dir === "up") tv.set("rail", 0, 0)
            },
        })

        zone("types", "#typeList .type", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("rail", 0, 0)
                else if (dir === "right") tv.set("sources", 0, 0)
                else if (dir === "up") tv.set("homeActions", 0, 0)
            },
        })

        zone("sources", "#sourceList .row", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("types", 0, 0)
                else if (dir === "up") tv.set("homeActions", 0, 0)
                else if (dir === "right") enterEditFromRow()
            },
        })

        let editRow = 0

        function enterEditFromRow() {
            const rows = ui.qsa("#sourceList .row.source")
            const fromRow = rows.indexOf(document.querySelector(".focused"))
            if (fromRow !== -1) showEdit(fromRow)
        }

        function showEdit(index) {
            editRow = index
            tv.set("sourceEdit", 0, 0)
        }
        tv.define(
            "sourceEdit",
            () => {
                const buttons = ui.qsa("#sourceList .edit")
                return buttons[editRow] ? [[buttons[editRow]]] : []
            },
            {
                onEdge: function (dir) {
                    const buttons = ui.qsa("#sourceList .edit")
                    if (dir === "left") tv.set("sources", editRow, 0)
                    else if (dir === "up") showEdit(Math.max(0, editRow - 1))
                    else if (dir === "down") showEdit(Math.min(buttons.length - 1, editRow + 1))
                    else if (dir === "right") tv.set("rail", 0, 0)
                },
            },
        )

        zone("tvActions", "#tvActions .btn", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("tvSearch", 0, 0)
                else if (dir === "right") tv.set("tvSearch", 0, 0)
                else if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("tvSearch", "#tvSearch", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("tvActions", 0, 0)
                else if (dir === "left") tv.set("tvActions", 0, 0)
                else if (dir === "down") tv.set("tvCats", 0, 0)
            },
        })

        zone("tvCats", "#tvCats .tvcat", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("tvSearch", 0, 0)
                else if (dir === "right") tv.set("tvChannels", 0, 0)
                else if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("tvChannels", "#tvChannels .channel", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("tvCats", 0, 0)
                else if (dir === "right") tv.set("tvPreview", 0, 0)
                else if (dir === "up") tv.set("tvSearch", 0, 0)
            },
        })

        zone("tvPreview", "#tvPreview", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("tvChannels", 0, 0)
            },
        })

        zone("recentsSearch", "#recentsSearch", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("rail", 0, 0)
                else if (dir === "down") tv.set("recentsList", 0, 0)
            },
        })

        zone("recentsList", "#recentsList .channel", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("recentsSearch", 0, 0)
                else if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("favsSearch", "#favsSearch", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("rail", 0, 0)
                else if (dir === "down") tv.set("favsList", 0, 0)
            },
        })

        zone("favsList", "#favList .channel", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("favsSearch", 0, 0)
                else if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("catActions", "#catActions .btn", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("cats", 0, 0)
                else if (dir === "right") tv.set("catSearch", 0, 0)
                else if (dir === "left" || dir === "up") tv.set("rail", 0, 0)
            },
        })

        zone("catSearch", "#catSearch", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("catActions", 0, 0)
                else if (dir === "left") tv.set("catActions", 0, 0)
                else if (dir === "down") tv.set("cats", 0, 0)
            },
        })

        zone("cats", "#catList .cat", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("catSearch", 0, 0)
                else if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("addTypes", "#addTypes .typecard", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("fields", "#sourceForm input:not(.file), #sourceForm textarea, #sourceForm .pick", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("formActions", 0, 0)
                else if (dir === "left") tv.set("rail", 0, 0)
            },
        })

        zone("formActions", "#sourceForm .btn", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("fields", 9, 0)
            },
        })

        tv.define("playerIdle", () => {
            return []
        })

        zone("overlay", "#ovActions .btn", {
            onEdge: function (dir) {
                if (dir === "up") {
                    store.setMenuFocus(false)
                    tv.set("playerIdle", 0, 0)
                }
            },
        })

        zone("zapCats", "#zapCats .zapcat", {
            onEdge: function (dir) {
                if (dir === "right") tv.set("zapChannels", 0, 0)
            },
        })

        zone("zapChannels", "#zapChannels .zapch", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("zapCats", 0, 0)
            },
        })

        zone("zapFavChannels", "#zapFavChannels .zapch", {})

        zone("playError", "#playError .btn")

        zone("confirm", "#confirm .btn")
    }

    function back() {
        if (store.state.confirm) {
            store.closeConfirm()
            return true
        }
        if (store.state.favZapOpen) {
            store.closeFavZap()
            return true
        }
        if (store.state.zapOpen) {
            store.closeZap()
            return true
        }
        if (store.state.screen === "player") {
            store.exitPlayer()
            return true
        }
        if (store.state.screen === "edit") {
            store.goHome()
            return true
        }
        if (store.state.screen !== "home") {
            store.goHome()
            return true
        }
        try {
            tizen.application.getCurrentApplication().exit()
        } catch {}
        return true
    }

    function red() {
        const element = tv.focusedElement()
        const state = store.state

        if (state.screen === "player" && state.playing) {
            const added = store.toggleFavorite(state.playing.channel, state.playing.listId)
            store.notify(added ? "Added to favorites" : "Removed from favorites")
            return
        }

        if (!element) return

        if (state.screen === "home") {
            const list = element.dataset.list ? store.listById(element.dataset.list) : null
            if (!list) return
            store.askConfirm(`Delete “${list.name}”? Favorites are kept.`, () => {
                store.removeList(list.id)
                store.notify("Source deleted")
                store.goHome()
            })
            return
        }

        const url = element.dataset.url
        const listId = element.dataset.list
        if (!url) return
        const channel = store.channelByUrl(url, listId)
        if (!channel) return
        const saved = store.toggleFavorite(channel, listId)
        store.notify(saved ? "Added to favorites" : "Removed from favorites")
    }

    function onKey(code) {
        if (code >= 48 && code <= 57) {
            store.pushDigit(String(code - 48))
            return true
        }
        if (code >= 96 && code <= 105) {
            store.pushDigit(String(code - 96))
            return true
        }
        if (code === tv.KEY.BACK || code === 27) return store.clearDigits() ? true : back()
        if (code === tv.KEY.RED) {
            red()
            return true
        }
        if (code === tv.KEY.ENTER && store.commitDigits()) return true
        if (store.state.screen !== "player") return false

        if (code === tv.KEY.CH_UP) {
            store.zap(1)
            return true
        }
        if (code === tv.KEY.CH_DOWN) {
            store.zap(-1)
            return true
        }

        if (store.state.favZapOpen && code === tv.KEY.RIGHT) {
            store.closeFavZap()
            return true
        }

        if (store.state.zapOpen || store.state.favZapOpen) return false

        if (code === tv.KEY.LEFT) {
            store.openFavZap()
            return true
        }

        if (store.state.playError) {
            if (code === tv.KEY.UP || code === tv.KEY.DOWN) {
                const buttons = ui.qsa("#playError .btn")
                const index = buttons.indexOf(document.querySelector(".focused"))
                tv.set("playError", index === 0 ? 1 : 0, 0)
                return true
            }
            return false
        }

        if (store.state.menuFocus) return false

        if (code === tv.KEY.DOWN) {
            store.setMenuFocus(true)
            tv.set("overlay", 0, 0)
            return true
        }
        if (code === tv.KEY.UP) {
            store.setMenuFocus(false)
            tv.set("playerIdle", 0, 0)
            return true
        }
        if (code === tv.KEY.ENTER) {
            store.openFavZap()
            return true
        }
        if (code === tv.KEY.PLAY_PAUSE) {
            player.toggle()
            return true
        }
        return false
    }

    function start() {
        store.init()
        defineZones()
        tv.listen(onKey, { onFocus: store.focusChanged })
        ui.render()
        store.openFavorites()
    }

    document.addEventListener("DOMContentLoaded", start)
})()
