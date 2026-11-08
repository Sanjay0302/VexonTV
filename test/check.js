// Loads the real sources with no DOM: parsing, sources, filters, storage, EPG.
const fs = require("fs")
const path = require("path")

global.localStorage = (function () {
    const data = {}
    return {
        getItem: function (key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
        },
        setItem: function (key, value) {
            data[key] = String(value)
        },
        removeItem: function (key) {
            delete data[key]
        },
        clear: function () {
            Object.keys(data).forEach((key) => {
                delete data[key]
            })
        },
    }
})()

const root = path.join(__dirname, "..")
const report = require("./report")("check — the sources with no DOM: parsers, sources, EPG")
const check = report.check

;(function () {
    const tv = fs.readFileSync(path.join(root, "js/ui/screens/tv.js"), "utf8")
    const supports = tv.slice(
        tv.indexOf("function supportsHole"),
        tv.indexOf("function previewBox"),
    )
    ;["-webkit-mask-composite", "mask-composite"].forEach((prop) => {
        check(`the preview hole asks for ${prop}`, supports.indexOf(prop) !== -1)
    })
    const css = fs.readFileSync(path.join(root, "css/lists.css"), "utf8")
    ;["-webkit-mask-composite", "mask-composite"].forEach((prop) => {
        check(`and the sheet applies ${prop}`, css.indexOf(prop) !== -1)
    })
})()

function source(relative) {
    return fs.readFileSync(path.join(root, relative), "utf8")
}

const App = {}
function load(file) {
    try {
        new Function("App", source(file))(App)
    } catch (error) {
        report.fail(`${file} does not load`, error.message)
    }
}
;["js/api.js", "js/store.js", "js/player.js"].forEach(load)

const api = App.api
const store = App.store
const player = App.player

const b64 = (value) => Buffer.from(value, "utf8").toString("base64")
global.fetch = function () {
    return Promise.resolve({
        ok: true,
        status: 200,
        headers: {
            get: function () {
                return null
            },
        },
        text: function () {
            return Promise.resolve(source("test/sample.m3u"))
        },
        json: function () {
            return Promise.resolve({
                epg_listings: [
                    {
                        title: b64("Programa de prueba"),
                        description: b64("Descripción"),
                        start: b64("2026-09-16 21:00:00"),
                        end: b64("2026-09-16 22:00:00"),
                    },
                ],
            })
        },
    })
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

const playlist = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="la1" tvg-logo="http://cdn/logo.png" group-title="España",La 1 HD',
    "https://panel.example/live/user/pass/1.ts",
    '#EXTINF:-1 group-title="VOD | Acción",Una película (2024)',
    "https://panel.example/movie/user/pass/99.mp4",
    '#EXTINF:-1 group-title="Series",Una serie S01E01',
    "https://panel.example/series/user/pass/77.mp4",
    "",
].join("\r\n")

const channels = api.parseM3u(playlist)
check("parseM3u discards movies and series", channels.length === 1, `quedaron ${channels.length}`)
check(
    "parseM3u reads name, group and logo",
    !!channels[0] &&
        channels[0].name === "La 1 HD" &&
        channels[0].group === "España" &&
        channels[0].logo === "http://cdn/logo.png",
    JSON.stringify(channels[0]),
)
check(
    "parseM3u reads the channel url",
    !!channels[0] && channels[0].url === "https://panel.example/live/user/pass/1.ts",
)
check("parseM3u tolerates an empty list", api.parseM3u("#EXTM3U\r\n").length === 0)
check(
    "parseM3u with the sample file yields 9 channels",
    api.parseM3u(source("test/sample.m3u")).length === 9,
)

