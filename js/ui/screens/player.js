var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const player = App.player
    const html = kit.html
    const useState = kit.useState
    const useEffect = kit.useEffect
    const useRef = kit.useRef
    const clock = kit.clock
    const OVERLAY_MS = 5000

    App.uiScreens.player = function Player() {
        const state = store.state
        const videoRef = useRef(null)
        const overlayState = useState(true)
        const overlay = overlayState[0]
        const setOverlay = overlayState[1]
        const timer = useRef(null)
        const timeState = useState({ current: 0, duration: 0, paused: false })
        const mediaTime = timeState[0]
        const setMediaTime = timeState[1]

        useEffect(() => {
            player.init(videoRef.current, {
                onStart: function () {
                    store.playStarted()
                },
                onError: function (message) {
                    store.playFailed(message)
                },
                onDuration: function (dur) {
                    setMediaTime((prev) => {
                        return { ...prev, duration: dur }
                    })
                },
                onTimeUpdate: function (time) {
                    setMediaTime((prev) => {
                        return { ...prev, current: time }
                    })
                },
            })
            return function () {
                player.stop()
            }
        }, [])

        useEffect(() => {
            if (state.playing) player.play(state.playing.channel.url)
        }, [state.playing])

        useEffect(() => {
            document.body.classList.add("playing")
            return function () {
                document.body.classList.remove("playing")
            }
        }, [])

        useEffect(() => {
            const tick = setInterval(() => {
                store.refreshProgram()
            }, 30000)
            return function () {
                clearInterval(tick)
            }
        }, [])

        useEffect(() => {
            function pulse() {
                show()
            }
            document.addEventListener("keydown", pulse)
            return function () {
                document.removeEventListener("keydown", pulse)
            }
        }, [])

        function show() {
            setOverlay(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                setOverlay(false)
            }, OVERLAY_MS)
        }

        const channel = state.playing ? state.playing.channel : null
        if (!channel) return null
        const saved = store.isFavorite(state.playing.listId, channel.url)
        const program = state.nowProgram
        const next = state.nextProgram
        const progress = store.programProgress(program)

        const isVod =
            channel.url &&
            (channel.size !== undefined ||
                /\.(mp4|mkv|avi|mov|webm|m4v|flv|3gp|wmv|mpg|mpeg)/i.test(channel.url))
        const formatTime = (ms) => {
            if (!ms || isNaN(ms)) return "00:00"
            const totalSec = Math.floor(ms / 1000)
            const mins = Math.floor(totalSec / 60)
            const secs = totalSec % 60
            const hrs = Math.floor(mins / 60)
            if (hrs > 0) {
                const remMins = mins % 60
                return `${hrs}:${remMins < 10 ? "0" : ""}${remMins}:${secs < 10 ? "0" : ""}${secs}`
            }
            return `${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`
        }
        const vodProgress =
            mediaTime.duration > 0
                ? Math.min(100, Math.max(0, (mediaTime.current / mediaTime.duration) * 100))
                : 0

        return html`<section
            class=${`screen player${player.hardware() ? " hw" : ""}`}
            id="screen-player"
        >
            <video id="videoPlayer" ref=${videoRef} playsinline></video>
            <!-- AVPlay does not draw into <video>: it paints in an object like this one,
                 and without it the channel is heard but not seen. It goes after the
                 video, on top. -->
            <object
                class="av-surface"
                id="avPlayer"
                type="application/avplayer"
                width="1920"
                height="1080"
            ></object>
            ${
                state.playStatus === "opening"
                    ? html`<div class="player-status" id="playerStatus">
                          <div class="scallop-loading">
                              <span class="scallop-shape"></span>
                          </div>
                          <div class="spinner"></div>
                          <p class="player-status-text">Opening “${channel.name}”…</p>
                      </div>`
                    : null
            }
            ${
                state.playError
                    ? html`<div class="player-error" id="playError">
                          <div class="play-card">
                              <p class="play-why" id="playErrorWhy">${state.playError.message}</p>
                              <h1 class="play-name" id="playErrorName">${channel.name}</h1>
                              <p class="play-hint">You can try again or pick another channel.</p>
                              <div class="play-actions" id="playActions">
                                  <button
                                      class="btn primary"
                                      id="playRetry"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.retryPlay()
                                      }}
                                  >
                                      Retry
                                  </button>
                                  <button
                                      class="btn"
                                      id="playClose"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.exitPlayer()
                                      }}
                                  >
                                      Back
                                  </button>
                              </div>
                          </div>
                      </div>`
                    : null
            }
            ${state.zapOpen ? html`<${App.uiScreens.zap} />` : null}
            ${state.favZapOpen ? html`<${App.uiScreens.favZap} />` : null}
            <div
                class=${`overlay${
                    (overlay || state.menuFocus) &&
                    !state.playError &&
                    !state.zapOpen &&
                    !state.favZapOpen
                        ? " visible"
                        : ""
                }`}
                id="playerOverlay"
            >
                <div class="ov-info">
                    <p class="ov-live" id="ovLive">
                        <span class=${isVod ? "dot vod" : "dot"}></span
                        >${isVod ? "Media" : "Live"}<span class="ov-engine" id="ovEngine"
                            >${player.hardware() ? "AVPlay" : "HTML5"}</span
                        >
                    </p>
                    <h1 id="ovName">${channel.name}</h1>
                    <p class="ov-group" id="ovGroup">${channel.group || ""}</p>
                    ${
                        isVod
                            ? html`<div class="md3-player-transport">
                                  <div class="md3-slider-row">
                                      <span class="md3-time md3-time-current" id="vodCurrentTime"
                                          >${formatTime(mediaTime.current)}</span
                                      >
                                      <div class="md3-slider-track">
                                          <div
                                              class="md3-slider-fill"
                                              id="vodProgressFill"
                                              style=${`width:${vodProgress}%`}
                                          >
                                              <span class="md3-slider-handle"></span>
                                          </div>
                                      </div>
                                      <span class="md3-time md3-time-duration" id="vodDuration"
                                          >${formatTime(mediaTime.duration)}</span
                                      >
                                  </div>
                              </div>`
                            : null
                    }
                    ${
                        program
                            ? html`<div class="ov-guide" id="ovProgram">
                                  <p class="ov-program">
                                      ${program.title}${
                                          program.start
                                              ? html`<span class="ov-time"
                                                    >${clock(program.start)} –
                                                    ${clock(program.end)}</span
                                                >`
                                              : null
                                      }
                                  </p>
                                  ${
                                      progress !== null
                                          ? html`<div class="ov-progress">
                                                <span
                                                    class="ov-progress-fill"
                                                    id="ovProgress"
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
                            ? html`<p class="ov-next" id="ovNext">
                                  <span class="ov-next-tag">Next</span>${next.title}${
                                      next.start
                                          ? html`<span class="ov-time"
                                                >${clock(next.start)} – ${clock(next.end)}</span
                                            >`
                                          : null
                                  }
                              </p>`
                            : null
                    }
                    <!-- The legend goes last: the name, the guide and what comes next
                         are one thing and do not split down the middle. -->
                    <p class="ov-keys" id="ovKeys">
                        ${isVod ? html`<span class="ov-key">LEFT/RIGHT</span><span>seek 10s</span><span class="ov-key">OK</span><span>play/pause</span>` : html`<span class="ov-key">CH UP/DOWN</span><span>channel</span><span class="ov-key">LEFT</span><span>favorites</span>`}
                        <span class="ov-key">DOWN</span><span>menu</span>
                        <span class="ov-key">BACK</span><span>exit</span>
                        <span class="ov-key">RED</span><span>favorite</span>
                        <span class="ov-key">NUMBERS</span><span>jump</span>
                    </p>
                </div>
                <div class="ov-actions" id="ovActions">
                    <button
                        class=${`btn${saved ? " saved" : ""}`}
                        id="ovFav"
                        tabindex="-1"
                        onClick=${function () {
                            if (saved) {
                                store.askConfirmRemoveFav(channel, state.playing.listId)
                            } else {
                                store.toggleFavorite(channel, state.playing.listId)
                                show()
                            }
                        }}
                    >
                        ${saved ? "Remove from favorites" : "Add to favorites"}
                    </button>
                    ${
                        isVod
                            ? html`<button
                                  class="btn"
                                  id="ovPlayToggle"
                                  tabindex="-1"
                                  onClick=${function () {
                                      player.toggle()
                                      show()
                                  }}
                              >
                                  Play / Pause
                              </button>`
                            : null
                    }
                </div>
            </div>
        </section>`
    }
})()
