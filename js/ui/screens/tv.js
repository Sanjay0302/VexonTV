var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const clock = kit.clock
    const useEffect = kit.useEffect
    const Bar = kit.Bar
    const Search = kit.Search
    const ChannelList = kit.ChannelList

    const player = App.player

    // The stylesheet ships both spellings of mask subtraction; accept either.
    function supportsHole() {
        if (!window.CSS || !window.CSS.supports) return false
        return (
            window.CSS.supports("-webkit-mask-composite", "xor") ||
            window.CSS.supports("mask-composite", "exclude")
        )
    }

    // CSS pixels: AVPlay converts to its grid at the other end.
    function previewBox() {
        const element = document.getElementById("previewStage")
        return element && element.getBoundingClientRect ? element.getBoundingClientRect() : null
    }

    function videoRect() {
        const box = previewBox()
        if (!box || box.width < 2) return null
        const scale = 1920 / (window.innerWidth || 1920)
        return {
            x: box.left * scale,
            y: box.top * scale,
            w: box.width * scale,
            h: box.height * scale,
        }
    }

    // The rect goes on the document root: the card's own mask reads the same variables.
    function setHole() {
        const box = previewBox()
        const layer = document.getElementById("backdrop")
        const stage = document.getElementById("previewStage")
        if (!box || !layer) return
        const rootStyle = document.documentElement.style
        // One pixel per side: the focus edge lives on the card border, and flush to the
        // edge the mask ate it right where the video is (the border was cut there).
        const inset = 1
        rootStyle.setProperty("--hole-x", `${Math.round(box.left + inset)}px`)
        rootStyle.setProperty("--hole-y", `${Math.round(box.top + inset)}px`)
        rootStyle.setProperty("--hole-w", `${Math.round(box.width - inset * 2)}px`)
        rootStyle.setProperty("--hole-h", `${Math.round(box.height - inset * 2)}px`)
        if (stage && stage.offsetParent) {
            rootStyle.setProperty("--stage-x", `${Math.round(stage.offsetLeft + inset)}px`)
            rootStyle.setProperty("--stage-y", `${Math.round(stage.offsetTop + inset)}px`)
        }
    }

    const iconTvBig = kit.svg(
        html`<rect
                x="2.5"
                y="5"
                width="19"
                height="13"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
            /><path
                d="M8.5 21h7"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
            />`,
        64,
    )

    function Preview() {
        const state = store.state
        const channel = state.preview
        if (!channel) {
            return html`<div class="preview-card" id="previewCard">
                <div class="preview-stage" id="previewStage">
                    <div class="preview-empty" id="previewEmpty">
                        <span class="preview-icon">${iconTvBig}</span>
                        <p class="preview-hint">Select a channel to see it here</p>
                    </div>
                </div>
            </div>`
        }
        const program = store.programOf(channel)
        const next = store.nextOf(channel)
        const progress = store.programProgress(program)
        return html`<div class="preview-card" id="previewCard">
            <div class="preview-stage" id="previewStage">
                <span class="preview-logo" style=${kit.logoStyle(channel.logo)}>
                    ${channel.logo ? null : html`<span class="preview-letter">${kit.initial(channel.name)}</span>`}
                </span>
            </div>
            <div class="preview-info">
                <h2 class="preview-name">${channel.name}</h2>
                <p class="preview-group">${channel.group || ""}</p>
                ${
                    program
                        ? html`<div class="preview-guide">
                              <p class="preview-program">
                                  ${program.title}
                                  <span class="ov-time"
                                      >${clock(program.start)} – ${clock(program.end)}</span
                                  >
                              </p>
                              ${
                                  progress !== null
                                      ? html`<div class="ov-progress">
                                            <span
                                                class="ov-progress-fill"
                                                style=${`width:${progress}%`}
                                            ></span>
                                        </div>`
                                      : null
                              }
                          </div>`
                        : null
                }
                ${
                    next
                        ? html`<p class="preview-next">
                              <span class="ov-next-tag">Next</span>${next.title}
                              ${next.start ? html`<span class="ov-time">${clock(next.start)} – ${clock(next.end)}</span>` : null}
                          </p>`
                        : null
                }
                <p class="preview-open">Press OK to watch full screen</p>
            </div>
        </div>`
    }

    function TvScreen() {
        const state = store.state

        useEffect(() => {
            if (!state.preview || !state.preview.url) {
                player.stop()
                return
            }
            setHole()
            if (supportsHole() && player.hardware()) document.body.classList.add("previewing")
            player.play(state.preview.url, videoRect())
            function onResize() {
                setHole()
                player.play(state.preview.url, videoRect())
            }
            const screenEl = document.getElementById("screen-tv")
            window.addEventListener("resize", onResize)
            if (screenEl) screenEl.addEventListener("animationend", onResize)
            return function () {
                window.removeEventListener("resize", onResize)
                if (screenEl) screenEl.removeEventListener("animationend", onResize)
                document.body.classList.remove("previewing")
                player.stop()
            }
        }, [state.preview])

        const view = store.tvCategories()
        const channels = store.visibleTvCategory()
        const pending = store.loadingRows()
        const rows = store.tvCategories().rows

        return html`<section class="screen" id="screen-tv">
            <${Bar}
                title="TV"
                meta=${view.label}
                metaId="tvMeta"
                titleId="tvTitle"
                actions=${html`<div class="bar-actions" id="tvActions">
                    <button
                        class="btn"
                        id="catsBtn"
                        tabindex="-1"
                        onClick=${function () {
                            store.openCategories()
                        }}
                    >
                        Categories
                    </button>
                </div>`}
                search=${html`<${Search}
                    id="tvSearch"
                    countId="tvSearchCount"
                    scope="tvch"
                    resetKey="tv"
                    placeholder="Search channels…"
                    count=${store.searchOf("tvch") ? store.visibleTvCategory().count : ""}
                    onInput=${function (value) {
                        store.setSearch("tvch", value)
                    }}
                    onClear=${function () {
                        store.setSearch("tvch", "")
                    }}
                />`}
            />
            ${state.lists.length ? null : html`<p class="empty">Every source's channels meet here. Add one to start.</p>`}
            <div class="browse" id="browse">
                <div class="browse-cats" id="tvCats">
                    ${pending.map((row) => {
                        return html`<div class="row pending" key=${`load-${row.key}`}>
                            <span class="pending-dot"></span>
                            <span class="row-main">
                                <span class="row-name">${row.name}</span>
                                <span class="row-sub"
                                    >${row.label}${
                                        row.count !== undefined
                                            ? ` · ${store.formatCount(row.count)} channels`
                                            : "…"
                                    }</span
                                >
                            </span>
                        </div>`
                    })}
                    ${
                        rows.length || pending.length
                            ? null
                            : html`<p class="empty">
                                  ${view.total ? "No category matches your search." : "No categories yet."}
                              </p>`
                    }
                    ${rows.map((row) => {
                        return html`<button
                            class=${`row tvcat${row.name === state.catName ? " selected" : ""}`}
                            tabindex="-1"
                            data-group=${row.name}
                            onClick=${function () {
                                store.openTvCategory(row.name)
                            }}
                        >
                            <span class="row-main">
                                <span class="row-name">${row.name}</span>
                                ${row.sources > 1 ? html`<span class="row-sub">${row.sources} sources</span>` : null}
                            </span>
                            <span class="row-count">${store.formatCount(row.count)}</span>
                        </button>`
                    })}
                </div>
                <div class="browse-channels">
                    <${ChannelList} id="tvChannels" view=${channels} detail=${true} />
                </div>
                <div
                    class="browse-preview"
                    id="tvPreview"
                    tabindex="-1"
                    onClick=${function () {
                        if (state.preview)
                            store.play(state.preview, state.preview.listId, store.zapChannels())
                    }}
                >
                    <${Preview} />
                </div>
            </div>
        </section>`
    }

    App.uiScreens.tv = TvScreen
})()