const xtreamCases = [
    [
        "https://panel.example/get.php?username=abc&password=def&type=m3u_plus",
        { origin: "https://panel.example", user: "abc", pass: "def" },
    ],
    [
        "http://host.ddns.net:8080/player_api.php?username=a&password=b",
        { origin: "http://host.ddns.net:8080", user: "a", pass: "b" },
    ],
    [
        "https://x.tv/panel_api.php?username=u&password=p",
        { origin: "https://x.tv", user: "u", pass: "p" },
    ],
    [
        "https://x.tv/get.php?username=a%40b&password=p%3A1",
        { origin: "https://x.tv", user: "a@b", pass: "p:1" },
    ],
    ["https://iptv-org.github.io/iptv/index.country.m3u", null],
    ["https://x.tv/lists/mine.m3u?username=u&password=p", null],
    ["https://x.tv/get.php?username=u", null],
    ["https://x.tv/get.php?username=&password=p", null],
    ["", null],
    [null, null],
    [undefined, null],
]
xtreamCases.forEach((item) => {
    const got = api.parseXtreamUrl(item[0])
    check(
        `parseXtreamUrl ${JSON.stringify(item[0])}`,
        JSON.stringify(got) === JSON.stringify(item[1]),
        `expected ${JSON.stringify(item[1])}, got ${JSON.stringify(got)}`,
    )
})
check(
    "parsePortal accepts portal + credentials",
    JSON.stringify(api.parsePortal("http://host:8080", "u", "p")) ===
        JSON.stringify({ origin: "http://host:8080", user: "u", pass: "p" }),
)

let built = store.buildSource("url", { url: "http://panel.tv/list.m3u" })
check("M3U by URL", built.list.kind === "m3u" && built.list.source === "url")
check("the name is derived from the address", built.list.name === "list", built.list.name)

built = store.buildSource("url", { url: "http://panel.tv/get.php?username=a&password=b" })
check(
    "a URL with credentials is saved as Xtream",
    built.list.kind === "xtream" && built.list.user === "a" && built.list.pass === "b",
    JSON.stringify(built.list),
)

built = store.buildSource("raw", { text: "#EXTM3U\n#EXTINF:-1,Algo\nhttp://x/1.ts" })
check("M3U pasted as text", built.list.kind === "m3u" && built.list.source === "text")
check("text that is not M3U is rejected", !!store.buildSource("raw", { text: "hola" }).error)
check("a file with no selection is rejected", !!store.buildSource("file", { name: "x" }).error)

built = store.buildSource("xtream", {
    origin: "http://host:8080",
    user: "u",
    pass: "p",
    name: "Mi panel",
})
check(
    "Xtream with server and credentials",
    built.list.kind === "xtream" && built.list.source === "creds" && built.list.name === "Mi panel",
)
check(
    "Xtream without credentials is rejected",
    !!store.buildSource("xtream", { origin: "http://host:8080" }).error,
)

built = store.buildSource("stalker", { origin: "http://portal.tv/c", mac: "aa:bb:cc:dd:ee:ff" })
check(
    "Stalker with portal and MAC",
    built.list.kind === "stalker" && built.list.mac === "AA:BB:CC:DD:EE:FF",
)
check(
    "a MAC with a weird format is rejected",
    !!store.buildSource("stalker", { origin: "http://p", mac: "nope" }).error,
)

let guess = api.parseAuto("URL: http://panel.tv:8080\nUser: pepe\nPass: 1234")
check(
    "detects Xtream in the provider message",
    guess.list &&
        guess.list.kind === "xtream" &&
        guess.list.user === "pepe" &&
        guess.list.pass === "1234",
    JSON.stringify(guess),
)

guess = api.parseAuto("MAC: 00:1A:79:AA:BB:CC\nPortal: http://portal.tv/c")
check(
    "detects Stalker by the MAC",
    guess.list && guess.list.kind === "stalker" && guess.list.mac === "00:1A:79:AA:BB:CC",
    JSON.stringify(guess),
)

guess = api.parseAuto("http://panel.tv/lista.m3u8")
check("detects a list by the address", guess.list && guess.list.kind === "m3u")
guess = api.parseAuto("#EXTM3U\n#EXTINF:-1,Canal\nhttp://x/1.ts")
check("detects pasted text", guess.list && guess.list.source === "text")
check("warns when it recognizes nothing", !!api.parseAuto("buenas tardes").error)
check(
    "a get.php URL with credentials is detected as Xtream",
    api.parseAuto("http://h/get.php?username=u&password=p").list.kind === "xtream",
)

