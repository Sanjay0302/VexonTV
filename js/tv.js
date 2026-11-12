var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.tv = (function () {
    const KEY = {
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        ENTER: 13,
        BACK: 10009,
        RED: 403,
        CH_UP: 427,
        CH_DOWN: 428,
        PLAY_PAUSE: 10252,
    }

    const zones = {}
    let current = null
    let row = 0
    let col = 0
    let onKey = function () {}
    let onFocus = null

    function rows(elements) {
        const out = []
        let top = null
        for (let i = 0; i < elements.length; i++) {
            const elementTop = elements[i].offsetTop
            if (top === null || Math.abs(elementTop - top) > 8) {
                out.push([])
                top = elementTop
            }
            out[out.length - 1].push(elements[i])
        }
        return out
    }

    function define(name, items, options) {
        zones[name] = {
            items,
            onEdge: options && options.onEdge,
            allowEmpty: !!(options && options.allowEmpty),
        }
    }

    // Rows are grouped by offsetTop: what a TV layout needs, and what jsdom lacks.
    function matrix() {
        const zone = zones[current]
        if (!zone) return []
        const items = typeof zone.items === "function" ? zone.items() : zone.items
        return items || []
    }

    function apply() {
        const previous = document.querySelector(".focused")
        if (previous) previous.classList.remove("focused")

        const grid = matrix()
        if (!grid.length) return
        if (row >= grid.length) row = grid.length - 1
        if (row < 0) row = 0
        const line = grid[row] || []
        if (!line.length) return
        if (col >= line.length) col = line.length - 1
        if (col < 0) col = 0

        const element = line[col]
        element.classList.add("focused")
        reveal(element)
        if (onFocus) onFocus(element)
    }

    // Scroll only the container that overflows: scrollIntoView dragged the whole document.
    function reveal(element) {
        const box = scrollBox(element)
        if (!box || !element.getBoundingClientRect) return
        const item = element.getBoundingClientRect()
        const frame = box.getBoundingClientRect()
        if (item.top < frame.top) box.scrollTop -= frame.top - item.top
        else if (item.bottom > frame.bottom) box.scrollTop += item.bottom - frame.bottom
    }

    function scrollBox(element) {
        for (
            let node = element.parentNode;
            node && node !== document.body;
            node = node.parentNode
        ) {
            const overflow = window.getComputedStyle(node).overflowY
            if (
                (overflow === "auto" || overflow === "scroll") &&
                node.scrollHeight > node.clientHeight
            )
                return node
        }
        return null
    }

    function set(name, r, c) {
        const nextZone = zones[name]
        if (!nextZone) return
        const prev = { current, row, col }
        current = name
        row = r || 0
        col = c || 0
        const grid = matrix()
        if (!grid.length && !nextZone.allowEmpty) {
            if (prev.current && document.querySelector(".focused")) {
                current = prev.current
                row = prev.row
                col = prev.col
                return
            }
            if (name !== "rail" && zones.rail) {
                set("rail", 0, 0)
                return
            }
        }
        apply()
    }

    function edge(direction) {
        const zone = zones[current]
        if (zone && zone.onEdge) zone.onEdge(direction)
    }

    function move(direction) {
        if (!zones[current]) return
        const grid = matrix()
        if (!grid.length) return edge(direction)
        const line = grid[row] || []

        if (direction === "up") {
            if (row > 0) row--
            else return edge("up")
        } else if (direction === "down") {
            if (row < grid.length - 1) row++
            else return edge("down")
        } else if (direction === "left") {
            if (col > 0) col--
            else return edge("left")
        } else if (direction === "right") {
            if (col < line.length - 1) col++
            else return edge("right")
        }
        apply()
    }

    function focusedElement() {
        return document.querySelector(".focused")
    }

    // Focusing a field from inside the key handler is what summons the TV's IME.
    function select() {
        const element = focusedElement()
        if (!element) return
        if (element.tagName === "INPUT" && element.type === "file") element.click()
        else if (field(element)) {
            try {
                element.focus({ preventScroll: true })
            } catch {
                element.focus()
            }
        } else element.click()
    }

    // Keys belong to the focused text field, textarea included.
    function field(element) {
        if (!element) return false
        return (
            element.tagName === "TEXTAREA" ||
            (element.tagName === "INPUT" && element.type !== "file")
        )
    }

    function typing() {
        return field(document.activeElement) && document.activeElement.type !== "file"
    }

    function handle(event) {
        if (typing()) {
            const field = document.activeElement
            if (event.keyCode === KEY.UP || event.keyCode === KEY.DOWN) {
                field.blur()
            } else {
                if (event.keyCode === KEY.BACK) field.blur()
                return
            }
        }

        if (onKey(event.keyCode)) return

        switch (event.keyCode) {
            case KEY.UP:
                move("up")
                break
            case KEY.DOWN:
                move("down")
                break
            case KEY.LEFT:
                move("left")
                break
            case KEY.RIGHT:
                move("right")
                break
            case KEY.ENTER:
                select()
                break
        }
    }

    // Some firmwares only deliver the non-arrow keys if they are registered first.
    function listen(handler, options) {
        onKey = handler
        onFocus = (options && options.onFocus) || null
        document.addEventListener("keydown", handle)
        try {
            if (typeof tizen !== "undefined") {
                tizen.tvinputdevice.registerKeyBatch([
                    "ColorF0Red",
                    "ChannelUp",
                    "ChannelDown",
                    "MediaPlayPause",
                ])
            }
        } catch {}
    }

    function currentZone() {
        return { zone: current, row, col }
    }

    return {
        KEY,
        define,
        set,
        refresh: apply,
        move,
        select,
        rows,
        listen,
        focusedElement,
        current: currentZone,
    }
})()
