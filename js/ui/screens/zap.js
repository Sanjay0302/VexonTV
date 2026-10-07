var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const clock = kit.clock

    function ZapPanel() {
        const state = store.state
        const categories = store.zapCategories()
        const channels = store.zapChannels().slice(0, 200)
        const playing = state.playing && state.playing.channel ? state.playing.channel.url : ""

        return html`<div class="zap" id="zapPanel">
            <div class="zap-cats" id="zapCats">
                ${categories.map((category) => {
                    return html`<button
                        class=${`row zapcat${category.selected ? " selected" : ""}`}
                        tabindex="-1"
                        data-group=${category.name}
                        onClick=${function () {
                            store.setZapCategory(category.name)
                        }}
                    >
                        <span class="row-name">${category.name}</span>
                        ${category.playing ? html`<span class="zap-dot"></span>` : null}
                        <span class="row-count">${store.formatCount(category.count)}</span>
                    </button>`
                })}
            </div>
            <div class="zap-list" id="zapChannels">
                <p class="zap-head" id="zapHead">
                    <span>${state.zapCategory}</span>
                    <span class="zap-hint">OK watch · BACK close</span>
                </p>
                ${channels.map((channel) => {
                    const program = store.programOf(channel)
                    const progress = store.programProgress(program)
                    const saved = store.isFavorite(channel.listId, channel.url)
                    return html`<button
                        class=${`row zapch${channel.url === playing ? " playing" : ""}`}
                        tabindex="-1"
                        data-url=${channel.url}
                        data-list=${channel.listId}
                        onClick=${function () {
                            store.zapTo(channel)
                        }}
                    >
                        <span class="thumb" style=${kit.logoStyle(channel.logo)}>
                            ${channel.logo ? null : html`<span class="thumb-letter">${kit.initial(channel.name)}</span>`}
                        </span>
                        <span class="zap-info">
                            <span class="zap-top">
                                <span class="row-name">${channel.name}</span>
                                ${saved ? html`<span class="saved">★</span>` : null}
                            </span>
                            ${
                                program
                                    ? html`<span class="zap-guide">
                                          <span class="zap-time">${clock(program.start)}</span>
                                          ${
                                              progress !== null
                                                  ? html`<span class="zap-bar">
                                                        <span
                                                            class="zap-bar-fill"
                                                            style=${`width:${progress}%`}
                                                        ></span>
                                                    </span>`
                                                  : html`<span class="zap-bar"></span>`
                                          }
                                          <span class="zap-time">${clock(program.end)}</span>
                                      </span>`
                                    : html`<span class="row-sub">${channel.group || ""}</span>`
                            }
                        </span>
                        ${channel.url === playing ? html`<span class="zap-now" aria-label="playing">▶</span>` : null}
                    </button>`
                })}
            </div>
        </div>`
    }

    App.uiScreens.zap = ZapPanel

    function FavZapPanel() {
        const state = store.state
        const favorites = state.favorites
        const playing = state.playing && state.playing.channel ? state.playing.channel.url : ""

        return html`<div class="zap fav-zap" id="favZapPanel">
            <div class="zap-list" id="zapFavChannels">
                <p class="zap-head" id="favZapHead">
                    <span>Favorites</span>
                    <span class="zap-hint">OK watch · BACK close</span>
                </p>
                ${
                    favorites.length === 0
                        ? html`<p class="zap-empty">No favorites yet. Press RED while watching a channel to save it.</p>`
                        : null
                }
                ${favorites.map((channel, index) => {
                    const program = store.programOf(channel)
                    const progress = store.programProgress(program)
                    return html`<button
                        class=${`row zapch${channel.url === playing ? " playing" : ""}`}
                        tabindex="-1"
                        data-url=${channel.url}
                        data-list=${channel.listId}
                        onClick=${function () {
                            store.zapToFav(channel)
                        }}
                    >
                        <span class="num">${index + 1}</span>
                        <span class="thumb" style=${kit.logoStyle(channel.logo)}>
                            ${channel.logo ? null : html`<span class="thumb-letter">${kit.initial(channel.name)}</span>`}
                        </span>
                        <span class="zap-info">
                            <span class="zap-top">
                                <span class="row-name">${channel.name}</span>
                                <span class="saved">★</span>
                            </span>
                            ${
                                program
                                    ? html`<span class="zap-guide">
                                          <span class="zap-time">${clock(program.start)}</span>
                                          ${
                                              progress !== null
                                                  ? html`<span class="zap-bar">
                                                        <span
                                                            class="zap-bar-fill"
                                                            style=${`width:${progress}%`}
                                                        ></span>
                                                    </span>`
                                                  : html`<span class="zap-bar"></span>`
                                          }
                                          <span class="zap-time">${clock(program.end)}</span>
                                      </span>`
                                    : html`<span class="row-sub">${channel.group || ""}</span>`
                            }
                        </span>
                        ${channel.url === playing ? html`<span class="zap-now" aria-label="playing">▶</span>` : null}
                    </button>`
                })}
            </div>
        </div>`
    }

    App.uiScreens.favZap = FavZapPanel
})()