const sample = [{ name: "La 1 HD" }, { name: "laSexta" }, { name: "TVE Internacional" }]
check("match ignores case", api.match(sample, "LA 1").length === 1)
check("match searches in any position", api.match(sample, "nacional").length === 1)
check("match without query returns everything", api.match(sample, "   ").length === 3)
check("match with no results", api.match(sample, "no-existe").length === 0)

global.localStorage.clear()
store.init()
check(
    "a fresh install brings a factory public source",
    (function () {
        const list = store.state.lists[0]
        return (
            store.state.lists.length === 1 &&
            list.name === "Free channels of the world" &&
            list.url === "https://iptv-org.github.io/iptv/index.country.m3u" &&
            list.kind === "m3u" &&
            list.source === "url"
        )
    })(),
    JSON.stringify(store.state.lists),
)
check(
    "and it is not duplicated when starting again",
    (function () {
        store.init()
        return store.state.lists.length === 1
    })(),
)
check(
    "if the user deletes it, it does not come back",
    (function () {
        store.removeList(store.state.lists[0].id)
        store.init()
        return store.state.lists.length === 0
    })(),
)
check(
    "and nothing is added to whoever already has sources",
    (function () {
        global.localStorage.setItem(
            "ts.lists",
            JSON.stringify([
                { id: "x1", name: "Mía", kind: "m3u", source: "url", url: "http://h/x.m3u" },
            ]),
        )
        global.localStorage.removeItem("ts.seeded")
        store.init()
        const ok = store.state.lists.length === 1 && store.state.lists[0].id === "x1"
        global.localStorage.clear()
        return ok
    })(),
)

store.init()
store.state.lists = [
    {
        id: "l1",
        name: "panel",
        kind: "xtream",
        source: "creds",
        origin: "http://h",
        user: "u",
        pass: "p",
    },
    { id: "l2", name: "list", kind: "m3u", source: "url", url: "http://h2/list.m3u" },
    {
        id: "l3",
        name: "portal",
        kind: "stalker",
        source: "mac",
        origin: "http://p",
        mac: "00:1A:79:00:00:01",
    },
]
store.state.channels.l1 = [
    { name: "La 1", group: "España", url: "u1" },
    { name: "La 2", group: "España", url: "u2" },
    { name: "DAZN 1", group: "Deportes", url: "u3" },
]
store.state.channels.l2 = [{ name: "Teledeporte", group: "Deportes", url: "u4" }]
store.state.groups.l1 = store.groupNames(store.state.channels.l1)
store.state.groups.l2 = store.groupNames(store.state.channels.l2)
store.state.screen = "home"

check(
    "groupNames sorts and does not repeat",
    JSON.stringify(store.groupsOf("l1")) === JSON.stringify(["Deportes", "España"]),
)

const sources = store.sources()
check(
    "the type filter counts each type",
    sources.types.length === 5 && sources.types[1].count === 1 && sources.types[2].count === 1,
    JSON.stringify(sources.types),
)
store.setFilter("xtream")
check(
    "filtering by Xtream leaves only that source",
    store.sources().items.length === 1 && store.sources().items[0].id === "l1",
)
store.setFilter("all")
check("without a filter all come out", store.sources().items.length === 3)

check(
    "the TV groups by category, it does not dump loose channels",
    (function () {
        const view = store.tvCategories()
        return (
            view.rows.length === 2 &&
            view.rows[0].name === "Deportes" &&
            view.rows[1].name === "España"
        )
    })(),
    JSON.stringify(store.tvCategories().rows),
)
const shared = store.tvCategories().rows.filter((row) => {
    return row.name === "Deportes"
})[0]
check(
    "a category from two sources is merged and counts both",
    shared.count === 2 && shared.sources === 2,
    JSON.stringify(shared),
)
check(
    "the TV search filters categories",
    (function () {
        store.setSearch("tv", "esp")
        const hit = store.tvCategories().rows
        store.setSearch("tv", "")
        return hit.length === 1 && hit[0].name === "España"
    })(),
)

store.state.muted = undefined
store.openCategories()
store.toggleCategory("l1", "Deportes")
store.saveCategories()
check(
    "a muted category stops contributing channels",
    JSON.stringify(
        store.groupsOf("l1").filter((group) => {
            return (store.listById("l1").muted || []).indexOf(group) === -1
        }),
    ) === JSON.stringify(["España"]),
)
check(
    "the TV screen skips channels from muted categories",
    store.allChannels().filter((channel) => {
        return channel.name === "DAZN 1"
    }).length === 0,
)
check("the groups are still there to be able to reactivate them", store.groupsOf("l1").length === 2)

