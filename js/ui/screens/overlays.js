var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html

    App.uiScreens.loader = function Loader() {
        const state = store.state
        const rows = store.loadingRows()
        return html`<div class="loading" id="loading">
            <div class="spinner"></div>
            <div class="loading-head">
                <p class="loading-eyebrow" id="loadingEyebrow">${state.loading.eyebrow}</p>
                <h1 class="loading-title" id="loadingTitle">${state.loading.title}</h1>
            </div>
            <div class="loading-list" id="loadingList">
                ${rows.map((row) => {
                    return html`<div class="loading-row" key=${row.key}>
                        ${rows.length > 1 ? html`<span class="loading-name">${row.name}</span>` : null}
                        <span class="loading-phase"
                            >${row.label}${
                                row.count !== undefined
                                    ? ` · ${store.formatCount(row.count)} channels`
                                    : ""
                            }</span
                        >
                    </div>`
                })}
            </div>
            <p class="loading-meta" id="loadingMeta">
                <span class="loading-time" id="loadingTime"
                    >${store.elapsedOf(state.loading)} s</span
                >
                <span class="loading-hint" id="loadingHint">Very large playlists take a while</span>
            </p>
        </div>`
    }

    App.uiScreens.toast = function Toast(props) {
        return html`<div class="toast" id="toast">${props.message}</div>`
    }

    App.uiScreens.numBuffer = function NumBuffer(props) {
        return html`<div class="numbuffer" id="numBuffer">${props.value}</div>`
    }

    App.uiScreens.confirm = function Confirm() {
        const confirm = store.state.confirm
        return html`<div class="modal" id="confirm">
            <div class=${`modal-card${confirm.clean ? " clean" : ""}`}>
                <p id="confirmText">${confirm.message}</p>
                <div class="actions">
                    <button
                        class="btn"
                        id="confirmCancel"
                        tabindex="-1"
                        onClick=${function () {
                            store.closeConfirm()
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        class="btn danger"
                        id="confirmOk"
                        tabindex="-1"
                        onClick=${function () {
                            const action = confirm.onAccept
                            store.closeConfirm()
                            if (action) action()
                        }}
                    >
                        ${confirm.okLabel || "Delete"}
                    </button>
                </div>
            </div>
        </div>`
    }
})()
