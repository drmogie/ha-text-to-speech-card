/*
 * Text to Speech Card
 * A Home Assistant Lovelace card: paste/type any amount of text and speak it
 * out on a chosen media_player entity via the core `tts.speak` action.
 *
 * Works with ANY media_player entity (Piper Browser Speaker, Sonos, Google,
 * Alexa via media_player, etc.) - not tied to a specific speaker integration.
 *
 * The editor lets you set saved defaults: which speaker, which tts.* engine,
 * language, voice (filterable by quality tier - low/medium/high, etc, when
 * the engine's voice names carry one), whether to cache repeated messages,
 * and whether to keep the typed text in the box after speaking. The card
 * face also has its own "Quick settings" panel (gear icon) for changing any
 * of the TTS options just for your next message, without touching the saved
 * config - a Reset button there snaps back to the saved defaults at any
 * time. The "Keep text after speaking" checkbox lives right on the card
 * face since it's used often - toggling it there is a live, this-session
 * choice too.
 *
 * Note: there is deliberately no "speed" control. It's not a standard
 * cross-engine TTS option in Home Assistant - some engines support
 * something like it via their own option name, most don't, and sending an
 * option an engine doesn't recognize makes the WHOLE speak call fail
 * (confirmed live against a Piper/Wyoming engine: passing an unsupported
 * "speed" option errors with "Invalid options found: ['speed']" instead of
 * being ignored). Safer to leave it out than ship a control that silently
 * breaks speech for engines that don't support it.
 *
 * The Speak button is a plain native <button>, not HA's mwc-button. mwc-
 * button is a Material web component that loads/upgrades lazily - before it
 * finishes, it has no real button chrome and only a sliver of clickable
 * area, so early taps can silently miss it (this is what caused "I have to
 * edit the text box before Speak works" - editing just bought enough time
 * for it to finish loading). A native button is clickable immediately and
 * gets obvious hover/press styling plus a "Speaking..." label while the
 * service call is in flight.
 *
 * The Speak button also stays locked (disabled) for a minimum time after
 * a click - "lock_seconds" in config, default 2s, editable in the editor
 * GUI - even if the tts.speak call itself resolves faster, so a fast
 * double-tap can't fire it twice.
 *
 * The image button (leftmost of the three action icons) reads text out of
 * a picture: pick an image and its recognized text replaces the box. This
 * runs entirely in the browser via Tesseract.js, loaded lazily from a CDN
 * the first time it's used (not bundled, to keep the card file itself
 * small) - no server-side OCR service, no API key. First use on a given
 * device downloads a few MB (the OCR engine + English text data), which
 * the browser then caches, so it's only slow once. Started with just the
 * file-picker button, then added drag-and-drop, then paste - all three now
 * do the same OCR read: click the camera icon and pick a file, drag an
 * image file onto the text box, or click into the text box and paste
 * (Ctrl+V) a copied image or screenshot. In every case a plain text/link
 * drag or paste still behaves normally - only an actual image is
 * intercepted.
 */

const CARD_VERSION = "2026.09.15.11";

