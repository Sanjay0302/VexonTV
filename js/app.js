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

    function searchZone(name, selector, options) {
        tv.define(
            name,
            () => {
                const items = ui.qsa(selector)
                // In search-split, the text input and clear button sit side-by-side in one row
                return items.length ? [items] : []
            },
            options,
        )
    }

    function indexWithClass(selector, cls) {
        const items = ui.qsa(selector)
        for (let i = 0; i < items.length; i++) {
            if (items[i].classList.contains(cls)) return i
        }
        return 0
    }

    function selectedIndex(selector) {
        return indexWithClass(selector, "selected")
    }

    function activeRailIndex() {
        return indexWithClass(".rail .rail-btn, .rail .rail-src", "active")
    }

    function focusedIndex(selector) {
        const current = tv.focusedElement()
        if (!current) return -1
        return ui.qsa(selector).indexOf(current)
    }

    function defineZones() {
        let savedTypes = null
        let savedSources = null
        let savedTvCats = null
        let savedTvChannel = null

        function restoreRow(saved, selector) {
            const selected = selectedIndex(selector)
            if (saved && saved.selected === selected) return saved.row
            return selected
        }

        function restoreChannelRow() {
            const cat = selectedIndex("#tvCats .tvcat")
            if (savedTvChannel && savedTvChannel.cat === cat) return savedTvChannel.row
            const preview = store.state.preview
            if (preview && preview.url) {
                const channels = ui.qsa("#tvChannels .channel")
                for (let i = 0; i < channels.length; i++) {
                    if (channels[i].dataset.url === preview.url) return i
                }
            }
            return 0
        }

        zone("rail", ".rail .rail-btn, .rail .rail-src", {
            onEdge: function (dir) {
                if (dir !== "right") return
                const screen = store.state.screen
                if (screen === "home") tv.set("types", restoreRow(savedTypes, "#typeList .type"), 0)
                else if (screen === "tv") {
                    if (ui.qsa("#tvCats .tvcat").length)
                        tv.set("tvCats", restoreRow(savedTvCats, "#tvCats .tvcat"), 0)
                    else tv.set("tvActions", 0, 0)
                } else if (screen === "recents") tv.set("recentsSearch", 0, 0)
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
                if (dir === "down") tv.set("types", restoreRow(savedTypes, "#typeList .type"), 0)
                else if (dir === "left" || dir === "up") tv.set("rail", activeRailIndex(), 0)
            },
        })

        zone("types", "#typeList .type", {
            onEdge: function (dir) {
                const row = focusedIndex("#typeList .type")
                if (row >= 0) savedTypes = { row, selected: selectedIndex("#typeList .type") }
                if (dir === "left") tv.set("rail", activeRailIndex(), 0)
                else if (dir === "right") {
                    const filter = selectedIndex("#typeList .type")
                    const rowToFocus =
                        savedSources && savedSources.filter === filter ? savedSources.row : 0
                    tv.set("sources", rowToFocus, 0)
                } else if (dir === "up") tv.set("homeActions", 0, 0)
            },
        })

        zone("sources", "#sourceList .row", {
            onEdge: function (dir) {
                const row = focusedIndex("#sourceList .row")
                if (row >= 0) savedSources = { row, filter: selectedIndex("#typeList .type") }
                if (dir === "left") tv.set("types", restoreRow(savedTypes, "#typeList .type"), 0)
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
                    else if (dir === "right") tv.set("rail", activeRailIndex(), 0)
                },
            },
        )

        zone("tvActions", "#tvActions .btn", {
            onEdge: function (dir) {
                if (dir === "down")
                    tv.set(
                        ui.qsa("#tvCats .tvcat").length ? "tvCats" : "tvSearch",
                        restoreRow(savedTvCats, "#tvCats .tvcat"),
                        0,
                    )
                else if (dir === "right") tv.set("tvSearch", 0, 0)
                else if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        searchZone("tvSearch", "#tvSearch, #screen-tv .search-clear", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("tvActions", 0, 0)
                else if (dir === "left") tv.set("tvActions", 0, 0)
                else if (dir === "down")
                    tv.set("tvCats", restoreRow(savedTvCats, "#tvCats .tvcat"), 0)
            },
        })

        zone("tvCats", "#tvCats .tvcat", {
            onEdge: function (dir) {
                const row = focusedIndex("#tvCats .tvcat")
                if (row >= 0) savedTvCats = { row, selected: selectedIndex("#tvCats .tvcat") }
                if (dir === "up") tv.set("tvSearch", 0, 0)
                else if (dir === "right") tv.set("tvChannels", restoreChannelRow(), 0)
                else if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        zone("tvChannels", "#tvChannels .channel", {
            onEdge: function (dir) {
                const row = focusedIndex("#tvChannels .channel")
                if (row >= 0) savedTvChannel = { row, cat: selectedIndex("#tvCats .tvcat") }
                if (dir === "left") tv.set("tvCats", restoreRow(savedTvCats, "#tvCats .tvcat"), 0)
                else if (dir === "right") tv.set("tvPreview", 0, 0)
                else if (dir === "up") tv.set("tvSearch", 0, 0)
            },
        })

        zone("tvPreview", "#tvPreview", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("tvChannels", restoreChannelRow(), 0)
            },
        })

        searchZone("recentsSearch", "#recentsSearch, #screen-recents .search-clear", {
            onEdge: function (dir) {
                if (dir === "up" || dir === "left") tv.set("rail", activeRailIndex(), 0)
                else if (dir === "down") tv.set("recentsList", 0, 0)
            },
        })

        zone("recentsList", "#recentsList .channel", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("recentsSearch", 0, 0)
                else if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        searchZone("favsSearch", "#favsSearch, #screen-favs .search-clear", {
            onEdge: function (dir) {
                if (dir === "up" || dir === "left") tv.set("rail", activeRailIndex(), 0)
                else if (dir === "down") tv.set("favsList", 0, 0)
            },
        })

        zone("favsList", "#favList .channel", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("favsSearch", 0, 0)
                else if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        zone("catActions", "#catActions .btn", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("cats", 0, 0)
                else if (dir === "right") tv.set("catSearch", 0, 0)
                else if (dir === "left" || dir === "up") tv.set("rail", activeRailIndex(), 0)
            },
        })

        searchZone("catSearch", "#catSearch, #screen-cats .search-clear", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("catActions", 0, 0)
                else if (dir === "left") tv.set("catActions", 0, 0)
                else if (dir === "down") tv.set("cats", 0, 0)
            },
        })

        zone("cats", "#catList .cat", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("catSearch", 0, 0)
                else if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        zone("addTypes", "#addTypes .typecard", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        zone("fields", "#sourceForm input:not(.file), #sourceForm textarea, #sourceForm .pick", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("formActions", 0, 0)
                else if (dir === "left") tv.set("rail", activeRailIndex(), 0)
            },
        })

        zone("formActions", "#sourceForm .btn", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("fields", 9, 0)
            },
        })

        tv.define(
            "playerIdle",
            () => {
                return []
            },
            { allowEmpty: true },
        )

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
                if (dir === "left") tv.set("zapCats", selectedIndex("#zapCats .zapcat"), 0)
            },
        })

        zone("zapFavChannels", "#zapFavChannels .zapch", { allowEmpty: true })

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
        if (store.state.confirm) return false
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

    // Locks the rail and app layout height to the maximum viewport height observed.
    // When virtual keyboards (TV/mobile) or browser DevTools pop up from the bottom,
    // window.innerHeight drops, which would otherwise compress the flex container,
    // shift the vertically centered navigation buttons, and push layout elements around.
    // NOTE: Use window.innerHeight (not window.screen.height). window.screen.height
    // is the physical hardware monitor resolution (e.g. 1080px), which would overflow
    // and push the bottom margin outside windowed or non-fullscreen desktop browsers.
    function lockRailHeight() {
        let maxH = 0
        function update() {
            const h = window.innerHeight || 0
            if (h > maxH) {
                maxH = h
                document.documentElement.style.setProperty("--rail-h", `${maxH}px`)
            }
        }
        update()
        window.addEventListener("resize", update)
    }

    function start() {
        lockRailHeight()
        store.init()
        defineZones()
        tv.listen(onKey, {
            onFocus: (el) => {
                const app = document.querySelector(".app")
                if (app) {
                    const isRail = el && !!el.closest(".rail")
                    app.classList.toggle("rail-open", isRail)
                }
                store.focusChanged(el)
            },
        })
        window.addEventListener("scroll", () => {
            if (window.scrollX !== 0 || window.scrollY !== 0) {
                window.scrollTo(0, 0)
            }
        })
        ui.render()
        store.openFavorites()
    }

    document.addEventListener("DOMContentLoaded", start)
})()
