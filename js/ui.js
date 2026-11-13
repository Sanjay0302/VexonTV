var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.ui = (function () {
    const preact = window.preact
    const html = window.htm.bind(preact.h)
    const store = App.store
    const tv = App.tv
    const kit = App.uiKit
    const screens = App.uiScreens

    const useEffect = kit.useEffect
    const Rail = kit.Rail
    const Home = screens.home
    const TvScreen = screens.tv
    const Recents = screens.recents
    const Favs = screens.favs
    const Categories = screens.cats
    const SourceForm = screens.sourceForm
    const AddTypePicker = screens.addTypePicker
    const Player = screens.player
    const Loader = screens.loader
    const Toast = screens.toast
    const NumBuffer = screens.numBuffer
    const Confirm = screens.confirm

    function Root() {
        useEffect(() => {
            const request = store.takeFocus()
            if (request) tv.set(request.zone, request.row, request.col)
            else tv.refresh()
        })

        const state = store.state
        const playing = state.screen === "player"
        const focusedEl = document.querySelector(".focused")
        const railOpen = focusedEl && !!focusedEl.closest(".rail")
        return html`<div class=${`app${playing ? " playing" : ""}${railOpen ? " rail-open" : ""}`}>
            <div class="backdrop" id="backdrop" aria-hidden="true"></div>
            <${Rail} screen=${state.screen} />
            <main class="main">
                ${!playing && state.screen === "home" ? html`<${Home} />` : null}
                ${!playing && state.screen === "tv" ? html`<${TvScreen} />` : null}
                ${!playing && state.screen === "recents" ? html`<${Recents} />` : null}
                ${!playing && state.screen === "favs" ? html`<${Favs} />` : null}
                ${!playing && state.screen === "cats" ? html`<${Categories} />` : null}
                ${
                    !playing && state.screen === "add"
                        ? state.addType
                            ? html`<${SourceForm} mode="add" />`
                            : html`<${AddTypePicker} />`
                        : null
                }
                ${!playing && state.screen === "edit" ? html`<${SourceForm} mode="edit" />` : null}
                ${state.screen === "player" ? html`<${Player} />` : null}
            </main>
            ${state.numBuffer ? html`<${NumBuffer} value=${state.numBuffer} />` : null}
            ${state.loading ? html`<${Loader} />` : null}
            ${state.confirm ? html`<${Confirm} />` : null}
            ${state.toast ? html`<${Toast} message=${state.toast.message} />` : null}
        </div>`
    }

    function qsa(selector) {
        return Array.prototype.slice.call(document.querySelectorAll(selector))
    }

    function render() {
        preact.render(html`<${Root} />`, document.getElementById("app"))

        const splash = document.getElementById("splash")
        if (splash) {
            splash.classList.add("off")
            setTimeout(() => {
                if (splash.parentNode) splash.parentNode.removeChild(splash)
            }, 300)
        }
    }

    store.subscribe(render)

    return { render, qsa }
})()
