var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const Bar = kit.Bar
    const useState = kit.useState
    const useEffect = kit.useEffect
    const useRef = kit.useRef
    const ADD_TYPES = kit.ADD_TYPES
    const FIELD_SETS = kit.FIELD_SETS
    const TYPE_ICONS = kit.TYPE_ICONS

    App.uiScreens.sourceForm = function SourceForm(props) {
        const state = store.state
        const editing = props.mode === "edit"
        const list = editing ? store.listById(state.editId) : null
        const type = editing ? fieldTypeOf(list) : state.addType
        const fields = FIELD_SETS[type] || []
        const refs = useRef({})
        const errorState = useState("")
        const error = errorState[0]
        const setError = errorState[1]
        const fileState = useState(null)
        const file = fileState[0]
        const setFile = fileState[1]

        useEffect(() => {
            const values = {}
            if (list) {
                values.url = list.url
                values.origin =
                    list.origin ||
                    (list.source === "creds" || list.kind === "xtream" ? list.url : "")
                values.user = list.user || ""
                values.pass = list.pass || ""
                values.mac = list.mac || ""
                values.text = list.text || ""
                values.name = list.name || ""
                values.token = list.token || ""
                values.chatId = list.chatId || ""
            }
            Object.keys(refs.current).forEach((key) => {
                const element = refs.current[key]
                if (element) element.value = values[key] || ""
            })
        }, [props.mode, state.editId, state.addType])

        function readFields() {
            const values = {
                name: "",
                user: "",
                pass: "",
                mac: "",
                text: "",
                url: "",
                origin: "",
                token: "",
                chatId: "",
            }
            Object.keys(refs.current).forEach((key) => {
                const element = refs.current[key]
                if (element && element.value !== undefined) values[key] = element.value.trim()
            })
            if (file) {
                values.text = file.text
                values.fileName = file.name
            }
            return values
        }

        function save() {
            const values = readFields()
            if (editing) {
                store
                    .updateList(list.id, {
                        type,
                        url: values.url,
                        origin: values.origin,
                        user: values.user,
                        pass: values.pass,
                        mac: values.mac,
                        token: values.token,
                        chatId: values.chatId,
                        text: values.text,
                        name: values.name,
                    })
                    .catch((failure) => {
                        setError(failure.message)
                    })
                return
            }
            const built = store.buildSource(type, values)
            if (built.error) {
                setError(built.error)
                return
            }
            setError("")
            store.addList(built.list).catch((failure) => {
                setError(failure.message)
            })
        }

        function remove() {
            store.askConfirm(`Delete “${list.name}”? Favorites are kept.`, () => {
                const isTg = store.listKind(list) === "telegram"
                const botName =
                    (list.botUsername ? `@${list.botUsername}` : list.name) || "Telegram bot"
                const userVal = list.chatId
                    ? `@${String(list.chatId).trim().replace(/^@/, "")}`
                    : ""
                store.removeList(list.id)
                if (isTg) {
                    store.notify(`Removed ${botName}${userVal ? ` (${userVal})` : ""}`)
                } else {
                    store.notify("Source deleted")
                }
                store.goHome()
            })
        }

        function readFile(event) {
            const chosen = event.target.files && event.target.files[0]
            if (!chosen) return
            const reader = new FileReader()
            reader.onload = function () {
                setFile({ name: chosen.name, text: String(reader.result || "") })
                setError("")
            }
            reader.onerror = function () {
                setError("Could not read the file")
            }
            reader.readAsText(chosen)
        }

        return html`<section class="screen" id=${editing ? "screen-edit" : "screen-add"}>
            <${Bar}
                title=${editing ? "Edit source" : "Add source"}
                titleId=${editing ? "editTitle" : "addTitle"}
                meta=${editing ? listLabelOrEmpty(list) : typeTitle(type)}
                actions=${
                    editing
                        ? null
                        : html`<div class="bar-actions" id="addActions">
                              <button
                                  class="btn"
                                  id="changeTypeBtn"
                                  tabindex="-1"
                                  onClick=${function () {
                                      store.openAdd()
                                  }}
                              >
                                  Change type
                              </button>
                          </div>`
                }
            />
            <div class="panel" id="sourceForm">
                ${fields.map((field) => {
                    return html`<label for=${`field-${field.id}`}>${field.label}</label> ${
                            field.multiline
                                ? html`<textarea
                                      id=${`field-${field.id}`}
                                      rows="4"
                                      ref=${function (element) {
                                          refs.current[field.id] = element
                                      }}
                                      placeholder=${field.placeholder || ""}
                                      spellcheck="false"
                                      tabindex="-1"
                                  ></textarea>`
                                : html`<input
                                      id=${`field-${field.id}`}
                                      ref=${function (element) {
                                          refs.current[field.id] = element
                                      }}
                                      type="text"
                                      placeholder=${field.placeholder || ""}
                                      autocomplete="off"
                                      autocapitalize="off"
                                      spellcheck="false"
                                      tabindex="-1"
                                  />`
                        }`
                })}
                ${
                    type === "file"
                        ? html`<label for="pickFile">Fichero .m3u</label>
                              <button
                                  class="btn pick"
                                  id="pickFile"
                                  tabindex="-1"
                                  onClick=${function () {
                                      if (refs.current.file) refs.current.file.click()
                                  }}
                              >
                                  Choose file
                              </button>
                              <input
                                  class="file"
                                  id="field-file"
                                  type="file"
                                  accept=".m3u,.m3u8,text/plain"
                                  ref=${function (element) {
                                      refs.current.file = element
                                  }}
                                  tabindex="-1"
                                  onChange=${readFile}
                              />
                              <p class="hint ${file ? "ok" : ""}" id="fileHint">
                                  ${file ? `${file.name} · ${store.formatCount((file.text.match(/#EXTINF/g) || []).length)} entries` : "Press OK to choose the file on the USB drive"}
                              </p>`
                        : null
                }
                <label for="field-name">Name</label>
                <input
                    id="field-name"
                    ref=${function (element) {
                        refs.current.name = element
                    }}
                    type="text"
                    placeholder="Optional: taken from the address"
                    autocomplete="off"
                    tabindex="-1"
                />
                <p class="err" id="formError">${error}</p>
                <div class="actions">
                    <button class="btn primary" id="formSave" tabindex="-1" onClick=${save}>
                        ${editing ? "Save changes" : "Save source"}
                    </button>
                    ${editing ? html`<button class="btn danger" id="formDelete" tabindex="-1" onClick=${remove}>Delete source</button>` : null}
                    <button
                        class="btn"
                        id="formCancel"
                        tabindex="-1"
                        onClick=${function () {
                            store.goHome()
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </section>`
    }

    function fieldTypeOf(list) {
        if (!list) return "url"
        const kind = store.listKind(list)
        if (kind === "telegram") return "telegram"
        if (kind !== "m3u") return kind
        return list.source === "text" ? "raw" : "url"
    }

    function listLabelOrEmpty(list) {
        return list ? store.listLabel(list) : ""
    }

    function typeTitle(type) {
        for (let i = 0; i < ADD_TYPES.length; i++) {
            if (ADD_TYPES[i].id === type) return ADD_TYPES[i].hint
        }
        return ""
    }

    App.uiScreens.addTypePicker = function AddTypePicker() {
        return html`<section class="screen" id="screen-add">
            <${Bar}
                title="Add source"
                titleId="addTitle"
                meta="Choose how to connect. You can rename it later."
                metaId="addMeta"
            />
            <div class="types" id="addTypes">
                ${ADD_TYPES.map((type) => {
                    return html`<button
                        class="typecard"
                        data-type=${type.id}
                        tabindex="-1"
                        onClick=${function () {
                            store.chooseType(type.id)
                        }}
                    >
                        <span class="type-icon">${TYPE_ICONS[type.icon]}</span>
                        <span class="type-title">${type.title}</span>
                        <span class="type-hint">${type.hint}</span>
                    </button>`
                })}
            </div>
        </section>`
    }
})()