store.openCategories()
const catView = store.categoriesView()
check(
    "the categories view counts active and total",
    catView.selected === 2 && catView.total === 3,
    `${catView.selected}/${catView.total}`,
)
check(
    "the categories view is grouped by provider",
    catView.sections.length === 2 && catView.sections[0].list.id === "l1",
)
store.toggleCategory("l1", "Deportes")
check("re-checking a category reactivates it", store.categoriesView().selected === 3)
store.setAllCategories(false)
check('"none" disables all', store.categoriesView().selected === 0)
store.setAllCategories(true)
store.setCatSearch("depor")
check(
    "categories can be searched",
    store.categoriesView().total === 2,
    String(store.categoriesView().total),
)
store.setCatSearch("")
store.toggleCategory("l1", "Deportes")
store.saveCategories()
check(
    "on saving the muted category is persisted",
    JSON.stringify(
        store.groupsOf("l1").filter((group) => {
            return (store.listById("l1").muted || []).indexOf(group) === -1
        }),
    ) === JSON.stringify(["España"]),
)

store.openSource("l1")
check(
    "the TV of one source only offers its categories",
    (function () {
        const view = store.tvCategories()
        return (
            store.state.tvSource === "l1" &&
            view.rows.length === 1 &&
            view.rows[0].name === "España" &&
            view.rows[0].count === 2 &&
            /^panel · /.test(view.label)
        )
    })(),
    JSON.stringify(store.tvCategories().rows),
)
check(
    "choosing a category fills the channel column, without changing screen",
    (function () {
        store.openTvCategory("España")
        const view = store.visibleTvCategory()
        return (
            store.state.screen === "tv" &&
            store.state.catName === "España" &&
            view.total === 2 &&
            view.zone === "tvChannels"
        )
    })(),
    `${store.state.screen} / ${JSON.stringify(store.visibleTvCategory())}`,
)
check(
    "the TV of all sources joins them again",
    (function () {
        store.openTv()
        return store.state.tvSource === null && store.tvCategories().rows.length === 2
    })(),
)

check(
    "the TV view joins the channels from all sources",
    store.allChannels().length === 3,
    String(store.allChannels().length),
)
check(
    "stats summarizes sources and channels",
    store.stats().counts === "3 sources, 4 channels",
    store.stats().counts,
)

store.play(store.state.channels.l1[0], "l1", store.state.channels.l1)
store.play(store.state.channels.l1[1], "l1", store.state.channels.l1)
store.play(store.state.channels.l1[0], "l1", store.state.channels.l1)
check(
    "recent saves the last watched without repeating",
    store.state.recent.length === 2 && store.state.recent[0].url === "u1",
)
store.exitPlayer()

check(
    "choosing a category fills the channel column without leaving the TV",
    (function () {
        store.openTvCategory("España")
        const view = store.visibleTvCategory()
        return (
            store.state.screen === "tv" &&
            store.state.catName === "España" &&
            view.total === 2 &&
            view.zone === "tvChannels"
        )
    })(),
    `${store.state.screen} ${JSON.stringify(store.visibleTvCategory())}`,
)
check(
    "jump by number works on the TV: the channels are in the middle column",
    (function () {
        store.openTvCategory("España")
        store.takeFocus()
        store.pushDigit("2")
        store.commitDigits()
        const request = store.takeFocus()
        return !!request && request.zone === "tvChannels" && request.row === 1
    })(),
    JSON.stringify(store.takeFocus()),
)
store.openTvCategory("España")
store.pushDigit("2")
check("the channel buffer builds up", store.state.numBuffer === "2")
check(
    "Enter jumps to the typed channel",
    (function () {
        let request = null
        store.commitDigits()
        request = store.takeFocus()
        return !!request && request.zone === "tvChannels" && request.row === 1
    })(),
)
store.pushDigit("9")
store.pushDigit("9")
store.pushDigit("9")
store.commitDigits()
check("a number that does not exist does not move the focus", store.takeFocus() === null)
store.pushDigit("1")
check("Back clears the buffer", store.clearDigits() === true && store.clearDigits() === false)

