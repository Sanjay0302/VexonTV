var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.store = (function () {
    const KEYS = {
        lists: "ts.lists",
        favorites: "ts.favorites",
        recent: "ts.recent",
        filter: "ts.filter",
        search: "ts.search.",
        seeded: "ts.seeded",
    }

    const DEFAULT_LIST = {
        url: "https://iptv-org.github.io/iptv/index.country.m3u",
        name: "Free channels of the world",
    }
    const MAX_TILES = 200
    const MAX_RECENT = 12
    const TOAST_MS = 3600
    // A channel number typed on the remote commits by itself after this.
    const DIGITS_MS = 2200
    // How long a programme listing is trusted before asking the panel again.
    const PROGRAM_MS = 10 * 60 * 1000

    const TYPES = [
        { id: "all", label: "All" },
        { id: "m3u", label: "M3U" },
        { id: "xtream", label: "Xtream" },
        { id: "stalker", label: "Stalker" },
    ]

    const state = {
        screen: "home",
        lists: [],
        channels: {},
        groups: {},
        pending: {},
        flat: null,
        favorites: [],
        recent: [],
        programs: {},
        filter: "all",
        tvSource: null,
        editId: null,
        catDraft: null,
        catSearch: "",
        catName: "",
        loadProgress: {},
        search: {},
        playing: null,
        zapOpen: false,
        favZapOpen: false,
        menuFocus: false,
        preview: null,
        zapCategory: "",
        playStatus: "idle",
        playError: null,
        zapping: [],
        zapIndex: 0,
        nowProgram: null,
        nextProgram: null,
        numBuffer: "",
        confirm: null,
        loading: null,
        toast: null,
        pendingZone: null,
    }

    const PROGRESS_MS = 250

    let listeners = []
    let loadTick = null
    let toastSeq = 0
    let toastTimer = null
    let digitsTimer = null

    function subscribe(fn) {
        listeners.push(fn)
        return function () {
            listeners = listeners.filter((item) => {
                return item !== fn
            })
        }
    }

    function emit() {
        for (let i = 0; i < listeners.length; i++) listeners[i]()
    }

    function set(patch) {
        for (const key in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) state[key] = patch[key]
        }
        emit()
    }

    function focus(zone, row, col) {
        state.pendingZone = { zone, row: row || 0, col: col || 0 }
    }

    function takeFocus() {
        const request = state.pendingZone
        state.pendingZone = null
        return request
    }

    function read(key, fallback) {
        try {
            const raw = localStorage.getItem(key)
            return raw ? JSON.parse(raw) : fallback
        } catch {
            return fallback
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value))
        } catch {}
    }

    function formatCount(value) {
        return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    }

    function seedDefault() {
        if (state.lists.length) return
        if (read(KEYS.seeded, false)) return
        const built = buildSource("url", { url: DEFAULT_LIST.url, name: DEFAULT_LIST.name })
        if (!built.list) return
        state.lists = [built.list]
        write(KEYS.lists, state.lists)
        write(KEYS.seeded, true)
    }

    function init() {
        state.lists = read(KEYS.lists, []) || []
        state.favorites = read(KEYS.favorites, []) || []
        state.recent = read(KEYS.recent, []) || []
        state.filter = read(KEYS.filter, "all") || "all"
        seedDefault()
    }

    function zoneFor(screen) {
        if (screen === "tv") return "tvCats"
        if (screen === "recents") return "recentsList"
        if (screen === "favs") return "favsList"
        if (screen === "home") return "sources"
        return null
    }

    function listById(id) {
        for (let i = 0; i < state.lists.length; i++) {
            if (state.lists[i].id === id) return state.lists[i]
        }
        return null
    }

    function listKind(list) {
        if (!list) return "m3u"
        if (list.kind) return list.kind
        return list.user ? "xtream" : "m3u"
    }

    function listLabel(list) {
        if (listKind(list) === "xtream") return "Xtream"
        if (listKind(list) === "stalker") return "Stalker"
        return list.source === "text" ? "Text" : "M3U"
    }

    function channelsOf(listId) {
        return state.channels[listId] || []
    }
    function groupsOf(listId) {
        return state.groups[listId] || []
    }

    function isMuted(list, group) {
        return !!(list && list.muted && list.muted.indexOf(group) !== -1)
    }

    function groupNames(channels) {
        const seen = {},
            names = []
        for (let i = 0; i < channels.length; i++) {
            const group = channels[i].group || "Otros"
            if (!seen[group]) {
                seen[group] = 1
                names.push(group)
            }
        }
        names.sort((a, b) => {
            return a.localeCompare(b, "en")
        })
        return names
    }

    function sources() {
        const counts = { all: state.lists.length, m3u: 0, xtream: 0, stalker: 0 }
        state.lists.forEach((list) => {
            const kind = listKind(list)
            counts[kind] = (counts[kind] || 0) + 1
        })
        return {
            items:
                state.filter === "all"
                    ? state.lists
                    : state.lists.filter((list) => {
                          return listKind(list) === state.filter
                      }),
            types: TYPES.map((type) => {
                return {
                    id: type.id,
                    label: type.label,
                    count: counts[type.id] || 0,
                    selected: type.id === state.filter,
                }
            }),
        }
    }

    function setFilter(id) {
        state.filter = id
        write(KEYS.filter, id)
        set({ filter: id })
        focus("sources")
    }

    function allChannels() {
        if (state.flat) return state.flat
        const flat = []
        state.lists.forEach((list) => {
            const channels = state.channels[list.id]
            if (!channels) return
            for (let i = 0; i < channels.length; i++) {
                channels[i].listId = list.id
                if (!isMuted(list, channels[i].group || "Otros")) flat.push(channels[i])
            }
        })
        state.flat = flat
        return flat
    }

    function invalidate() {
        state.flat = null
    }

    function channelByUrl(url, listId) {
        const pools = [channelsOf(listId), state.favorites, state.recent]
        for (let p = 0; p < pools.length; p++) {
            for (let i = 0; i < pools[p].length; i++) {
                if (pools[p][i].url === url) return pools[p][i]
            }
        }
        return null
    }

    function startLoadEntry(key, name) {
        state.loadProgress[key] = {
            since: Date.now(),
            at: 0,
            lastCount: -1,
            label: "Connecting",
            name,
        }
    }

    // A list that was imported before is not downloaded again: it resyncs, and the
    // notice says so. The first time it really is a download.
    function progressOf(listId, update, list) {
        if (list && list.imported && update.label === "Downloading") update.label = "Syncing"
        return progressOfEntry(listId, update)
    }

    function progressOfEntry(listId, update) {
        const entry = state.loadProgress[listId] || {
            since: Date.now(),
            at: 0,
            lastCount: -1,
            label: "Connecting",
        }
        entry.label = update.label || entry.label
        if (update.count !== undefined) entry.count = update.count

        const now = Date.now()
        const jumped = entry.count !== undefined && entry.count - entry.lastCount >= 500
        const stale = now - entry.at >= PROGRESS_MS
        entry.phase = update.label

        if (update.count !== undefined && !stale && !jumped) {
            state.loadProgress[listId] = entry
            return
        }
        entry.at = now
        if (entry.count !== undefined) entry.lastCount = entry.count
        state.loadProgress[listId] = entry
        emit()
    }

    function elapsedOf(entry) {
        return Math.max(0, Math.round((Date.now() - entry.since) / 1000))
    }

    function loadingRows() {
        return Object.keys(state.loadProgress).map((key) => {
            const entry = state.loadProgress[key]
            return {
                key,
                name: entry.name || "Fuente",
                label: entry.label,
                count: entry.count,
            }
        })
    }

    function showNotice(eyebrow, title) {
        state.loading = { eyebrow, title, since: Date.now() }
        noticeTick()
    }

    function hideNotice() {
        if (!state.loading) return
        state.loading = null
        noticeTick()
    }

    function anythingLoaded() {
        return state.lists.some((list) => {
            return state.channels[list.id] && state.channels[list.id].length
        })
    }

    function storeChannels(listId, channels) {
        state.channels[listId] = channels
        state.groups[listId] = groupNames(channels)
        invalidate()
    }

    function ensureChannels(listId) {
        if (state.channels[listId]) return Promise.resolve(state.channels[listId])
        if (state.pending[listId]) return state.pending[listId]

        const list = listById(listId)
        if (!list) return Promise.reject(new Error("That source is gone"))

        startLoadEntry(listId, list.name)
        emit()

        const promise = App.api
            .load(list, (update) => {
                progressOf(listId, update, list)
            })
            .then((channels) => {
                list.imported = true
                write(KEYS.lists, state.lists)
                storeChannels(listId, channels)
                delete state.pending[listId]
                delete state.loadProgress[listId]
                emit()
                return channels
            })
            .catch((error) => {
                delete state.pending[listId]
                delete state.loadProgress[listId]
                emit()
                throw error
            })

        state.pending[listId] = promise
        return promise
    }

    function buildSource(type, fields) {
        fields = fields || {}
        const name = (fields.name || "").trim()
        const url = (fields.url || "").trim()
        const origin = (fields.origin || "").trim()

        if (type === "auto") {
            const guess = App.api.parseAuto(fields.text, name)
            if (guess.error) return guess
            return { list: decorate(guess.list) }
        }

        if (type === "raw") {
            if (!/(^#EXTM3U)|(#EXTINF)/i.test(fields.text || "")) {
                return { error: "That text does not look like an M3U playlist" }
            }
            return {
                list: decorate({
                    kind: "m3u",
                    source: "text",
                    text: fields.text,
                    name: name || "Pasted list",
                }),
            }
        }

        if (type === "file") {
            if (!fields.text) return { error: "Choose an .m3u file first" }
            return {
                list: decorate({
                    kind: "m3u",
                    source: "text",
                    text: fields.text,
                    name: name || fields.fileName || "Local list",
                }),
            }
        }

        if (type === "xtream") {
            if (!/^https?:\/\//i.test(origin))
                return { error: "The server must start with http:// or https://" }
            if (!fields.user || !fields.pass)
                return { error: "An Xtream portal needs a username and password" }
            return {
                list: decorate({
                    kind: "xtream",
                    source: "creds",
                    origin: origin.replace(/\/+$/, ""),
                    user: fields.user,
                    pass: fields.pass,
                    name: name || App.api.hostOf(origin),
                }),
            }
        }

        if (type === "stalker") {
            if (!/^https?:\/\//i.test(origin) && !/^https?:\/\//i.test(url))
                return { error: "The portal must start with http:// or https://" }
            const mac = (fields.mac || "").trim().toUpperCase()
            if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac))
                return { error: "The MAC must look like 00:1A:79:12:34:56" }
            return {
                list: decorate({
                    kind: "stalker",
                    source: "mac",
                    origin: (origin || url).replace(/\/+$/, ""),
                    mac,
                    name: name || App.api.hostOf(origin || url),
                }),
            }
        }

        if (!/^https?:\/\/.+/i.test(url))
            return { error: "The address must start with http:// or https://" }
        const inline = App.api.parseXtreamUrl(url)
        if (inline) {
            return {
                list: decorate({
                    kind: "xtream",
                    source: "url",
                    url,
                    origin: inline.origin,
                    user: inline.user,
                    pass: inline.pass,
                    name: name || App.api.hostOf(url),
                }),
            }
        }
        return {
            list: decorate({ kind: "m3u", source: "url", url, name: name || deriveName(url) }),
        }
    }

    function decorate(list) {
        list.id = list.id || `l${Date.now()}${Math.floor(Math.random() * 1000)}`
        if (!list.url && list.source === "text") list.url = "texto"
        if (!list.url) list.url = list.origin || ""
        return list
    }

    function deriveName(url) {
        const host = App.api.hostOf(url)
        const file = (url.match(/\/([^\/?#]+?)(?:\.m3u8?)?(?:[?#]|$)/i) || [])[1]
        return file && !/\.(php|aspx?|cgi|json)$/i.test(file) ? file : host
    }

    function addList(list) {
        showNotice("Checking", list.name)
        startLoadEntry("draft", list.name)
        emit()
        return App.api
            .load(list, (update) => {
                progressOf("draft", update, list)
            })
            .then((channels) => {
                list.imported = true
                storeChannels(list.id, channels)
                state.lists = state.lists.concat([list])
                write(KEYS.lists, state.lists)
                delete state.loadProgress.draft
                hideNotice()
                notify(`Added: ${formatCount(channels.length)} channels`)
                goHome()
                return channels
            })
            .catch((error) => {
                delete state.loadProgress.draft
                hideNotice()
                emit()
                throw error
            })
    }

    function updateList(listId, fields) {
        const list = listById(listId)
        if (!list) return Promise.reject(new Error("That source is gone"))

        const draft = {
            id: list.id,
            kind: list.kind,
            source: list.source,
            text: list.text,
            muted: list.muted,
            mac: list.mac,
        }
        const built = buildSource(fields.type || "url", {
            url: fields.url || list.url,
            origin: fields.origin || list.origin,
            user: fields.user,
            pass: fields.pass,
            mac: fields.mac,
            text: fields.text || list.text,
            name: fields.name,
        })
        if (built.error) return Promise.reject(new Error(built.error))
        if (list.imported) draft.imported = true
        for (const key in built.list) {
            if (built.list[key] !== undefined) draft[key] = built.list[key]
        }
        draft.id = list.id

        showNotice("Checking", draft.name || list.name)
        startLoadEntry("draft", draft.name || list.name)
        emit()

        return App.api
            .load(draft, (update) => {
                progressOf("draft", update, list)
            })
            .then((channels) => {
                draft.imported = true
                storeChannels(list.id, channels)
                state.lists = state.lists.map((item) => {
                    return item.id === list.id ? draft : item
                })
                write(KEYS.lists, state.lists)
                delete state.loadProgress.draft
                hideNotice()
                notify(`Updated: ${formatCount(channels.length)} channels`)
                goHome()
                return channels
            })
            .catch((error) => {
                delete state.loadProgress.draft
                hideNotice()
                emit()
                throw error
            })
    }

    function removeList(listId) {
        state.lists = state.lists.filter((list) => {
            return list.id !== listId
        })
        delete state.channels[listId]
        delete state.groups[listId]
        delete state.pending[listId]
        write(KEYS.lists, state.lists)
        invalidate()
        emit()
    }

    function loadWithNotice(listIds, title) {
        showNotice("Loading", title)
        emit()

        function maybeDismiss() {
            if (state.loading && anythingLoaded()) {
                hideNotice()
                emit()
            }
        }

        return Promise.all(
            listIds.map((listId) => {
                return ensureChannels(listId).then(maybeDismiss, (error) => {
                    const list = listById(listId)
                    maybeDismiss()
                    notify((list ? `${list.name}: ` : "") + error.message)
                })
            }),
        ).then(() => {
            if (state.loading) {
                hideNotice()
                emit()
            }
        })
    }

    function noticeTick() {
        if (state.loading && !loadTick) {
            loadTick = setInterval(() => {
                emit()
            }, 1000)
        } else if (!state.loading && loadTick) {
            clearInterval(loadTick)
            loadTick = null
        }
    }

    function openCategories() {
        const draft = {}
        state.lists.forEach((list) => {
            draft[list.id] = (list.muted || []).slice()
        })
        set({ screen: "cats", catDraft: draft, catSearch: "" })
        focus("catSearch")
    }

    function categoriesView() {
        const needle = (state.catSearch || "").trim().toLowerCase()
        const sections = []
        let total = 0,
            selected = 0

        state.lists.forEach((list) => {
            const channels = channelsOf(list.id)
            if (!channels.length) return
            const counts = {}
            channels.forEach((channel) => {
                const group = channel.group || "Otros"
                counts[group] = (counts[group] || 0) + 1
            })
            const muted = state.catDraft ? state.catDraft[list.id] || [] : list.muted || []
            const groups = Object.keys(counts)
                .sort((a, b) => {
                    return a.localeCompare(b, "en")
                })
                .filter((group) => {
                    return !needle || group.toLowerCase().indexOf(needle) !== -1
                })
                .map((group) => {
                    const enabled = muted.indexOf(group) === -1
                    total++
                    if (enabled) selected++
                    return { name: group, count: counts[group], enabled, listId: list.id }
                })
            if (groups.length) sections.push({ list, groups })
        })

        return { sections, total, selected }
    }

    function toggleCategory(listId, group) {
        const muted = (state.catDraft[listId] || []).slice()
        const index = muted.indexOf(group)
        if (index === -1) muted.push(group)
        else muted.splice(index, 1)
        state.catDraft[listId] = muted
        emit()
    }

    function setAllCategories(enabled) {
        const draft = {}
        state.lists.forEach((list) => {
            draft[list.id] = enabled ? [] : groupsOf(list.id).slice()
        })
        set({ catDraft: draft })
    }

    function saveCategories() {
        state.lists = state.lists.map((list) => {
            const muted = state.catDraft[list.id]
            if (!muted) return list
            const copy = {}
            for (const key in list) {
                if (Object.prototype.hasOwnProperty.call(list, key)) copy[key] = list[key]
            }
            if (muted.length) copy.muted = muted.slice()
            else delete copy.muted
            return copy
        })
        write(KEYS.lists, state.lists)
        invalidate()
        state.catDraft = null
        set({ screen: "tv" })
        notify("Categories saved")
        focus("tvSearch")
    }

    function setCatSearch(value) {
        set({ catSearch: value })
    }

    function goHome() {
        set({ screen: "home" })
        focus("sources")
    }

    function openTv() {
        set({ screen: "tv", tvSource: null, preview: null })
        focus("tvSearch")
        const todo = state.lists
            .filter((list) => {
                return !state.channels[list.id] && !state.pending[list.id]
            })
            .map((list) => {
                return list.id
            })
        if (todo.length) {
            loadWithNotice(todo, todo.length === 1 ? listById(todo[0]).name : "your sources")
        }
    }

    function openSource(listId) {
        if (!listById(listId)) return
        set({ screen: "tv", tvSource: listId, preview: null })
        focus("tvSearch")
        if (!state.channels[listId] && !state.pending[listId]) {
            loadWithNotice([listId], listById(listId).name)
        }
    }

    function backToTv() {
        let index = 0
        const rows = tvCategories().rows
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].name === state.catName) {
                index = i
                break
            }
        }
        set({ screen: "tv" })
        focus("tvCats", index)
    }

    function openTvCategory(name) {
        const patch = { catName: name }
        if (state.preview && state.catName !== name) patch.preview = null
        set(patch)
        focus("tvChannels", 0, 0)
    }

    function selectPreview(channel) {
        if (!channel || !channel.url) return
        if (state.preview && state.preview.url === channel.url) return
        set({ preview: channel })
    }

    function openRecents() {
        set({ screen: "recents" })
        focus("recentsSearch")
    }

    function openFavorites() {
        state.search.favorites = read(`${KEYS.search}favorites`, "") || ""
        set({ screen: "favs" })
        focus("favsSearch")
    }

    function openAdd() {
        set({ screen: "add", addType: null })
        focus("addTypes")
    }

    function chooseType(type) {
        set({ addType: type })
        focus("fields")
    }

    function openEdit(listId) {
        const list = listById(listId)
        if (!list) return
        set({ screen: "edit", editId: listId })
        focus("fields")
    }

    function setSearch(scope, value) {
        state.search[scope] = value
        write(KEYS.search + scope, value)
        emit()
    }

    function searchOf(scope) {
        return state.search[scope] || ""
    }

    function pushDigit(digit) {
        state.numBuffer = (state.numBuffer + digit).slice(0, 4)
        emit()
        if (digitsTimer) clearTimeout(digitsTimer)
        digitsTimer = setTimeout(() => {
            state.numBuffer = ""
            emit()
        }, DIGITS_MS)
    }

    function clearDigits() {
        if (!state.numBuffer) return false
        state.numBuffer = ""
        if (digitsTimer) clearTimeout(digitsTimer)
        emit()
        return true
    }

    function jumpTo(number) {
        const index = parseInt(number, 10) - 1
        state.numBuffer = ""
        if (digitsTimer) clearTimeout(digitsTimer)

        // In player context: number + Enter directly plays favorite #N
        if (state.screen === "player") {
            const channel = state.favorites[index]
            if (!channel) {
                notify(`No favorite #${number}`)
                emit()
                return
            }
            const listId = channel.listId || (state.playing && state.playing.listId)
            if (state.favZapOpen) state.favZapOpen = false
            play(channel, listId, state.favorites.slice())
            return
        }

        const view = currentView()
        if (!view || !view.items[index]) {
            notify(`No channel ${number} on this screen`)
            emit()
            return
        }
        emit()
        focus(view.zone, index, 0)
    }

    function commitDigits() {
        if (!state.numBuffer) return false
        jumpTo(state.numBuffer)
        return true
    }

    function favoriteIndex(listId, url) {
        for (let i = 0; i < state.favorites.length; i++) {
            const favorite = state.favorites[i]
            if (favorite.listId === listId && favorite.url === url) return i
        }
        return -1
    }

    function isFavorite(listId, url) {
        return favoriteIndex(listId, url) !== -1
    }

    function asSaved(channel, listId) {
        return {
            listId,
            url: channel.url,
            name: channel.name,
            group: channel.group,
            logo: channel.logo,
        }
    }

    function toggleFavorite(channel, listId) {
        const index = favoriteIndex(listId, channel.url)
        if (index === -1) {
            state.favorites = state.favorites.concat([asSaved(channel, listId)])
            write(KEYS.favorites, state.favorites)
            emit()
            return true
        }
        state.favorites = state.favorites.slice(0, index).concat(state.favorites.slice(index + 1))
        write(KEYS.favorites, state.favorites)
        emit()
        return false
    }

    function pushRecent(channel, listId) {
        state.recent = [asSaved(channel, listId)]
            .concat(
                state.recent.filter((item) => {
                    return item.url !== channel.url
                }),
            )
            .slice(0, MAX_RECENT)
        write(KEYS.recent, state.recent)
    }

    function programOf(channel) {
        const entry = channel && channel.url ? state.programs[channel.url] : null
        return entry && entry.list && entry.list.length ? entry.list[0] : null
    }

    function nextOf(channel) {
        const entry = channel && channel.url ? state.programs[channel.url] : null
        return entry && entry.list && entry.list.length > 1 ? entry.list[1] : null
    }

    function loadProgramFor(channel) {
        if (!channel || !channel.url || !App.api.loadNowPlaying) return
        if (!App.api.parseLiveUrl(channel.url)) return

        const cached = state.programs[channel.url]
        if (cached && Date.now() - cached.at < PROGRAM_MS) return

        state.programs[channel.url] = { list: [], at: Date.now() }
        App.api
            .loadNowPlaying(channel.url)
            .then((list) => {
                state.programs[channel.url] = { list: list || [], at: Date.now() }
                if (state.playing && state.playing.channel.url === channel.url) {
                    state.nowProgram = programOf(channel)
                    state.nextProgram = nextOf(channel)
                }
                emit()
            })
            .catch(() => {})
    }

    function programProgress(program) {
        if (!program || !program.start || !program.end) return null
        const start = Date.parse(String(program.start).replace(" ", "T"))
        const end = Date.parse(String(program.end).replace(" ", "T"))
        if (isNaN(start) || isNaN(end) || end <= start) return null
        const ratio = (Date.now() - start) / (end - start)
        return Math.max(0, Math.min(100, Math.round(ratio * 100)))
    }

    function refreshProgram() {
        if (!state.playing) return
        state.nowProgram = programOf(state.playing.channel)
        state.nextProgram = nextOf(state.playing.channel)
        const cached = state.programs[state.playing.channel.url]
        if (!cached || Date.now() - cached.at > PROGRAM_MS) loadProgramFor(state.playing.channel)
        emit()
    }

    function focusChanged(element) {
        if (!element || !element.dataset || !element.dataset.url) return
        const channel = channelByUrl(element.dataset.url, element.dataset.list)
        if (!channel) return
        loadProgramFor(channel)
    }

    function play(channel, listId, list) {
        if (!listId && channel.listId) listId = channel.listId
        const list_ = listById(listId)
        const origin =
            state.screen === "player" && state.playing
                ? state.playing.origin
                : { screen: state.screen, zone: zoneFor(state.screen) }

        state.playing = { channel, listId, origin }
        state.playStatus = "opening"
        state.playError = null
        state.zapping = list && list.length ? list : [channel]
        state.zapIndex = Math.max(0, state.zapping.indexOf(channel))
        state.nowProgram = programOf(channel)
        state.nextProgram = nextOf(channel)
        state.preview = channel
        pushRecent(channel, listId)

        if (!channel.url && channel.cmd && listKind(list_) === "stalker") {
            set({ screen: "player" })
            focus("playerIdle")
            App.api
                .resolveStalkerUrl(list_, channel)
                .then((url) => {
                    channel.url = url
                    play(channel, listId, list)
                })
                .catch((error) => {
                    playFailed(error.message)
                })
            return
        }

        set({ screen: "player" })
        focus("playerIdle")
        loadProgramFor(channel)
    }

    function playStarted() {
        if (state.playStatus === "opening") set({ playStatus: "playing" })
    }

    function playFailed(message) {
        if (state.screen !== "player") return
        set({
            playStatus: "error",
            menuFocus: false,
            playError: { message: message || "Could not open the channel" },
        })
        focus("playError")
    }

    function retryPlay() {
        if (!state.playing) return
        const playing = state.playing
        set({ playStatus: "opening", playError: null })
        focus("playerIdle")
        state.playing = { channel: playing.channel, listId: playing.listId, origin: playing.origin }
        emit()
    }

    function setMenuFocus(on) {
        if (state.menuFocus === on) return
        set({ menuFocus: on })
    }

    function openZap() {
        const rows = tvCategories().rows
        const playing = state.playing && state.playing.channel ? state.playing.channel.group : ""
        const current = playing || state.zapCategory || state.catName
        let exists = false
        for (let i = 0; i < rows.length; i++) if (rows[i].name === current) exists = true
        state.zapCategory = exists ? current : rows[0] ? rows[0].name : ""
        set({ zapOpen: true, menuFocus: false })
        focus("zapChannels", zapChannelIndex(), 0)
    }

    function closeZap() {
        set({ zapOpen: false, menuFocus: false })
        focus("playerIdle")
    }

    function openFavZap() {
        set({ favZapOpen: true, menuFocus: false })
        focus("zapFavChannels", favZapChannelIndex(), 0)
    }

    function closeFavZap() {
        set({ favZapOpen: false, menuFocus: false })
        focus("playerIdle")
    }

    function favZapChannelIndex() {
        const url = state.playing && state.playing.channel ? state.playing.channel.url : null
        for (let i = 0; i < state.favorites.length; i++) {
            if (state.favorites[i].url === url) return i
        }
        return 0
    }

    function zapToFav(channel) {
        if (!channel || !channel.url) return
        if (state.screen !== "player") return
        if (state.playing && state.playing.channel.url === channel.url) {
            closeFavZap()
            return
        }
        play(channel, channel.listId || state.playing.listId, state.favorites.slice())
        closeFavZap()
    }

    function zapCategories() {
        const playing =
            state.playing && state.playing.channel ? state.playing.channel.group || "Otros" : ""
        const count = {}
        allChannels().forEach((channel) => {
            const group = channel.group || "Otros"
            count[group] = (count[group] || 0) + 1
        })
        return tvCategories().rows.map((row) => {
            return {
                name: row.name,
                count: row.count,
                selected: row.name === state.zapCategory,
                playing: row.name === playing,
            }
        })
    }

    function zapChannels() {
        const cat = state.zapCategory || state.catName
        return allChannels().filter((channel) => {
            return (channel.group || "Otros") === cat
        })
    }

    function zapChannelIndex() {
        const list = zapChannels()
        const url = state.playing && state.playing.channel ? state.playing.channel.url : null
        for (let i = 0; i < list.length; i++) if (list[i].url === url) return i
        return 0
    }

    function setZapCategory(name) {
        state.zapCategory = name
        emit()
        focus("zapChannels", 0, 0)
    }

    function zapTo(channel) {
        if (!channel || !channel.url) return
        if (state.screen !== "player") return
        if (state.playing && state.playing.channel.url === channel.url) {
            closeZap()
            return
        }
        play(channel, channel.listId || state.playing.listId, zapChannels())
        closeZap()
    }

    function zap(delta) {
        if (!state.playing || state.zapping.length < 2) return
        state.zapIndex = (state.zapIndex + delta + state.zapping.length) % state.zapping.length
        const channel = state.zapping[state.zapIndex]
        play(channel, channel.listId || state.playing.listId, state.zapping)
    }

    function exitPlayer() {
        const origin = state.playing ? state.playing.origin : null
        state.playing = null
        state.nowProgram = null
        state.nextProgram = null
        state.playStatus = "idle"
        state.playError = null
        state.zapOpen = false
        state.favZapOpen = false
        state.menuFocus = false
        if (origin && origin.screen) {
            set({ screen: origin.screen })
            focus(origin.zone)
            return
        }
        goHome()
    }

    function notify(message) {
        toastSeq++
        state.toast = { message, id: toastSeq }
        emit()
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
            state.toast = null
            emit()
        }, TOAST_MS)
    }

    function setLoading(visible, label) {
        if (visible) showNotice("Opening", label || "the channel")
        else hideNotice()
        emit()
    }

    function askConfirm(message, onAccept) {
        set({ confirm: { message, onAccept, returnScreen: state.screen } })
        focus("confirm", 0, 0)
    }

    function closeConfirm() {
        const screen = state.confirm ? state.confirm.returnScreen : null
        set({ confirm: null })
        if (screen === "edit") focus("fields")
        else goHome()
    }

    function view(source, scope, options) {
        options = options || {}
        const needle = searchOf(scope).trim()
        const filtered = needle ? App.api.match(source, needle) : source
        const total = filtered.length
        let label = options.label || ""

        if (needle)
            label = `${formatCount(total) + (total === 1 ? " result" : " results")} for “${needle}”`
        if (total > MAX_TILES) label += ` · ${formatCount(MAX_TILES)} shown, refine your search`

        return {
            items: filtered.slice(0, MAX_TILES),
            total,
            count: needle ? formatCount(total) : "",
            label,
            collapsed: !!needle,
            zone: options.zone,
            showGroup: !!options.showGroup,
            empty: options.empty || "",
        }
    }

    function tvCategories() {
        const counts = {},
            lists = {}
        const scope = state.tvSource
        allChannels().forEach((channel) => {
            if (scope && channel.listId !== scope) return
            const group = channel.group || "Otros"
            counts[group] = (counts[group] || 0) + 1
            lists[group] = lists[group] || {}
            lists[group][channel.listId] = 1
        })

        const needle = searchOf("tv").trim().toLowerCase()
        const names = Object.keys(counts).sort((a, b) => {
            return a.localeCompare(b, "en")
        })
        const rows = names.map((name) => {
            return { name, count: counts[name], sources: Object.keys(lists[name]).length }
        })
        const visible = needle
            ? rows.filter((row) => {
                  return row.name.toLowerCase().indexOf(needle) !== -1
              })
            : rows
        let channels = 0
        allChannels().forEach((channel) => {
            if (!scope || channel.listId === scope) channels++
        })
        const list = scope ? listById(scope) : null
        return {
            rows: visible,
            total: rows.length,
            count: needle ? formatCount(visible.length) : "",
            label: `${
                (list ? `${list.name} · ` : "") +
                formatCount(rows.length) +
                (rows.length === 1 ? " category" : " categories")
            } · ${formatCount(channels)} channels`,
        }
    }

    function visibleTvCategory() {
        const scope = state.tvSource
        const needle = searchOf("tvch").trim()

        if (needle) {
            // Channel search: search across all channels by name
            const allCh = allChannels().filter((channel) => {
                if (scope && channel.listId !== scope) return false
                return true
            })
            const result = view(allCh, "tvch", {
                zone: "tvChannels",
                empty: "No channels match your search.",
                showGroup: true,
            })
            result.showGroup = true
            return result
        }

        const channels = allChannels().filter((channel) => {
            if (scope && channel.listId !== scope) return false
            return (channel.group || "Otros") === state.catName
        })
        const result = view(channels, "tvchannels", {
            zone: "tvChannels",
            empty: "This category has no channels left.",
        })
        result.label = `${
            formatCount(result.total) + (result.total === 1 ? " channel" : " channels")
        } in ${state.catName}`
        if (result.total > MAX_TILES)
            result.label += ` · ${formatCount(MAX_TILES)} shown, refine your search`
        return result
    }

    function visibleRecents() {
        const result = view(state.recent, "recents", { zone: "recentsList", showGroup: true })
        if (!result.count) {
            result.label =
                state.recent.length === 1
                    ? "1 channel"
                    : `${formatCount(state.recent.length)} channels`
        }
        return result
    }

    function visibleFavorites() {
        const result = view(state.favorites, "favorites", { zone: "favsList", showGroup: true })
        if (!result.count) {
            result.label =
                state.favorites.length === 1
                    ? "1 saved channel"
                    : `${formatCount(state.favorites.length)} saved channels`
        }
        return result
    }

    function currentView() {
        if (state.favZapOpen) return { items: state.favorites, zone: "zapFavChannels" }
        if (state.screen === "tv") return visibleTvCategory()
        if (state.screen === "recents") return visibleRecents()
        if (state.screen === "favs") return visibleFavorites()
        return null
    }

    function stats() {
        const lists = state.lists.length
        let channels = 0
        state.lists.forEach((list) => {
            if (state.channels[list.id]) channels += state.channels[list.id].length
        })
        let counts = lists === 0 ? "No sources" : lists === 1 ? "1 source" : `${lists} sources`
        if (channels) counts += `, ${formatCount(channels)} channels`
        return { counts, favorites: state.favorites.length, recent: state.recent.length }
    }

    return {
        state,
        subscribe,
        init,
        takeFocus,
        focus,
        focusChanged,
        listById,
        listKind,
        listLabel,
        channelsOf,
        groupsOf,
        groupNames,
        allChannels,
        sources,
        setFilter,
        ensureChannels,
        buildSource,
        addList,
        updateList,
        removeList,
        goHome,
        openTv,
        openRecents,
        openFavorites,
        openAdd,
        chooseType,
        openEdit,
        openCategories,
        categoriesView,
        toggleCategory,
        setAllCategories,
        saveCategories,
        setCatSearch,
        setSearch,
        searchOf,
        isFavorite,
        toggleFavorite,
        programOf,
        programProgress,
        refreshProgram,
        nextOf,
        loadProgramFor,
        play,
        zap,
        openZap,
        closeZap,
        openFavZap,
        closeFavZap,
        zapToFav,
        setMenuFocus,
        zapCategories,
        zapChannels,
        setZapCategory,
        zapTo,
        exitPlayer,
        notify,
        setLoading,
        playStarted,
        playFailed,
        retryPlay,
        askConfirm,
        closeConfirm,
        pushDigit,
        clearDigits,
        commitDigits,
        jumpTo,
        formatCount,
        tvCategories,
        visibleTvCategory,
        openTvCategory,
        selectPreview,
        openSource,
        backToTv,
        loadingRows,
        elapsedOf,
        visibleRecents,
        visibleFavorites,
        stats,
    }
})()