console.info(
  `%c TEXT-TO-SPEECH-CARD %c ${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);

// ---- shared helpers (used by both the card and its editor) ----

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function resolveTtsEntity(hass, config) {
  if (config && config.tts_entity) return config.tts_entity;
  if (!hass) return null;
  const ids = Object.keys(hass.states).filter((id) => id.startsWith("tts."));
  return ids.length ? ids[0] : null;
}

async function fetchTtsLanguages(hass, engineId) {
  if (!hass || !engineId) return [];
  try {
    const res = await hass.callWS({ type: "tts/engine/get", engine_id: engineId });
    return (res && res.provider && res.provider.supported_languages) || [];
  } catch (err) {
    return [];
  }
}

async function fetchTtsVoices(hass, engineId, language) {
  if (!hass || !engineId || !language) return [];
  try {
    const res = await hass.callWS({
      type: "tts/engine/voices",
      engine_id: engineId,
      language,
    });
    return (res && res.voices) || [];
  } catch (err) {
    return [];
  }
}

// Many Piper-style voice ids end in a quality tier, e.g. "en_US-amy-low" or
// "en_US-amy-medium". Pull that off so voices can be filtered by it. Voices
// with no recognizable suffix just won't match any quality filter, which is
// fine - the filter dropdown only lists tiers that actually showed up.
const QUALITY_ORDER = ["x_low", "low", "medium", "high"];

function parseVoiceQuality(voiceId) {
  const parts = String(voiceId).split("-");
  if (parts.length < 2) return "";
  const last = parts[parts.length - 1].toLowerCase();
  return last;
}

function sortQualities(qualities) {
  return qualities.slice().sort((a, b) => {
    const ia = QUALITY_ORDER.indexOf(a);
    const ib = QUALITY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function qualityLabel(q) {
  return q
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// items: [{value, label}]
function populateSelect(selectEl, items, defaultLabel, currentValue) {
  if (!selectEl) return;
  const opts = [`<option value="">${escapeHtml(defaultLabel)}</option>`].concat(
    items.map(
      (it) => `<option value="${escapeHtml(it.value)}">${escapeHtml(it.label)}</option>`
    )
  );
  selectEl.innerHTML = opts.join("");
  selectEl.value =
    currentValue && items.some((it) => it.value === currentValue) ? currentValue : "";
}

const SETTINGS_CSS = `
  .icon-btn {
    background: none;
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 6px;
    width: 36px;
    height: 36px;
    font-size: 16px;
    cursor: pointer;
    color: var(--primary-text-color, #000);
    flex-shrink: 0;
  }
  .icon-btn:hover { background: var(--secondary-background-color, #f0f0f0); }
  .icon-btn:disabled {
    opacity: 0.5;
    cursor: default;
    background: none;
  }
  .settings-panel {
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .settings-panel[hidden] { display: none; }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .settings-row label {
    font-size: 13px;
    color: var(--secondary-text-color, #888);
  }
  .settings-row select,
  .settings-row input[type="number"] {
    flex: 1;
    max-width: 60%;
    padding: 6px;
    border-radius: 6px;
    border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #000);
  }
  .checkbox-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--primary-text-color, #000);
  }
  .settings-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 4px;
  }
  .settings-actions .hint {
    font-size: 11px;
    color: var(--secondary-text-color, #888);
  }
  .text-btn {
    background: none;
    border: none;
    color: var(--primary-color, #03a9f4);
    cursor: pointer;
    font-size: 13px;
    padding: 4px 0;
    flex-shrink: 0;
  }
`;

class HaTextToSpeechCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("ha-text-to-speech-card-editor");
  }

  static getStubConfig() {
    return { entity: "", title: "Text to Speech" };
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this._config = config;
    this._overrides = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._updateStatus();
  }

  getCardSize() {
    return 4;
  }

  // Sizing hint for Lovelace Sections view
  getLayoutOptions() {
    return {
      grid_columns: 2,
      grid_rows: 4,
      grid_min_columns: 2,
      grid_min_rows: 3,
    };
  }

  _defaultsFromConfig() {
    return {
      language: (this._config && this._config.language) || "",
      voice: (this._config && this._config.voice) || "",
      cache: !this._config || this._config.cache !== false,
    };
  }

  _lockSeconds() {
    const v = this._config && this._config.lock_seconds;
    return typeof v === "number" && !isNaN(v) && v >= 0 ? v : 2;
  }

  _render() {
    if (!this._config) return;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    if (this._built) return;
    this._built = true;

    const title =
      this._config.title === undefined ? "Text to Speech" : this._config.title;

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .card-content {
          padding: 0 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }
        textarea {
          width: 100%;
          min-height: 110px;
          flex: 1;
          box-sizing: border-box;
          resize: vertical;
          font-family: inherit;
          font-size: 14px;
          padding: 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
        }
        textarea:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
        }
        textarea.drag-over {
          outline: none;
          border: 2px dashed var(--primary-color, #03a9f4);
          background: var(--secondary-background-color, #eef7fc);
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .target {
          font-size: 12px;
          color: var(--secondary-text-color, #888);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .target.error {
          color: var(--error-color, #db4437);
        }
        .keep-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--secondary-text-color, #888);
        }
        .speak-btn {
          appearance: none;
          border: none;
          border-radius: 8px;
          padding: 10px 20px;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: #fff;
          background: var(--primary-color, #03a9f4);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          cursor: pointer;
          transition: background 0.15s ease, box-shadow 0.1s ease, transform 0.1s ease;
          /* fixed width so the "Speak" -> "Speaking..." label swap can't
             resize the button - a size change here shifts the whole button
             sideways since it sits against the right edge of the row */
          min-width: 108px;
          text-align: center;
          white-space: nowrap;
        }
        .speak-btn:hover {
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
          filter: brightness(1.08);
        }
        .speak-btn:active {
          transform: translateY(1px) scale(0.98);
          box-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
        }
        .speak-btn:disabled {
          cursor: default;
          opacity: 0.6;
          box-shadow: none;
          transform: none;
        }
        ${SETTINGS_CSS}
      </style>
      <ha-card header="${title}">
        <div class="card-content">
          <textarea
            id="tts-text"
            placeholder="Type or paste text to speak..."
          ></textarea>
          <div class="row">
            <label class="keep-row">
              <input type="checkbox" id="keep-text" /> Keep text after speaking
            </label>
            <div class="actions">
              <input id="image-file" type="file" accept="image/*" hidden />
              <button id="image-btn" class="icon-btn" title="Read text from an image (or drag/drop or paste one into the box)">&#128247;</button>
              <button id="settings-toggle" class="icon-btn" title="Quick settings">&#9881;</button>
              <button id="speak-btn" class="speak-btn" type="button">Speak</button>
            </div>
          </div>
          <div class="row">
            <span id="target-name" class="target"></span>
          </div>
          <div id="settings-panel" class="settings-panel" hidden>
            <div class="settings-row">
              <label>Language</label>
              <select id="quick-language"><option value="">Default</option></select>
            </div>
            <div class="settings-row">
              <label>Voice quality</label>
              <select id="quick-quality"><option value="">All qualities</option></select>
            </div>
            <div class="settings-row">
              <label>Voice</label>
              <select id="quick-voice"><option value="">Default voice</option></select>
            </div>
            <div class="settings-row checkbox-row">
              <label><input id="quick-cache" type="checkbox" /> Cache repeated messages</label>
            </div>
            <div class="settings-actions">
              <span class="hint">Applies to your next message only.</span>
              <button id="quick-reset" class="text-btn">Reset to saved settings</button>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    this._textarea = this.shadowRoot.getElementById("tts-text");
    this._speakBtn = this.shadowRoot.getElementById("speak-btn");
    this._imageBtn = this.shadowRoot.getElementById("image-btn");
    this._imageFileInput = this.shadowRoot.getElementById("image-file");
    this._targetName = this.shadowRoot.getElementById("target-name");
    this._keepTextCheckbox = this.shadowRoot.getElementById("keep-text");
    this._keepTextCheckbox.checked = this._config.keep_text === true;
    this._settingsToggleBtn = this.shadowRoot.getElementById("settings-toggle");
    this._settingsPanel = this.shadowRoot.getElementById("settings-panel");
    this._quickLanguage = this.shadowRoot.getElementById("quick-language");
    this._quickQuality = this.shadowRoot.getElementById("quick-quality");
    this._quickVoice = this.shadowRoot.getElementById("quick-voice");
    this._quickCache = this.shadowRoot.getElementById("quick-cache");
    this._quickResetBtn = this.shadowRoot.getElementById("quick-reset");
    this._quickVoicesCache = [];

    this._speakBtn.addEventListener("click", () => this._speak());
    this._imageBtn.addEventListener("click", () => this._imageFileInput.click());
    this._imageFileInput.addEventListener("change", () => {
      const file = this._imageFileInput.files && this._imageFileInput.files[0];
      this._imageFileInput.value = ""; // allow picking the same file again
      if (file) this._handleImageFile(file);
    });
    this._textarea.addEventListener("dragover", (ev) => {
      if (!this._dragHasImage(ev.dataTransfer)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      this._textarea.classList.add("drag-over");
    });
    this._textarea.addEventListener("dragleave", () => {
      this._textarea.classList.remove("drag-over");
    });
    this._textarea.addEventListener("drop", (ev) => {
      this._textarea.classList.remove("drag-over");
      if (!this._dragHasImage(ev.dataTransfer)) return; // let plain text/link drops behave normally
      ev.preventDefault();
      const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) this._handleImageFile(file);
    });
    this._textarea.addEventListener("paste", (ev) => {
      const items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      let imageItem = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && items[i].type && items[i].type.startsWith("image/")) {
          imageItem = items[i];
          break;
        }
      }
      if (!imageItem) return; // no image on the clipboard - let normal text paste happen
      ev.preventDefault();
      const file = imageItem.getAsFile();
      if (file) this._handleImageFile(file);
    });
    this._settingsToggleBtn.addEventListener("click", () => this._toggleSettings());
    this._quickLanguage.addEventListener("change", () => {
      if (!this._overrides) this._overrides = this._defaultsFromConfig();
      this._overrides.language = this._quickLanguage.value;
      this._loadQuickVoices();
    });
    this._quickQuality.addEventListener("change", () => {
      this._applyQuickVoiceFilter();
    });
    this._quickVoice.addEventListener("change", () => {
      if (!this._overrides) this._overrides = this._defaultsFromConfig();
      this._overrides.voice = this._quickVoice.value;
    });
    this._quickCache.addEventListener("change", () => {
      if (!this._overrides) this._overrides = this._defaultsFromConfig();
      this._overrides.cache = this._quickCache.checked;
    });
    this._quickResetBtn.addEventListener("click", () => this._resetOverrides());
  }

  _toggleSettings() {
    const willShow = this._settingsPanel.hidden;
    this._settingsPanel.hidden = !willShow;
    if (willShow) {
      if (!this._overrides) this._overrides = this._defaultsFromConfig();
      this._quickCache.checked = this._overrides.cache;
      this._loadQuickLanguages();
    }
  }

  async _loadQuickLanguages() {
    const engineId = this._config.tts_entity || this._findDefaultTtsEntity();
    if (!engineId) {
      populateSelect(this._quickLanguage, [], "Default", "");
      this._quickVoicesCache = [];
      populateSelect(this._quickQuality, [], "All qualities", "");
      populateSelect(this._quickVoice, [], "Default voice", "");
      return;
    }
    const langs = await fetchTtsLanguages(this._hass, engineId);
    this._quickFirstLanguage = langs[0] || null;
    populateSelect(
      this._quickLanguage,
      langs.map((l) => ({ value: l, label: l })),
      "Default",
      this._overrides.language
    );
    await this._loadQuickVoices();
  }

  async _loadQuickVoices() {
    const engineId = this._config.tts_entity || this._findDefaultTtsEntity();
    const lang = this._quickLanguage.value || this._quickFirstLanguage;
    if (!engineId || !lang) {
      this._quickVoicesCache = [];
      populateSelect(this._quickQuality, [], "All qualities", "");
      populateSelect(this._quickVoice, [], "Default voice", this._overrides.voice);
      return;
    }
    const voices = await fetchTtsVoices(this._hass, engineId, lang);
    this._quickVoicesCache = voices;
    const qualities = sortQualities(
      [...new Set(voices.map((v) => parseVoiceQuality(v.voice_id)).filter(Boolean))]
    );
    populateSelect(
      this._quickQuality,
      qualities.map((q) => ({ value: q, label: qualityLabel(q) })),
      "All qualities",
      this._quickQuality.value
    );
    this._applyQuickVoiceFilter();
  }

  _applyQuickVoiceFilter() {
    const quality = this._quickQuality.value;
    const filtered = quality
      ? this._quickVoicesCache.filter((v) => parseVoiceQuality(v.voice_id) === quality)
      : this._quickVoicesCache;
    populateSelect(
      this._quickVoice,
      filtered.map((v) => ({ value: v.voice_id, label: v.name })),
      "Default voice",
      this._overrides.voice
    );
  }

  _resetOverrides() {
    this._overrides = this._defaultsFromConfig();
    this._quickLanguage.value = this._overrides.language;
    this._quickCache.checked = this._overrides.cache;
    this._quickQuality.value = "";
    this._applyQuickVoiceFilter();
  }

  _updateStatus() {
    if (!this._targetName || !this._config) return;
    // an image-OCR run or an error/status flash is showing its own message
    // on this line right now - don't stomp on it just because an unrelated
    // hass update came in (hass updates on every entity change, so this
    // fires constantly)
    if (this._statusLocked) return;
    const entityId = this._config.entity;
    if (!entityId) {
      this._targetName.textContent = "No speaker selected";
      this._targetName.classList.add("error");
      return;
    }
    this._targetName.classList.remove("error");
    const state = this._hass && this._hass.states[entityId];
    const speakerLabel = state
      ? state.attributes.friendly_name || entityId
      : entityId;

    const ttsEntityId = this._config.tts_entity || this._findDefaultTtsEntity();
    const ttsState = ttsEntityId && this._hass && this._hass.states[ttsEntityId];
    const ttsLabel = ttsState
      ? ttsState.attributes.friendly_name || ttsEntityId
      : ttsEntityId;

    this._targetName.textContent = ttsLabel
      ? `${speakerLabel} (via ${ttsLabel})`
      : speakerLabel;
  }

  _findDefaultTtsEntity() {
    return resolveTtsEntity(this._hass, this._config);
  }

  // Checked on dragover (to decide whether to claim the drop at all) and
  // again on drop. dataTransfer.items exposes file MIME types even before
  // drop, which is how a plain text/link drag can be told apart from an
  // actual image file without waiting for the drop itself.
  _dragHasImage(dataTransfer) {
    if (!dataTransfer) return false;
    const items = dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && items[i].type && items[i].type.startsWith("image/")) {
          return true;
        }
      }
      return false;
    }
    // fallback for browsers that don't expose item types pre-drop
    return Array.prototype.includes.call(dataTransfer.types || [], "Files");
  }

  // Loads Tesseract.js from a CDN on first use only, and only once per page
  // load even if multiple images are read back to back.
  _ensureTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!window.__ttsCardTesseractLoad) {
      window.__ttsCardTesseractLoad = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        script.onload = () => resolve(window.Tesseract);
        script.onerror = () =>
          reject(new Error("couldn't load the text-recognition library"));
        document.head.appendChild(script);
      });
    }
    return window.__ttsCardTesseractLoad;
  }

  async _handleImageFile(file) {
    if (!file || (file.type && !file.type.startsWith("image/"))) {
      this._flashStatus("That doesn't look like an image file", true, 3000);
      return;
    }
    this._imageBtn.disabled = true;
    this._speakBtn.disabled = true;
    this._statusLocked = true;
    this._setStatus("Loading text-recognition engine…");
    let worker = null;
    try {
      const Tesseract = await this._ensureTesseract();
      this._setStatus("Reading text from image…");
      worker = await Tesseract.createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            this._setStatus(`Reading text from image… ${Math.round(m.progress * 100)}%`);
          }
        },
      });
      const {
        data: { text },
      } = await worker.recognize(file);
      const cleaned = (text || "").trim();
      if (!cleaned) {
        this._flashStatus("No text found in that image", true, 3000);
      } else {
        this._textarea.value = cleaned;
        this._flashStatus("Text added from image", false, 2000);
      }
    } catch (err) {
      this._flashStatus(
        "Couldn't read that image: " + (err && err.message ? err.message : err),
        true,
        4000
      );
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (err) {
          // worker cleanup failing isn't worth surfacing to him
        }
      }
      this._imageBtn.disabled = false;
      this._speakBtn.disabled = false;
    }
  }

  // Sets the status line's text without touching the lock - use while a
  // longer operation (like OCR) is already holding it and reporting
  // progress.
  _setStatus(msg) {
    if (!this._targetName) return;
    this._targetName.classList.remove("error");
    this._targetName.textContent = msg;
  }

  // Shows a temporary message on the status line, then reverts to the
  // normal speaker/engine status after `duration`ms.
  _flashStatus(msg, isError, duration) {
    if (!this._targetName) return;
    this._statusLocked = true;
    this._targetName.textContent = msg;
    this._targetName.classList.toggle("error", !!isError);
    clearTimeout(this._statusFlashTimer);
    this._statusFlashTimer = setTimeout(() => {
      this._statusLocked = false;
      this._updateStatus();
    }, duration == null ? 3000 : duration);
  }

  _flashError(msg) {
    this._flashStatus(msg, true, 3000);
  }

  async _speak() {
    if (!this._hass || !this._config || !this._config.entity) {
      this._flashError("No target speaker configured");
      return;
    }

    const message = (this._textarea.value || "").trim();
    if (!message) {
      return;
    }

    const ttsEntityId =
      this._config.tts_entity || this._findDefaultTtsEntity();
    if (!ttsEntityId) {
      this._flashError("No TTS engine (tts.*) found in this HA instance");
      return;
    }

    const ov = this._overrides || this._defaultsFromConfig();
    const data = {
      media_player_entity_id: this._config.entity,
      message: message,
      cache: ov.cache !== false,
    };
    if (ov.language) data.language = ov.language;
    const options = {};
    if (ov.voice) options.voice = ov.voice;
    if (Object.keys(options).length) data.options = options;

    const lockMs = this._lockSeconds() * 1000;
    const startedAt = Date.now();
    this._speakBtn.disabled = true;
    this._imageBtn.disabled = true;
    this._speakBtn.textContent = "Speaking…";
    try {
      await this._hass.callService("tts", "speak", data, { entity_id: ttsEntityId });
      if (!this._keepTextCheckbox.checked) {
        this._textarea.value = "";
      }
    } catch (err) {
      this._flashError(
        "Speak failed: " + (err && err.message ? err.message : err)
      );
    } finally {
      // keep the button locked for at least lockMs from the click, even if
      // the service call itself came back faster - stops a fast double-tap
      // from firing a second speak call on top of the first
      const remaining = lockMs - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      this._speakBtn.disabled = false;
      this._imageBtn.disabled = false;
      this._speakBtn.textContent = "Speak";
    }
  }
}

class HaTextToSpeechCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._buildOrUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._entityPicker) this._entityPicker.hass = hass;
    if (this._ttsPicker) this._ttsPicker.hass = hass;
    if (this._hass && this._languageSelect && !this._languagesLoaded) {
      this._reloadLanguages();
    }
  }

  _buildOrUpdate() {
    if (this._built) {
      if (this._titleInput) this._titleInput.value = this._config.title ?? "";
      if (this._entityPicker) this._entityPicker.value = this._config.entity || "";
      if (this._ttsPicker) this._ttsPicker.value = this._config.tts_entity || "";
      if (this._lockSecondsInput)
        this._lockSecondsInput.value =
          this._config.lock_seconds != null ? this._config.lock_seconds : 2;
      return;
    }
    this._built = true;
    this._voicesCache = [];

    this.innerHTML = `
      <style>${SETTINGS_CSS}</style>
      <div class="card-config" style="display:flex;flex-direction:column;gap:16px;padding:8px 0;">
        <ha-textfield
          id="title"
          label="Title (optional)"
        ></ha-textfield>
        <ha-entity-picker
          id="entity"
          label="Speaker (media_player entity)"
          allow-custom-entity
        ></ha-entity-picker>
        <ha-entity-picker
          id="tts_entity"
          label="TTS engine (optional - defaults to the first one found)"
          allow-custom-entity
        ></ha-entity-picker>
        <div class="settings-row">
          <label>Default language</label>
          <select id="language"><option value="">Engine's own default</option></select>
        </div>
        <div class="settings-row">
          <label>Voice quality</label>
          <select id="quality"><option value="">All qualities</option></select>
        </div>
        <div class="settings-row">
          <label>Default voice</label>
          <select id="voice"><option value="">Engine's own default</option></select>
        </div>
        <div class="settings-row checkbox-row">
          <label><input id="cache" type="checkbox" checked /> Cache repeated messages by default</label>
        </div>
        <div class="settings-row checkbox-row">
          <label><input id="keep_text" type="checkbox" /> Keep text in box after speaking by default</label>
        </div>
        <div class="settings-row">
          <label>Lock button after Speak (seconds)</label>
          <input id="lock_seconds" type="number" min="0" max="10" step="0.5" />
        </div>
      </div>
    `;

    this._titleInput = this.querySelector("#title");
    this._entityPicker = this.querySelector("#entity");
    this._ttsPicker = this.querySelector("#tts_entity");
    this._languageSelect = this.querySelector("#language");
    this._qualitySelect = this.querySelector("#quality");
    this._voiceSelect = this.querySelector("#voice");
    this._cacheCheckbox = this.querySelector("#cache");
    this._keepTextCheckbox = this.querySelector("#keep_text");
    this._lockSecondsInput = this.querySelector("#lock_seconds");

    if (this._hass) {
      this._entityPicker.hass = this._hass;
      this._ttsPicker.hass = this._hass;
    }
    this._entityPicker.includeDomains = ["media_player"];
    this._ttsPicker.includeDomains = ["tts"];

    this._titleInput.value = this._config.title ?? "";
    this._entityPicker.value = this._config.entity || "";
    this._ttsPicker.value = this._config.tts_entity || "";
    this._cacheCheckbox.checked = this._config.cache !== false;
    this._keepTextCheckbox.checked = this._config.keep_text === true;
    this._lockSecondsInput.value =
      this._config.lock_seconds != null ? this._config.lock_seconds : 2;

    this._titleInput.addEventListener("input", (ev) =>
      this._valueChanged("title", ev.target.value)
    );
    this._entityPicker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._valueChanged("entity", ev.detail.value);
    });
    this._ttsPicker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._valueChanged("tts_entity", ev.detail.value);
      this._languagesLoaded = false;
      this._reloadLanguages();
    });
    this._languageSelect.addEventListener("change", () => {
      this._valueChanged("language", this._languageSelect.value);
      this._reloadVoices();
    });
    this._qualitySelect.addEventListener("change", () => {
      this._applyVoiceFilter();
    });
    this._voiceSelect.addEventListener("change", () => {
      this._valueChanged("voice", this._voiceSelect.value);
    });
    this._cacheCheckbox.addEventListener("change", () => {
      this._valueChanged("cache", this._cacheCheckbox.checked);
    });
    this._keepTextCheckbox.addEventListener("change", () => {
      this._valueChanged("keep_text", this._keepTextCheckbox.checked);
    });
    this._lockSecondsInput.addEventListener("change", () => {
      const val = parseFloat(this._lockSecondsInput.value);
      this._valueChanged("lock_seconds", isNaN(val) || val < 0 ? 2 : val);
    });

    this._reloadLanguages();
  }

  async _reloadLanguages() {
    if (!this._hass || !this._languageSelect) return;
    const engineId = resolveTtsEntity(this._hass, this._config);
    const langs = await fetchTtsLanguages(this._hass, engineId);
    this._languagesLoaded = true;
    this._firstLanguage = langs[0] || null;
    populateSelect(
      this._languageSelect,
      langs.map((l) => ({ value: l, label: l })),
      "Engine's own default",
      this._config.language || ""
    );
    await this._reloadVoices();
  }

  async _reloadVoices() {
    if (!this._hass || !this._voiceSelect) return;
    const engineId = resolveTtsEntity(this._hass, this._config);
    const lang = this._languageSelect.value || this._firstLanguage;
    if (!engineId || !lang) {
      this._voicesCache = [];
      populateSelect(this._qualitySelect, [], "All qualities", "");
      populateSelect(this._voiceSelect, [], "Engine's own default", this._config.voice || "");
      return;
    }
    const voices = await fetchTtsVoices(this._hass, engineId, lang);
    this._voicesCache = voices;
    const qualities = sortQualities(
      [...new Set(voices.map((v) => parseVoiceQuality(v.voice_id)).filter(Boolean))]
    );
    populateSelect(
      this._qualitySelect,
      qualities.map((q) => ({ value: q, label: qualityLabel(q) })),
      "All qualities",
      this._qualitySelect.value
    );
    this._applyVoiceFilter();
  }

  _applyVoiceFilter() {
    const quality = this._qualitySelect.value;
    const filtered = quality
      ? this._voicesCache.filter((v) => parseVoiceQuality(v.voice_id) === quality)
      : this._voicesCache;
    populateSelect(
      this._voiceSelect,
      filtered.map((v) => ({ value: v.voice_id, label: v.name })),
      "Engine's own default",
      this._config.voice || ""
    );
  }

  _valueChanged(key, value) {
    if (!this._config) return;
    const newConfig = { ...this._config, [key]: value };
    if (value === "" || value === undefined) delete newConfig[key];
    if (key === "cache") newConfig.cache = value; // boolean, keep even when false
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("ha-text-to-speech-card", HaTextToSpeechCard);
customElements.define("ha-text-to-speech-card-editor", HaTextToSpeechCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-text-to-speech-card",
  name: "Text to Speech Card",
  description:
    "Paste or type any amount of text and speak it on any media_player speaker.",
  preview: true,
});