store.play(store.state.channels.l1[0], "l1", store.state.channels.l1)
check(
    "when opening a channel the player says it is opening",
    store.state.screen === "player" &&
        store.state.playStatus === "opening" &&
        !store.state.playError,
)
store.playStarted()
check("when it starts it stops warning", store.state.playStatus === "playing")
store.playFailed("No connection to the channel")
check(
    "if it fails it saves the reason and does not go black",
    store.state.playStatus === "error" &&
        store.state.playError.message === "No connection to the channel",
)
check(
    "and the focus goes to the card buttons",
    (function () {
        const request = store.takeFocus()
        return !!request && request.zone === "playError"
    })(),
)
check(
    "the reason can be read",
    (function () {
        return (
            player.describe({ name: "PLAYER_ERROR_CONNECTION_FAILED" }) ===
                "No connection to the channel" &&
            player.describe({}) === "Could not open the channel" &&
            player.describe(new Error("HTTP 404")) === "HTTP 404"
        )
    })(),
)
store.retryPlay()
check(
    "retry clears the error and opens again",
    store.state.playStatus === "opening" && store.state.playError === null,
)
store.exitPlayer()
check(
    "leaving the player leaves the state clean",
    store.state.playStatus === "idle" && store.state.playError === null,
)

check(
    "the progress of a program halfway through is around half",
    (function () {
        const start = new Date(Date.now() - 30 * 60000)
        const end = new Date(Date.now() + 30 * 60000)
        function stamp(date) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
                date.getDate(),
            ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
                date.getMinutes(),
            ).padStart(2, "0")}:00`
        }
        const value = store.programProgress({ start: stamp(start), end: stamp(end) })
        return value >= 45 && value <= 55
    })(),
    String(store.programProgress({ start: "2026-09-16 21:00:00", end: "2026-09-16 22:00:00" })),
)
check("without times there is no progress", store.programProgress({ title: "x" }) === null)
check(
    "and with impossible times neither",
    store.programProgress({ start: "2026-09-16 22:00:00", end: "2026-09-16 21:00:00" }) === null,
)

check("new favorite", store.toggleFavorite(store.state.channels.l1[0], "l1") === true)
check("it is not duplicated", store.state.favorites.length === 1)
check(
    "favorites can be searched",
    (function () {
        store.setSearch("favorites", "la 1")
        const found = store.visibleFavorites().total
        store.setSearch("favorites", "")
        return found === 1
    })(),
)
check(
    "remove favorite",
    store.toggleFavorite(store.state.channels.l1[0], "l1") === false &&
        store.state.favorites.length === 0,
)

const xtreamChannel = {
    name: "La 1",
    group: "España",
    url: "https://panel.example/live/user/pass/1.ts",
}
check("programOf empty before requesting it", store.programOf(xtreamChannel) === null)
store.loadProgramFor(xtreamChannel)

function walk(dir, out) {
    out = out || []
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((entry) => {
        const relative = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(relative, out)
        else if (/\.js$/.test(entry.name)) out.push(relative)
    })
    return out
}

const html = source("index.html")
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => {
    return m[1]
})
const ours = scripts.filter((file) => {
    return file.indexOf("vendor/") !== 0
})
const uiFiles = ours.filter((file) => {
    return file !== "js/app.js"
})

check(
    "index.html loads all the modules in the repo",
    walk("js").every((file) => {
        return scripts.indexOf(file) !== -1
    }),
    walk("js")
        .filter((file) => {
            return scripts.indexOf(file) === -1
        })
        .join(", "),
)

const ids = new Set()
;["index.html"].concat(uiFiles).forEach((file) => {
    Array.from(source(file).matchAll(/id="([A-Za-z0-9_-]+)"/g)).forEach((match) => {
        ids.add(match[1])
    })
})

const selectors = []
Array.from(source("js/app.js").matchAll(/zone\((["'])[a-zA-Z]+\1,\s*(["'])([^"']+)\2/g)).forEach(
    (match) => {
        selectors.push(match[3])
    },
)
ours.forEach((file) => {
    Array.from(source(file).matchAll(/qs?a?\(\s*(["'])([^"']+)\1/g)).forEach((match) => {
        selectors.push(match[2])
    })
})

const missing = []
selectors.forEach((selector) => {
    Array.from(selector.matchAll(/#([A-Za-z0-9_-]+)/g)).forEach((match) => {
        if (!ids.has(match[1])) missing.push(`${match[1]}  (en "${selector}")`)
    })
})
check("each selector points to an id that exists", missing.length === 0, missing.join(", "))
check(
    "the expected focus zones are declared",
    selectors.length >= 14,
    `${selectors.length} selectores`,
)
check(
    "empty elements are self-closed (htm requires it)",
    !/<(input|br|img|hr|meta|link)\b[^>]*[^/]>/i.test(
        ours
            .filter((file) => {
                return file.indexOf("vendor/") === -1
            })
            .map(source)
            .join("\n"),
    ),
)

const manifest = source("config.xml")
check(
    "the package id has 10 characters (Tizen requires it)",
    /package="[A-Za-z0-9]{10}"/.test(manifest),
    (manifest.match(/package="([^"]*)"/) || [])[1],
)
check(
    "config.xml does not ask for the avplay privilege (not used since 2015)",
    manifest.indexOf("privilege/avplay") === -1,
)
check("config.xml points to index.html", manifest.indexOf('<content src="index.html" />') !== -1)
check("config.xml uses the TV profile", manifest.indexOf("tv-samsung") !== -1)
check("there is an icon", fs.existsSync(path.join(root, "icon.png")))

check(
    "each <script src> exists",
    scripts.every((file) => {
        return fs.existsSync(path.join(root, file))
    }),
)
check(
    "the 3 vendor files are in the package",
    scripts.filter((file) => {
        return file.indexOf("vendor/") === 0
    }).length === 3,
)
check(
    "no script goes out to a CDN",
    scripts.every((file) => {
        return file.indexOf("http") === -1
    }),
)

const bundle = ours.map(source).join("\n")
check("the runtime does not mention any CDN", !/unpkg|jsdelivr|cdnjs|cdn\./i.test(bundle))

const pending = [
    store.updateList("nope", { url: "http://h/x.m3u" }).then(
        () => {
            return "editing a missing source did not fail"
        },
        () => {
            return null
        },
    ),
    store.updateList("l2", { type: "url", url: "sin-http" }).then(
        () => {
            return "it did not validate the address"
        },
        () => {
            return null
        },
    ),
    store.addList(store.buildSource("url", { url: "http://localhost/test/sample.m3u" }).list).then(
        (list) => {
            return list.length === 9 ? null : `loaded ${list.length} channels`
        },
        (error) => {
            return `it did not add the source: ${error.message}`
        },
    ),
    store
        .updateList("l2", {
            type: "url",
            url: "http://localhost/test/sample.m3u",
            name: "edited list",
        })
        .then(
            (list) => {
                return list.length === 9 ? null : `it edited with ${list.length} channels`
            },
            (error) => {
                return `it did not edit the source: ${error.message}`
            },
        ),
    wait(30).then(() => {
        return store.programOf(xtreamChannel) &&
            store.programOf(xtreamChannel).title === "Programa de prueba"
            ? null
            : "the guide did not reach the channel"
    }),
]

Promise.all(pending).then((results) => {
    const problems = results.filter((item) => {
        return !!item
    })
    check("add, edit, EPG and validations behave", problems.length === 0, problems.join(" | "))
    const edited = store.listById("l2")
    check(
        "editing leaves the name and address new",
        !!edited &&
            edited.name === "edited list" &&
            edited.url === "http://localhost/test/sample.m3u",
        JSON.stringify(edited),
    )
    check(
        "editing reloads the channels",
        store.channelsOf("l2").length === 9,
        String(store.channelsOf("l2").length),
    )
    check("editing invalidates the TV screen cache", store.allChannels().length >= 9)

    const wording = (async function () {
        const originalFetch = global.fetch
        const playlist = source("test/sample.m3u")
        global.fetch = function () {
            const chunks = [playlist.slice(0, 200), playlist.slice(200, 400), playlist.slice(400)]
            let index = 0
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve({
                        ok: true,
                        status: 200,
                        headers: {
                            get: function () {
                                return null
                            },
                        },
                        text: function () {
                            return Promise.resolve(playlist)
                        },
                        body: {
                            getReader: function () {
                                return {
                                    read: function () {
                                        return new Promise((done) => {
                                            setTimeout(() => {
                                                done(
                                                    index < chunks.length
                                                        ? {
                                                              done: false,
                                                              value: new TextEncoder().encode(
                                                                  chunks[index++],
                                                              ),
                                                          }
                                                        : { done: true },
                                                )
                                            }, 60)
                                        })
                                    },
                                }
                            },
                        },
                    })
                }, 40)
            })
        }

        const built = store.buildSource("url", {
            url: "http://localhost/test/wording.m3u",
            name: "Wording",
        })
        const download = store.addList(built.list)
        await wait(150)
        const first = (store.state.loadProgress.draft || {}).label
        await download

        const again = store.updateList(built.list.id, { type: "url", name: "Wording" })
        await wait(150)
        const second = (store.state.loadProgress.draft || {}).label
        await again

        check("the first import warns that it is downloading", first === "Downloading", first)
        check("and the next one, that it resyncs", second === "Syncing", second)
        global.fetch = originalFetch
    })()

    const stalker = (async function () {
        const calls = []
        const originalFetch = global.fetch
        const reply = (data) =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: function () {
                    return Promise.resolve(data)
                },
            })
        global.fetch = function (url, options) {
            const address = String(url)
            calls.push({ url: address, headers: (options && options.headers) || {} })
            if (address.indexOf("/portal.php") !== -1)
                return Promise.resolve({ ok: false, status: 404 })
            if (address.indexOf("action=handshake") !== -1)
                return reply({ js: { token: "TOKEN1" } })
            if (address.indexOf("action=get_profile") !== -1) return reply({ js: { id: "1" } })
            if (address.indexOf("action=get_all_channels") !== -1)
                return reply({
                    js: {
                        data: [
                            {
                                name: "Canal Stalker",
                                tv_genre_id: "7",
                                logo: "http://l/1.png",
                                cmd: "ffmpeg http://s/1.ts",
                                id: 11,
                            },
                        ],
                    },
                })
            if (address.indexOf("action=get_genres") !== -1)
                return reply({ js: [{ id: 7, title: "Deportes" }] })
            if (address.indexOf("action=create_link") !== -1)
                return reply({ js: { cmd: "ffmpeg http://s/live.ts" } })
            return Promise.resolve({ ok: false, status: 500 })
        }

        const list = {
            kind: "stalker",
            source: "mac",
            origin: "http://portal.tv/c",
            mac: "00:1A:79:AA:BB:CC",
        }
        const channels = await api.load(list)
        check(
            "stalker: if /portal.php does not answer, it tries the middleware load.php",
            calls.some((call) => {
                return call.url.indexOf("/stalker_portal/server/load.php") !== -1
            }),
        )
        check(
            "stalker: opens a session with get_profile before requesting channels",
            calls.some((call) => {
                return call.url.indexOf("action=get_profile") !== -1
            }),
        )
        check(
            "stalker: saves the token and the endpoint that answered (create_link needs them)",
            list.token === "TOKEN1" && list.endpoint.indexOf("load.php") !== -1,
            JSON.stringify({ token: list.token, endpoint: list.endpoint }),
        )
        check(
            "stalker: channels arrive with their genre and cmd",
            channels.length === 1 &&
                channels[0].group === "Deportes" &&
                channels[0].cmd === "ffmpeg http://s/1.ts",
            JSON.stringify(channels[0] || null),
        )
        const url = await api.resolveStalkerUrl(list, channels[0])
        check(
            "stalker: create_link goes with the token and without ffmpeg in front",
            url === "http://s/live.ts" &&
                calls
                    .filter((call) => {
                        return call.url.indexOf("create_link") !== -1
                    })
                    .every((call) => {
                        return call.headers.Authorization === "Bearer TOKEN1"
                    }),
            url,
        )
        global.fetch = originalFetch
    })()

    return Promise.all([wording, stalker]).then(() => {
        report.done()
    })
})
