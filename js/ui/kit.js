var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiKit = (function () {
    const preact = window.preact
    const hooks = window.preactHooks
    const html = window.htm.bind(preact.h)
    const useState = hooks.useState
    const useEffect = hooks.useEffect
    const useRef = hooks.useRef
    const store = App.store

    const SEARCH_DEBOUNCE_MS = 150

    const ADD_TYPES = [
        { id: "url", title: "M3U from URL", hint: "An .m3u or .m3u8 address", icon: "link" },
        { id: "file", title: "M3U from a file", hint: "An .m3u on a USB drive", icon: "file" },
        { id: "xtream", title: "Xtream", hint: "Server, username and password", icon: "key" },
        { id: "stalker", title: "Stalker", hint: "Portal and MAC", icon: "box" },
        { id: "raw", title: "Pasted M3U", hint: "The playlist text", icon: "text" },
        {
            id: "telegram",
            title: "Telegram Bot",
            hint: "Manage playlists and favories",
            icon: "chat",
        },
        {
            id: "auto",
            title: "Detect",
            hint: "Paste whatever your provider gave you",
            icon: "wand",
        },
    ]

    const FIELD_SETS = {
        url: [{ id: "url", label: "Playlist address", placeholder: "http://host:8080/list.m3u" }],
        file: [],
        xtream: [
            { id: "origin", label: "Server", placeholder: "http://host:8080" },
            { id: "user", label: "Username" },
            { id: "pass", label: "Password" },
        ],
        stalker: [
            { id: "origin", label: "Portal", placeholder: "http://host:8080/c" },
            { id: "mac", label: "MAC", placeholder: "00:1A:79:12:34:56" },
        ],
        telegram: [
            {
                id: "token",
                label: "Bot Token",
                placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
            },
            {
                id: "chatId",
                label: "Telegram Username",
                placeholder: "@your_telegram_username",
            },
        ],
        raw: [{ id: "text", label: "Playlist contents", multiline: true, placeholder: "#EXTM3U…" }],
        auto: [
            {
                id: "text",
                label: "Paste the address, the credentials or the whole message",
                multiline: true,
            },
        ],
    }

    function svg(paths, size) {
        return html`<svg viewBox="0 0 24 24" width=${size || 22} height=${size || 22}>
            ${paths}
        </svg>`
    }

    const iconList = svg(
        html`<path
            d="M3.5 6.5h17M3.5 12h17M3.5 17.5h12"
            stroke="currentColor"
            stroke-width="1.8"
            fill="none"
            stroke-linecap="round"
        />`,
        22,
    )
    const iconTv = svg(
        html`<rect
                x="3"
                y="5"
                width="18"
                height="12.5"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
            /><path
                d="M8.5 20.5h7"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />`,
        22,
    )
    const iconClock = svg(
        html`<circle
                cx="12"
                cy="12"
                r="8.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
            /><path
                d="M12 7.5V12l3 2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />`,
        22,
    )
    const iconStar = svg(
        html`<path
            d="M12 3.2l2.6 5.3 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
        />`,
        22,
    )
    const iconSearch = svg(
        html`<circle
                cx="11"
                cy="11"
                r="6.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
            /><path
                d="M16 16l4.5 4.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />`,
        22,
    )
    const iconClose = svg(
        html`<path
            d="M7 7l10 10M17 7L7 17"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
        />`,
        14,
    )
    const iconLink = svg(
        html`<path
                d="M10 13a4 4 0 006 .5l2-2a4 4 0 00-5.6-5.7L11 7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            /><path
                d="M14 11a4 4 0 00-6-.5l-2 2A4 4 0 0011.6 18L13 16.6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            />`,
    )
    const iconFile = svg(
        html`<path
                d="M6 3h8l4 4v14H6z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
            /><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.7" />`,
    )
    const iconKey = svg(
        html`<circle
                cx="8"
                cy="12"
                r="3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
            /><path
                d="M11.5 12H21M18 12v3M15 12v2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            />`,
    )
    const iconBox = svg(
        html`<rect
                x="3"
                y="6"
                width="18"
                height="12"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
            /><path
                d="M7 10h6M7 14h10"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            />`,
    )
    const iconText = svg(
        html`<path
            d="M5 7h14M5 12h14M5 17h8"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
        />`,
    )
    const iconWand = svg(
        html`<path
            d="M6 18L18 6M15 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
        />`,
    )
    const iconChat = svg(
        html`<path
            d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
        />`,
    )
    const iconPencil = svg(
        html`<path
                d="M5 19h3L19 8l-3-3L5 16z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
            /><path d="M15 6l3 3" fill="none" stroke="currentColor" stroke-width="1.7" />`,
        20,
    )
    const iconCheck = svg(
        html`<path
            d="M5 13l4 4L19 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
        />`,
    )

    const TYPE_ICONS = {
        link: iconLink,
        file: iconFile,
        key: iconKey,
        box: iconBox,
        text: iconText,
        chat: iconChat,
        wand: iconWand,
    }

    function initial(name) {
        const match = (name || "").match(/[a-z0-9]/i)
        return match ? match[0].toUpperCase() : "?"
    }

    function logoStyle(url) {
        return url ? { backgroundImage: `url(${JSON.stringify(url)})` } : null
    }

    function clock(value) {
        const match = (value || "").match(/(\d{1,2}:\d{2})/)
        return match ? match[1] : ""
    }

    function programText(program) {
        if (!program || !program.title) return ""
        const span =
            program.start && program.end ? ` ${clock(program.start)}–${clock(program.end)}` : ""
        return program.title + span
    }

    // // Rail clock: the system time, refreshed by the minute. A clock that ticks every
    // // second is a distraction on a TV.
    // function timeText() {
    //     const now = new Date()
    //     return `${`0${now.getHours()}`.slice(-2)}:${`0${now.getMinutes()}`.slice(-2)}`
    // }

    // function useClock() {
    //     const state = useState(timeText())
    //     const setTime = state[1]
    //     useEffect(() => {
    //         const tick = setInterval(() => {
    //             setTime(timeText())
    //         }, 20000)
    //         return function () {
    //             clearInterval(tick)
    //         }
    //     }, [])
    //     return state[0]
    // }

    // Sidebar: the brand, the four sections, a shortcut to each source and, at the
    // bottom, the clock and the count. Anchored to the grid: 64px sections, 56px sources.
    function ScallopClock() {
        const state = useState(() => new Date())
        const now = state[0]
        const setNow = state[1]

        useEffect(() => {
            const timer = setInterval(() => {
                setNow(new Date())
            }, 1000)
            return () => clearInterval(timer)
        }, [])

        const sec = now.getSeconds()
        const min = now.getMinutes()
        const hr = now.getHours() % 12

        const hrAngle = (hr + min / 60) * 30 + 180
        const minAngle = (min + sec / 60) * 6 + 180
        const secAngle = sec * 6

        const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        const dayStr = DAYS[now.getDay()] || "Mon"
        const dateNum = String(now.getDate()).padStart(2, "0")
        const dayChars = dayStr.split("")
        const dateChars = dateNum.split("")

        const hourStyle = `transform: rotate(${hrAngle}deg);`
        const minStyle = `transform: rotate(${minAngle}deg);`
        const secStyle = `transform: rotate(${secAngle + 180}deg) translateY(420%);`
        const dateStyle = `transform: translateY(-50%) rotate(${secAngle}deg);`

        return html`<figure class="scallop-clock" aria-label="Clock">
            <div class="scallop-edges">
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
                <div class="scallop-edge"></div>
            </div>
            <div class="scallop-hand scallop-hour" style=${hourStyle}></div>
            <div class="scallop-hand scallop-minute" style=${minStyle}></div>
            <div class="scallop-date" aria-hidden="true" style=${dateStyle}>
                <span>${dayChars[0] || ""}</span><span>${dayChars[1] || ""}</span
                ><span>${dayChars[2] || ""}</span> <span>${dateChars[0] || ""}</span
                ><span>${dateChars[1] || ""}</span>
            </div>
            <div class="scallop-second" style=${secStyle}></div>
        </figure>`
    }

    function Rail(props) {
        const items = [
            {
                id: "navHome",
                label: "Sources",
                icon: iconList,
                screens: ["home"],
                action: function () {
                    store.goHome()
                },
            },
            {
                id: "navTv",
                label: "Live TV",
                icon: iconTv,
                screens: ["tv", "cats"],
                action: function () {
                    store.openTv()
                },
            },
            {
                id: "navRecents",
                label: "Recent",
                icon: iconClock,
                screens: ["recents"],
                action: function () {
                    store.openRecents()
                },
            },
            {
                id: "navFavs",
                label: "Favorites",
                icon: iconStar,
                screens: ["favs"],
                action: function () {
                    store.openFavorites()
                },
            },
        ]
        const nav = useRef(null)
        const stats = store.stats()

        useEffect(() => {
            const rail = nav.current
            if (!rail) return
            const element = rail.querySelector(".rail-btn.active")
            const height = element ? Math.round(element.offsetHeight * 0.62) : 0
            rail.style.setProperty("--rail-mark-h", `${height}px`)
            rail.style.setProperty(
                "--rail-mark-y",
                element
                    ? `${element.offsetTop + Math.round((element.offsetHeight - height) / 2)}px`
                    : "0px",
            )
            rail.classList.add("moving")
            const timer = setTimeout(() => {
                rail.classList.remove("moving")
            }, 300)
            return function () {
                clearTimeout(timer)
            }
        }, [props.screen])

        return html`<nav class="rail" ref=${nav}>
            <span class="rail-glow" aria-hidden="true"></span>
            <div class="rail-top">
                <${ScallopClock} />
            </div>
            <div class="rail-nav">
                ${items.map((item) => {
                    const active = item.screens.indexOf(props.screen) !== -1
                    return html`<button
                        id=${item.id}
                        class=${`rail-btn${active ? " active" : ""}`}
                        tabindex="-1"
                        onClick=${item.action}
                    >
                        ${item.icon}<span>${item.label}</span>
                    </button>`
                })}
            </div>
            <div class="rail-foot">
                <p class="rail-counts" id="railCounts">${stats.counts}</p>
            </div>
        </nav>`
    }

    function ChannelRow(props) {
        const channel = props.channel
        const listId = props.listId || channel.listId
        const now = programText(store.programOf(channel))
        function open() {
            if (props.detail) store.selectPreview(channel)
            else store.play(channel, listId, props.source)
        }
        return html`<button
            class="row channel"
            data-url=${channel.url}
            data-list=${listId}
            tabindex="-1"
            onClick=${open}
        >
            <span class="num">${props.number}</span>
            <span class="thumb" style=${logoStyle(channel.logo)}>
                ${channel.logo ? null : html`<span class="thumb-letter">${initial(channel.name)}</span>`}
            </span>
            <span class="row-main">
                <span class="row-name">${channel.name}</span>
                ${
                    props.detail && now
                        ? html`<span class="row-sub">${now}</span>`
                        : props.showGroup
                          ? html`<span class="row-sub">${channel.group || ""}</span>`
                          : null
                }
            </span>
            ${!props.detail && now ? html`<span class="row-now">${now}</span>` : null}
            ${props.saved ? html`<span class="saved">★</span>` : null}
        </button>`
    }

    function ChannelList(props) {
        const view = props.view
        function listOf(channel) {
            return props.listId || channel.listId
        }
        return html`<div class="rows" id=${props.id}>
            ${view.total ? null : html`<p class="empty">${view.empty || "No channels."}</p>`}
            ${view.items.map((channel, index) => {
                return html`<${ChannelRow}
                    key=${channel.url || channel.cmd || index}
                    channel=${channel}
                    listId=${listOf(channel)}
                    number=${index + 1}
                    source=${view.items}
                    showGroup=${view.showGroup}
                    detail=${props.detail}
                    saved=${store.isFavorite(listOf(channel), channel.url)}
                />`
            })}
        </div>`
    }

    function SourceRow(props) {
        const channels = props.channels
        const isTg = store.listKind(props.list) === "telegram"
        const botName =
            props.list.botUsername ||
            (isTg && App.telegramService
                ? App.telegramService.getBotUsername(props.list.token)
                : null)
        const sub = isTg
            ? botName
                ? `@${botName}`
                : "Telegram Bot"
            : props.list.url || props.list.origin || ""
        const countText = isTg ? "Bot" : channels ? store.formatCount(channels.length) : "—"

        return html`<div
            class="row source"
            data-list=${props.list.id}
            tabindex="-1"
            onClick=${function () {
                if (isTg) {
                    store.openEdit(props.list.id)
                } else {
                    store.openSource(props.list.id)
                }
            }}
        >
            <span class="kind">${store.listLabel(props.list)}</span>
            <span class="row-main">
                <span class="row-name">${props.list.name || "Telegram Bot"}</span>
                <span class="row-sub">${sub}</span>
            </span>
            <span class="row-count">${countText}</span>
            <button
                class="edit"
                data-list=${props.list.id}
                tabindex="-1"
                aria-label="Edit source"
                onClick=${function (event) {
                    event.stopPropagation()
                    store.openEdit(props.list.id)
                }}
            >
                ${iconPencil}<span>Edit</span>
            </button>
        </div>`
    }

    function AddRow() {
        return html`<button
            class="row add"
            tabindex="-1"
            onClick=${function () {
                store.openAdd()
            }}
        >
            <span class="kind">+</span>
            <span class="row-main">
                <span class="row-name">Add source</span>
                <span class="row-sub">M3U, Xtream, Stalker or pasted text</span>
            </span>
        </button>`
    }

    function Search(props) {
        const inputRef = useRef(null)
        const timer = useRef(null)
        const [hasValue, setHasValue] = useState(false)

        useEffect(() => {
            if (inputRef.current) {
                const v = props.value !== undefined ? props.value : store.searchOf(props.scope)
                inputRef.current.value = v
                setHasValue(!!v)
            }
        }, [props.scope, props.resetKey, props.value])

        function onInput(event) {
            const value = event.target.value
            setHasValue(!!value)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                props.onInput(value)
            }, SEARCH_DEBOUNCE_MS)
        }

        function onClear() {
            if (inputRef.current) {
                inputRef.current.value = ""
                inputRef.current.focus()
            }
            setHasValue(false)
            if (timer.current) clearTimeout(timer.current)
            props.onInput("")
            if (props.onClear) props.onClear()
        }

        return html`<div class=${`search-split${hasValue ? " has-clear" : ""}`}>
            <div class="search">
                ${iconSearch}
                <input
                    id=${props.id}
                    ref=${inputRef}
                    type="text"
                    placeholder=${props.placeholder}
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    tabindex="-1"
                    onInput=${onInput}
                />
                ${
                    props.count !== undefined && props.count !== null && props.count !== ""
                        ? html`<span class="search-count" id=${props.countId}>${props.count}</span>`
                        : null
                }
            </div>
            ${
                hasValue
                    ? html`<button
                          class="search-clear"
                          tabindex="-1"
                          aria-label="Clear search"
                          onClick=${onClear}
                      >
                          ${iconClose}
                      </button>`
                    : null
            }
        </div>`
    }

    function Bar(props) {
        return html`<header class="bar">
            <div class="bar-text">
                <h1 id=${props.titleId}>${props.title}</h1>
                <p class="meta" id=${props.metaId}>${props.meta}</p>
            </div>
            ${props.actions || null} ${props.search || null}
        </header>`
    }

    return {
        html,
        store,
        useState,
        useEffect,
        useRef,
        TYPE_ICONS,
        ADD_TYPES,
        FIELD_SETS,
        clock,
        svg,
        initial,
        logoStyle,
        programText,
        iconCheck,
        Rail,
        Bar,
        Search,
        ChannelRow,
        ChannelList,
        SourceRow,
        AddRow,
    }
})()
