var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.player = (function () {
    // Reading webapis.avplay can throw when the privilege was not granted: probe defensively.
    function avplay() {
        try {
            return typeof webapis !== "undefined" && webapis.avplay ? webapis.avplay : null
        } catch {
            return null
        }
    }
    let video = null
    let surface = null
    let handlers = {}
    let startTimer = null

    // A stream that never answers sends no error event; give up after this.
    const START_TIMEOUT_MS = 12000

    // AVPlay reports PLAYER_ERROR_* codes; the viewer needs words.
    const REASONS = {
        PLAYER_ERROR_CONNECTION_FAILED: "No connection to the channel",
        PLAYER_ERROR_TIMEOUT: "The channel took too long to answer",
        PLAYER_ERROR_NOT_SUPPORTED_FORMAT: "This TV cannot play that format",
        PLAYER_ERROR_INVALID_URI: "The channel address is not valid",
        PLAYER_ERROR_NOT_AVAILABLE: "The channel is not available right now",
        PLAYER_ERROR_STREAMING_FAILED: "The channel stopped the stream",
    }

    function describe(error) {
        if (!error) return "Could not open the channel"
        if (error.name && REASONS[error.name]) return REASONS[error.name]
        if (error.message) return error.message
        if (typeof error === "string") return error
        return "Could not open the channel"
    }

    let resizeBound = false

    function init(videoEl, callbacks) {
        video = videoEl
        handlers = callbacks || {}
        if (!resizeBound) {
            window.addEventListener("resize", resize)
            resizeBound = true
        }
    }

    function hardware() {
        return !!avplay()
    }

    function resize(rect) {
        if (rect) setRect(rect)
        else if (avplay()) setRect()
    }

    let lastRect = null

    function clearRect() {
        lastRect = null
    }

    // AVPlay measures the display rect in the TV's 1920x1080 grid, whatever the viewport.
    function setRect(rect) {
        if (rect) lastRect = rect
        if (!surface) surface = document.getElementById("avPlayer")
        const area =
            lastRect && lastRect.w > 2 && lastRect.h > 2
                ? lastRect
                : { x: 0, y: 0, w: 1920, h: 1080 }
        avplay().setDisplayRect(
            Math.round(area.x),
            Math.round(area.y),
            Math.round(area.w),
            Math.round(area.h),
        )
    }

    function state() {
        const AV = avplay()
        if (AV) {
            try {
                return AV.getState()
            } catch {
                return "IDLE"
            }
        }
        if (!video || !video.src) return "IDLE"
        return video.paused ? "PAUSED" : "PLAYING"
    }

    function clearStart() {
        if (startTimer) {
            clearTimeout(startTimer)
            startTimer = null
        }
    }

    // Without the <object type="application/avplayer"> surface it plays audio and paints nothing.
    function checkSurface() {
        if (!avplay()) return true
        if (!surface) surface = document.getElementById("avPlayer")
        if (!surface)
            console.error(
                'AVPlay sin <object type="application/avplayer">: se oira pero no se vera',
            )
        return !!surface
    }

    function fail(error) {
        clearStart()
        console.error("playback error:", error)
        if (handlers.onError) handlers.onError(describe(error))
    }

    function started() {
        clearStart()
        if (handlers.onStart) handlers.onStart()
    }

    function waitForStart() {
        clearStart()
        startTimer = setTimeout(() => {
            startTimer = null
            fail({ message: "The channel is not responding" })
        }, START_TIMEOUT_MS)
    }

    function clearVideo() {
        if (!video) return
        video.removeAttribute("src")
        try {
            video.load()
        } catch {}
    }

    function stop() {
        clearStart()
        const AV = avplay()
        if (AV) {
            try {
                if (state() === "PLAYING" || state() === "PAUSED") AV.stop()
            } catch {}
            try {
                AV.close()
            } catch {}
        }
        clearVideo()
    }

    // Fallback for environments without AVPlay: emulator, browser, Public install.
    function playWithVideo(url) {
        if (!video) {
            fail(new Error("No player available"))
            return
        }
        video.src = url
        video.addEventListener(
            "error",
            () => {
                fail(new Error("Could not play the channel"))
            },
            { once: true },
        )
        waitForStart()
        video.play().then(started).catch(fail)
    }

    function play(url, rect) {
        stop()
        if (!url) return
        lastRect = rect || null
        if (!rect) clearRect()

        setTimeout(started, 4000)

        const AV = avplay()
        if (AV) {
            checkSurface()
            try {
                AV.open(url)
                setRect()
                AV.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX")
                AV.setListener({
                    onerror: function (error) {
                        fail(error)
                    },
                    onbufferingcomplete: function () {
                        started()
                    },
                    oncurrentplaytime: function () {
                        started()
                    },
                    onstreamcompleted: function () {
                        if (handlers.onEnd) handlers.onEnd()
                    },
                })
                waitForStart()
                AV.prepareAsync(
                    () => {
                        AV.play()
                        started()
                    },
                    (error) => {
                        fail(error)
                    },
                )
                return
            } catch (error) {
                console.error("AVPlay no disponible, se usa <video>:", error)
            }
        }

        playWithVideo(url)
    }

    function toggle() {
        const AV = avplay()
        if (AV) {
            const current = state()
            if (current === "PLAYING") {
                AV.pause()
                return "PAUSED"
            }
            if (current === "PAUSED") {
                AV.play()
                return "PLAYING"
            }
            return current
        }
        if (!video || !video.src) return "IDLE"
        if (video.paused) {
            video.play().catch(fail)
            return "PLAYING"
        }
        video.pause()
        return "PAUSED"
    }

    return {
        init,
        play,
        stop,
        toggle,
        state,
        clearRect,
        resize,
        describe,
        hardware,
    }
})()
