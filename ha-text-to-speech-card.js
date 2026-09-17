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
 * time. The "Keep text after speaking" checkbox lives in that same Quick
 * settings panel - it's a live, this-session choice, not part of the saved
 * config, so it isn't touched by the Reset button either.
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
 *
 * Optional chunked playback ("Speak in chunks" in the editor): instead of
 * sending the whole box as one tts.speak call - which has to fully
 * synthesize before ANY of it plays, so long text has a long wait before
 * you hear anything - the text is split into chunks (by word count or
 * sentence count, your choice) and spoken one at a time. The Speak button
 * becomes Pause/Resume once a sequence is running, plus Previous/Next
 * chunk controls and a "chunk N of M" indicator. Resume always re-speaks
 * the CURRENT chunk from its start rather than trying to resume mid-audio
 * at some exact position - that's deliberate, since real pause/resume-at-
 * position support is inconsistent across different media_player
 * integrations, while "replay this chunk" behaves identically on any of
 * them. Advancing to the next chunk automatically is done by watching the
 * target media_player's own state, backed by a short timer: some
 * media_player integrations (including custom browser-based speakers)
 * never reliably report a literal "playing" state, so waiting forever to
 * observe one before honoring "it stopped" would leave playback stuck
 * needing a manual Next click for every remaining chunk. Instead there's a
 * brief grace period after a chunk starts (so a not-yet-started player
 * isn't mistaken for a finished one), a longer startup window after which
 * a never-seen "playing" state is trusted anyway, and an outer max-wait so
 * a stuck-reporting player can't hang the sequence indefinitely. A "not
 * playing" reading also has to hold steady for a bit before it's trusted -
 * some players report a brief gap between sentences/lines within the SAME
 * chunk, which without this would look identical to the chunk actually
 * finishing and cut it off after only its first line.
 *
 * While a chunked sequence is active, the textarea is swapped out for a
 * read-only display of the same text with the chunk currently being spoken
 * highlighted - editing is disabled for the duration (there's no textarea
 * to type into), which also keeps the chunk boundaries from drifting out
 * of sync with the text mid-sequence. The textarea comes back once the
 * sequence stops or finishes.
 *
 * Auto-advance's "is this chunk actually done" check has one more signal
 * on top of everything above: if the target media_player entity reports
 * an `is_announcing` attribute (added in Piper Browser Speaker
 * 2026.09.17.1+), that's used as the primary, precise, event-driven
 * finish signal instead of the word-count/measured-duration guessing -
 * it's a real true/false flip the moment that speaker's announcement
 * audio actually starts and stops, not an estimate, so it needs only a
 * tiny confirmation buffer instead of the multi-second padding the
 * guess-based approach needed to avoid cutting a chunk off early. This is
 * what closed the last couple of seconds of dead air the padding used to
 * leave between chunks. On any other media_player (or an older Piper
 * Browser Speaker) that doesn't expose this attribute, chunked playback
 * falls back to the estimate/state-based approach exactly as before -
 * this is a strict upgrade, never a regression, for anyone not on that
 * specific integration/version.
 *
 * The attach-file button (next to the image button) and dragging a file
 * onto the text box both also accept plain text files now, not just
 * images - a recognized text file's contents replace the box, same as an
 * OCR result does. Which extensions count is configurable in the editor
 * (default .txt/.md); an image drop/attach still runs OCR as before.
 *
 * The scissors button (also next to the image button) lets you snip part
 * of your own screen to read text from, for text that's on-screen but not
 * in an image file you already have - it's a thin wrapper around the
 * browser's own screen-share picker (getDisplayMedia): pick a tab/window/
 * screen, it grabs one frame and immediately stops the share again (never
 * leaves a live screen-share running), then you drag a selection box over
 * just the text you want before it runs through the same OCR as the other
 * image inputs. Desktop browsers only - getDisplayMedia isn't available on
 * mobile browsers, so this button won't do anything useful on a phone or
 * tablet.
 */

const CARD_VERSION = "2026.09.17.13";

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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_TEXT_FILE_EXTENSIONS = ".txt,.md";

function fileExtension(name) {
  const idx = String(name || "").lastIndexOf(".");
  return idx >= 0 ? String(name).slice(idx).toLowerCase() : "";
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

// ---- text-chunking helpers for optional chunked playback ----

// A short list of common abbreviations so simple sentence-splitting
// doesn't mistake "Dr. Smith" or "St. Louis" for two sentences. Not
// exhaustive - a determined edge case can still fool it - but it covers
// the common ones.
const SENTENCE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc",
  "approx", "fig", "no", "vol", "dept", "gov", "misc", "inc", "ltd", "co",
  "gen", "rev", "hon", "capt", "lt", "col", "sgt",
]);

function splitIntoSentences(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return [];
  // A boundary candidate: sentence-ending punctuation, optional closing
  // quote/paren, then whitespace. Scanned manually (not a single regex
  // split) so each candidate can be checked against the abbreviation list
  // and against whether the next word starts lowercase (usually means it
  // wasn't really a sentence end) before committing to split there.
  const boundary = /[.!?]+(["')\]]*)(\s+)/g;
  let match;
  let lastIndex = 0;
  const sentences = [];
  while ((match = boundary.exec(trimmed))) {
    const endIndex = match.index + match[0].length;
    const candidate = trimmed.slice(lastIndex, endIndex).trim();
    const wordMatch = candidate.match(/([A-Za-z]+)[.!?]+["')\]]*$/);
    const word = wordMatch ? wordMatch[1].toLowerCase() : "";
    const nextChar = trimmed[endIndex] || "";
    if (SENTENCE_ABBREVIATIONS.has(word) || /[a-z]/.test(nextChar)) {
      continue; // not a real sentence boundary - keep scanning
    }
    sentences.push(candidate);
    lastIndex = endIndex;
  }
  const remainder = trimmed.slice(lastIndex).trim();
  if (remainder) sentences.push(remainder);
  return sentences.length ? sentences : [trimmed];
}

function splitIntoWordChunks(text, wordsPerChunk) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const size = Math.max(1, wordsPerChunk);
  const chunks = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "));
  }
  return chunks;
}

function groupIntoChunks(sentences, sentencesPerChunk) {
  const size = Math.max(1, sentencesPerChunk);
  const chunks = [];
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size).join(" "));
  }
  return chunks;
}

const DEFAULT_WORDS_PER_CHUNK = 40;
const DEFAULT_SENTENCES_PER_CHUNK = 2;

// Auto-advance timing for chunked playback - see the header comment above
// for why this is time-based rather than purely state-pulse-based.
const CHUNK_START_GRACE_MS = 1500; // never trust a "not playing" reading before this
const CHUNK_STARTUP_TIMEOUT_MS = 6000; // give up waiting for a "playing" pulse after this
const CHUNK_STOP_CONFIRM_MS = 4000; // a "not playing" reading must hold steady this long
const CHUNK_MAX_WAIT_MS = 45000; // force-advance regardless, so a stuck player can't hang
const CHUNK_POLL_MS = 1000; // periodic backstop check, independent of hass push events

// Rough estimate of how long a chunk should take to actually speak, so a
// multi-sentence chunk can't be advanced past early just because some
// media_player's state reporting blipped or lagged (a genuine reported
// "not playing" - even one that holds steady past CHUNK_STOP_CONFIRM_MS,
// or a "playing" pulse that's simply slow to arrive past
// CHUNK_STARTUP_TIMEOUT_MS - is never trusted before this floor elapses).
// Deliberately generous (natural speech is usually a bit faster than this)
// since the cost of guessing too long is a short silent pause, while
// guessing too short is the exact "cut off mid-line" bug this exists to
// prevent. Bumped up several times (and CHUNK_STOP_CONFIRM_MS above raised
// alongside it each time) after reports that a chunk was still getting cut
// off near its end - each round got closer (most recently missing only the
// last ~4 words) rather than fixing it outright, so these keep moving in
// the same direction: raise the per-word rate for the longest chunks, and
// the flat latency allowance for a shortfall that shows up regardless of
// length.
const CHUNK_MS_PER_WORD_ESTIMATE = 520; // ~115 words/minute
const CHUNK_DURATION_FLOOR_MS = 3000; // minimum estimate, even for a one-word chunk
const CHUNK_DURATION_LATENCY_MS = 2800; // rough allowance for synthesis + network before audio starts

// A media_player's `is_announcing` attribute (when present - see the
// header comment) is a real event fired the instant that speaker's
// announcement audio actually stops, not a guess, so "not announcing"
// only needs a short debounce against a theoretical same-tick flicker -
// nothing like the multi-second CHUNK_STOP_CONFIRM_MS the guess-based
// fallback below needs to avoid cutting speech off early.
const CHUNK_ANNOUNCE_CONFIRM_MS = 300;

// Editor-configurable range for the "Fallback timing adjustment" slider -
// it starts at 0, meaning "use the built-in fallback timing exactly as-is",
// and can move either direction from there: negative shaves time off (less
// dead air, more cutoff risk on a slow-reporting speaker), positive adds
// more (the reverse trade). Only ever affects the word-count guess (i.e.
// only matters on a speaker that doesn't report `is_announcing`), letting
// it be tuned per-speaker from the card editor instead of needing a code
// change each time.
const CHUNK_FALLBACK_BUFFER_MIN_S = -10;
const CHUNK_FALLBACK_BUFFER_MAX_S = 15;
const CHUNK_FALLBACK_BUFFER_STEP_S = 0.5;

// However far negative the adjustment above goes, a chunk's estimated
// duration is never allowed to drop below this - otherwise a large enough
// negative value could make the estimate hit zero (or go negative) and
// advance instantly/skip chunks entirely, rather than just being more
// aggressive about timing.
const CHUNK_DURATION_HARD_FLOOR_MS = 500;

function estimateChunkDurationMs(text, extraAdjustmentMs) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  const base =
    Math.max(CHUNK_DURATION_FLOOR_MS, words * CHUNK_MS_PER_WORD_ESTIMATE) +
    CHUNK_DURATION_LATENCY_MS;
  return Math.max(CHUNK_DURATION_HARD_FLOOR_MS, base + (extraAdjustmentMs || 0));
}

function defaultChunkSize(splitBy) {
  return splitBy === "sentences" ? DEFAULT_SENTENCES_PER_CHUNK : DEFAULT_WORDS_PER_CHUNK;
}

// Small safety margin added on top of a MEASURED clip duration (from
// _probeChunkDuration) before trusting it - the probe measures how long
// the audio file itself is, but there's still a little real-world slack
// between "we measured this" and "the target speaker's actual playback
// finishes" (decode/output latency on the target device, etc).
const CHUNK_PRECISE_BUFFER_MS = 500;
const CHUNK_DURATION_PROBE_TIMEOUT_MS = 4000; // give up on the probe and keep the guess after this

// Loads a media URL into a throwaway <audio> element just far enough to
// read its real `duration`, without ever playing it audibly (the target
// media_player is what actually plays the clip out loud - this is a
// second, silent load of the same file purely to measure it). Resolves to
// the duration in milliseconds, or null if the URL fails to load or the
// probe times out (e.g. a slow/unreachable network) - callers fall back
// to the word-count guess in that case.
function probeAudioDurationMs(url) {
  return new Promise((resolve) => {
    let done = false;
    const audio = new Audio();
    const finish = (result) => {
      if (done) return;
      done = true;
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onError);
      audio.src = "";
      resolve(result);
    };
    const onMeta = () => {
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null);
    };
    const onError = () => finish(null);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onError);
    audio.preload = "metadata";
    audio.src = url;
    setTimeout(() => finish(null), CHUNK_DURATION_PROBE_TIMEOUT_MS);
  });
}

// Some HA versions/services reject a call outright when return_response is
// requested from a service that doesn't support it at all ("An action
// which does not return responses can't be called with return_response"),
// rather than just returning no response data - so this has to be caught
// and treated as "unsupported, fall back" instead of a real speak failure.
function isReturnResponseUnsupportedError(err) {
  const message = (err && err.message ? err.message : String(err || "")).toLowerCase();
  return message.includes("return_response") || message.includes("does not return responses");
}

function buildChunks(text, splitBy, size) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (splitBy === "sentences") {
    return groupIntoChunks(splitIntoSentences(trimmed), size);
  }
  return splitIntoWordChunks(trimmed, size);
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
  .buffer-control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    max-width: 60%;
  }
  .buffer-control input[type="range"] {
    flex: 1;
    accent-color: var(--primary-color, #03a9f4);
  }
  .buffer-control input[type="number"] {
    width: 56px;
    flex: none;
    padding: 6px;
    border-radius: 6px;
    border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #000);
  }
  .hint {
    font-size: 11px;
    color: var(--secondary-text-color, #888);
    margin: -4px 0 0;
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
  .snip-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px;
    box-sizing: border-box;
  }
  .snip-overlay[hidden] { display: none; }
  .snip-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    max-width: 90vw;
  }
  .snip-hint {
    color: #fff;
    font-size: 13px;
  }
  .snip-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .snip-actions .text-btn {
    color: #fff;
  }
  .snip-actions .speak-btn:disabled {
    opacity: 0.4;
  }
  .snip-canvas-wrap {
    position: relative;
    display: inline-block;
    max-width: 90vw;
    max-height: 75vh;
    line-height: 0;
  }
  .snip-canvas-wrap canvas {
    display: block;
    max-width: 90vw;
    max-height: 75vh;
    cursor: crosshair;
    touch-action: none;
  }
  .snip-selection {
    position: absolute;
    border: 2px dashed #fff;
    background: rgba(3, 169, 244, 0.25);
    pointer-events: none;
  }
  .snip-selection[hidden] { display: none; }
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
    if (this._chunkQueue && !config.chunked_playback) {
      this._cancelChunks();
    }
    this._config = config;
    this._overrides = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._updateStatus();
    this._checkChunkFinished();
    // self-heals the chunk row/indicator if anything ever leaves it out of
    // sync with the real queue/index - cheap, and runs on every hass tick
    this._renderChunkControls();
  }

  disconnectedCallback() {
    this._stopChunkTimer();
    if (this._snipEscapeHandler) {
      window.removeEventListener("keydown", this._snipEscapeHandler);
    }
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

  // Adjustment (in ms, positive or negative) applied to the word-count
  // fallback guess only - set from the "Fallback timing adjustment" slider
  // in the editor. Never touches the precise is_announcing/measured-
  // duration paths, since those don't need any adjusting.
  _chunkFallbackBufferMs() {
    const v = this._config && this._config.chunk_fallback_buffer_seconds;
    return typeof v === "number" && !isNaN(v) ? v * 1000 : 0;
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
          min-height: 0;
          position: relative;
          container-type: inline-size;
          container-name: ha-tts-card;
        }
        /* Deliberately laid out in the normal flow (not floated/overlaid on
           top of anything) - an earlier version pinned this to the card's
           bottom-right corner, which ended up sitting right on top of the
           Speak/Pause/Stop row and the gear icon, blocking them instead of
           just informing. This just adds its own height to the card like
           any other row, so it can never cover a button. */
        .chunk-debug {
          position: relative;
          background: rgba(0, 0, 0, 0.82);
          color: #7CFC7C;
          font-family: monospace;
          font-size: 11px;
          line-height: 1.5;
          padding: 8px 28px 8px 10px;
          border-radius: 6px;
          white-space: pre-wrap;
        }
        .chunk-debug[hidden] { display: none; }
        .chunk-debug-close {
          position: absolute;
          top: 4px;
          right: 4px;
          appearance: none;
          border: none;
          background: none;
          color: #7CFC7C;
          font-family: monospace;
          font-size: 14px;
          line-height: 1;
          padding: 2px 6px;
          cursor: pointer;
          opacity: 0.8;
        }
        .chunk-debug-close:hover { opacity: 1; }
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
        .textarea-wrap {
          position: relative;
          flex: 1;
          display: flex;
          min-height: 0;
        }
        .textarea-wrap textarea {
          flex: 1;
        }
        .chunk-display {
          flex: 1;
          min-height: 0;
          max-height: 100%;
          box-sizing: border-box;
          overflow-y: auto;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.5;
          padding: 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          white-space: pre-wrap;
        }
        .chunk-piece {
          transition: background 0.15s ease, color 0.15s ease;
        }
        .chunk-piece.active {
          background: var(--primary-color, #03a9f4);
          color: #fff;
          border-radius: 3px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .clear-btn {
          position: absolute;
          top: 6px;
          right: 6px;
          appearance: none;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          background: var(--card-background-color, #fff);
          color: var(--secondary-text-color, #888);
          font-size: 11px;
          padding: 2px 8px;
          cursor: pointer;
          opacity: 0.75;
        }
        .clear-btn:hover {
          opacity: 1;
          background: var(--secondary-background-color, #f0f0f0);
        }
        .clear-btn:active {
          transform: translateY(1px);
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .actions-row {
          grid-area: actions;
          display: flex;
          justify-content: flex-end;
          min-width: 0;
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
        /* Groups the chunk-nav arrows, the icon/Speak buttons, and Stop into
           one responsive layout instead of three independent rows, so their
           line arrangement can actually change on a narrow card (see the
           container query below) rather than just wrapping wherever flex
           happens to break - a plain flex-wrap couldn't put Stop on its own
           line when there's room, but move it in next to the arrows when
           there isn't. */
        .chunk-controls {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-areas:
            "nav actions"
            "stop stop";
          column-gap: 8px;
          row-gap: 6px;
          align-items: center;
        }
        @container ha-tts-card (max-width: 440px) {
          .chunk-controls {
            grid-template-areas:
              "actions actions"
              "nav stop";
          }
        }
        .chunk-row {
          grid-area: stop;
          display: flex;
          justify-content: flex-end;
        }
        .chunk-nav-row {
          grid-area: nav;
          display: flex;
          justify-content: flex-start;
          min-width: 0;
        }
        .chunk-nav {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .chunk-nav .icon-btn {
          width: 28px;
          height: 28px;
          font-size: 12px;
        }
        .chunk-indicator {
          display: inline-block;
          min-width: 64px;
          text-align: center;
          font-size: 12px;
          color: var(--secondary-text-color, #888);
        }
        ${SETTINGS_CSS}
      </style>
      <ha-card header="${title}">
        <div class="card-content">
          <div class="textarea-wrap">
            <textarea
              id="tts-text"
              placeholder="Type or paste text to speak..."
            ></textarea>
            <div id="chunk-display" class="chunk-display" hidden></div>
            <button id="clear-btn" class="clear-btn" type="button" title="Clear text">Clear</button>
          </div>
          <div class="chunk-controls">
            <div id="chunk-nav-row" class="chunk-nav-row" hidden>
              <div class="chunk-nav">
                <button id="chunk-prev" class="icon-btn" type="button" title="Previous chunk">&#9664;</button>
                <span id="chunk-indicator" class="chunk-indicator"></span>
                <button id="chunk-next" class="icon-btn" type="button" title="Next chunk">&#9654;</button>
              </div>
            </div>
            <div class="actions-row">
              <div class="actions">
                <input id="image-file" type="file" accept="image/*" hidden />
                <input id="text-file" type="file" hidden />
                <button id="image-btn" class="icon-btn" title="Read text from an image (or drag/drop or paste one into the box)">&#128247;</button>
                <button id="snip-btn" class="icon-btn" title="Snip part of your screen to read text from">&#9986;&#65039;</button>
                <button id="attach-btn" class="icon-btn" title="Attach a text file (or drag/drop one into the box)">&#128206;</button>
                <button id="settings-toggle" class="icon-btn" title="Quick settings">&#9881;</button>
                <button id="speak-btn" class="speak-btn" type="button">Speak</button>
              </div>
            </div>
            <div id="chunk-row" class="chunk-row" hidden>
              <button id="chunk-stop" class="text-btn" type="button">Stop</button>
            </div>
          </div>
          <div class="row">
            <span id="target-name" class="target"></span>
          </div>
          <div id="chunk-debug" class="chunk-debug" hidden>
            <button id="chunk-debug-close" class="chunk-debug-close" type="button" title="Hide for this sequence">&#10005;</button>
            <div id="chunk-debug-text"></div>
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
            <div class="settings-row checkbox-row">
              <label><input id="keep-text" type="checkbox" /> Keep text after speaking</label>
            </div>
            <div class="settings-actions">
              <span class="hint">Applies to your next message only.</span>
              <button id="quick-reset" class="text-btn">Reset to saved settings</button>
            </div>
          </div>
          <div id="snip-overlay" class="snip-overlay" hidden>
            <div class="snip-toolbar">
              <span class="snip-hint">Drag to select the text you want, then Convert.</span>
              <div class="snip-actions">
                <button id="snip-cancel" class="text-btn" type="button">Cancel</button>
                <button id="snip-confirm" class="speak-btn" type="button" disabled>Convert to text</button>
              </div>
            </div>
            <div id="snip-canvas-wrap" class="snip-canvas-wrap">
              <canvas id="snip-canvas"></canvas>
              <div id="snip-selection" class="snip-selection" hidden></div>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    this._textarea = this.shadowRoot.getElementById("tts-text");
    this._clearBtn = this.shadowRoot.getElementById("clear-btn");
    this._speakBtn = this.shadowRoot.getElementById("speak-btn");
    this._imageBtn = this.shadowRoot.getElementById("image-btn");
    this._imageFileInput = this.shadowRoot.getElementById("image-file");
    this._attachBtn = this.shadowRoot.getElementById("attach-btn");
    this._textFileInput = this.shadowRoot.getElementById("text-file");
    this._snipBtn = this.shadowRoot.getElementById("snip-btn");
    this._snipOverlay = this.shadowRoot.getElementById("snip-overlay");
    this._snipCanvasWrap = this.shadowRoot.getElementById("snip-canvas-wrap");
    this._snipCanvas = this.shadowRoot.getElementById("snip-canvas");
    this._snipSelection = this.shadowRoot.getElementById("snip-selection");
    this._snipCancelBtn = this.shadowRoot.getElementById("snip-cancel");
    this._snipConfirmBtn = this.shadowRoot.getElementById("snip-confirm");
    this._snipDragState = null;
    this._chunkDisplay = this.shadowRoot.getElementById("chunk-display");
    this._chunkRow = this.shadowRoot.getElementById("chunk-row");
    this._chunkNavRow = this.shadowRoot.getElementById("chunk-nav-row");
    this._chunkPrevBtn = this.shadowRoot.getElementById("chunk-prev");
    this._chunkNextBtn = this.shadowRoot.getElementById("chunk-next");
    this._chunkStopBtn = this.shadowRoot.getElementById("chunk-stop");
    this._chunkIndicator = this.shadowRoot.getElementById("chunk-indicator");
    this._chunkDebug = this.shadowRoot.getElementById("chunk-debug");
    this._chunkDebugText = this.shadowRoot.getElementById("chunk-debug-text");
    this._chunkDebugCloseBtn = this.shadowRoot.getElementById("chunk-debug-close");
    this._chunkDebugCloseBtn.addEventListener("click", () => {
      // dismiss just for the rest of THIS sequence, not the editor setting -
      // it comes back on the next Speak so it's still there next time it's
      // actually wanted, without having to dig back into the card editor
      this._chunkDebugDismissed = true;
      this._renderChunkDebug();
    });
    this._chunkQueue = null;
    this._chunkIndex = 0;
    this._chunkState = "idle";
    this._chunkStartedAt = null;
    this._chunkMinDurationMs = null;
    this._chunkDurationIsPrecise = false;
    this._chunkObservedPlaying = false;
    this._chunkNotPlayingSince = null;
    this._chunkPollTimer = null;
    this._ttsResponseUnsupported = false; // learned the first time a speak call needs it
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

    this._speakBtn.addEventListener("click", () => {
      if (this._config && this._config.chunked_playback) {
        this._chunkPlayPauseResume();
      } else {
        this._speak();
      }
    });
    this._chunkPrevBtn.addEventListener("click", () => this._prevChunk());
    this._chunkNextBtn.addEventListener("click", () => this._nextChunkManual());
    this._chunkStopBtn.addEventListener("click", () => this._cancelChunks());
    this._clearBtn.addEventListener("click", () => {
      this._textarea.value = "";
      this._textarea.focus();
    });
    this._imageBtn.addEventListener("click", () => this._imageFileInput.click());
    this._imageFileInput.addEventListener("change", () => {
      const file = this._imageFileInput.files && this._imageFileInput.files[0];
      this._imageFileInput.value = ""; // allow picking the same file again
      if (file) this._handleImageFile(file);
    });
    this._attachBtn.addEventListener("click", () => {
      this._textFileInput.accept = this._allowedTextExtensions().join(",");
      this._textFileInput.click();
    });
    this._textFileInput.addEventListener("change", () => {
      const file = this._textFileInput.files && this._textFileInput.files[0];
      this._textFileInput.value = ""; // allow picking the same file again
      if (file) this._handleTextFile(file);
    });
    this._snipBtn.addEventListener("click", () => this._startSnip());
    this._snipCancelBtn.addEventListener("click", () => this._closeSnipOverlay());
    this._snipConfirmBtn.addEventListener("click", () => this._confirmSnip());
    this._snipOverlay.addEventListener("click", (ev) => {
      if (ev.target === this._snipOverlay) this._closeSnipOverlay();
    });
    // listened on window rather than the overlay itself - focus normally
    // stays on the button that opened it, which sits outside the overlay,
    // so a keydown there wouldn't bubble through the overlay's own tree.
    // Stored so disconnectedCallback can remove it and not leak.
    this._snipEscapeHandler = (ev) => {
      if (ev.key === "Escape" && this._snipOverlay && !this._snipOverlay.hidden) {
        this._closeSnipOverlay();
      }
    };
    window.addEventListener("keydown", this._snipEscapeHandler);
    this._snipCanvas.addEventListener("pointerdown", (ev) => {
      const rect = this._snipCanvas.getBoundingClientRect();
      const x = clamp(ev.clientX - rect.left, 0, rect.width);
      const y = clamp(ev.clientY - rect.top, 0, rect.height);
      this._snipDragState = { startX: x, startY: y, rect: { left: x, top: y, width: 0, height: 0 } };
      this._snipSelection.hidden = false;
      this._positionSnipSelection(this._snipDragState.rect);
      this._snipCanvas.setPointerCapture(ev.pointerId);
    });
    this._snipCanvas.addEventListener("pointermove", (ev) => {
      if (!this._snipDragState) return;
      const rect = this._snipCanvas.getBoundingClientRect();
      const x = clamp(ev.clientX - rect.left, 0, rect.width);
      const y = clamp(ev.clientY - rect.top, 0, rect.height);
      const left = Math.min(this._snipDragState.startX, x);
      const top = Math.min(this._snipDragState.startY, y);
      const width = Math.abs(x - this._snipDragState.startX);
      const height = Math.abs(y - this._snipDragState.startY);
      this._snipDragState.rect = { left, top, width, height };
      this._positionSnipSelection(this._snipDragState.rect);
    });
    this._snipCanvas.addEventListener("pointerup", () => {
      if (!this._snipDragState) return;
      this._snipConfirmBtn.disabled = false;
    });
    this._textarea.addEventListener("dragover", (ev) => {
      if (!this._dragHasFile(ev.dataTransfer)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      this._textarea.classList.add("drag-over");
    });
    this._textarea.addEventListener("dragleave", () => {
      this._textarea.classList.remove("drag-over");
    });
    this._textarea.addEventListener("drop", (ev) => {
      this._textarea.classList.remove("drag-over");
      if (!this._dragHasFile(ev.dataTransfer)) return; // let plain text/link drops behave normally
      ev.preventDefault();
      const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (!file) return;
      if (file.type && file.type.startsWith("image/")) {
        this._handleImageFile(file);
      } else if (this._allowedTextExtensions().includes(fileExtension(file.name))) {
        this._handleTextFile(file);
      } else {
        this._flashStatus(
          `Unsupported file type - drop an image or a ${this._allowedTextExtensions().join("/")} file`,
          true,
          3500
        );
      }
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

  // Broader than _dragHasImage - claims the drag for ANY file (image or
  // not) so dragover can preventDefault and show the drop affordance. The
  // browser doesn't expose a dragged file's NAME (only its MIME type,
  // which is unreliable for something like .md) until the actual drop, so
  // the real image-vs-text-vs-unsupported decision happens in the drop
  // handler itself, not here.
  _dragHasFile(dataTransfer) {
    if (!dataTransfer) return false;
    const items = dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") return true;
      }
      return false;
    }
    return Array.prototype.includes.call(dataTransfer.types || [], "Files");
  }

  // Config-driven allow-list for the attach button / drag-drop text-file
  // path, e.g. ".txt,.md" -> [".txt", ".md"]. Always lowercase, always
  // dot-prefixed, regardless of how the user typed it in the editor.
  _allowedTextExtensions() {
    const raw =
      (this._config && this._config.text_file_extensions) || DEFAULT_TEXT_FILE_EXTENSIONS;
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => (s.startsWith(".") ? s : "." + s));
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

  async _handleTextFile(file) {
    if (!file) return;
    this._attachBtn.disabled = true;
    this._imageBtn.disabled = true;
    try {
      const text = await file.text();
      const cleaned = (text || "").trim();
      if (!cleaned) {
        this._flashStatus("That file was empty", true, 3000);
      } else {
        this._textarea.value = cleaned;
        this._flashStatus("Text loaded from file", false, 2000);
      }
    } catch (err) {
      this._flashStatus(
        "Couldn't read that file: " + (err && err.message ? err.message : err),
        true,
        4000
      );
    } finally {
      this._attachBtn.disabled = false;
      this._imageBtn.disabled = false;
    }
  }

  // Grabs a single frame of whatever tab/window/screen the user picks via
  // the browser's native screen-share prompt, then opens the crop overlay
  // on it. The share is stopped again immediately after that one frame -
  // this never leaves a live screen-share running.
  async _startSnip() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      this._flashStatus("Screen capture isn't supported in this browser", true, 4000);
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (err) {
      // user cancelled the picker - not worth flashing as an error
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
      if (video.readyState < 2) {
        await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
      }
      this._snipCanvas.width = video.videoWidth;
      this._snipCanvas.height = video.videoHeight;
      this._snipCanvas.getContext("2d").drawImage(video, 0, 0, this._snipCanvas.width, this._snipCanvas.height);
      this._openSnipOverlay();
    } catch (err) {
      this._flashStatus(
        "Couldn't capture the screen: " + (err && err.message ? err.message : err),
        true,
        4000
      );
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  _openSnipOverlay() {
    if (!this._snipOverlay) return;
    this._snipDragState = null;
    this._snipSelection.hidden = true;
    this._snipConfirmBtn.disabled = true;
    this._snipOverlay.hidden = false;
  }

  _closeSnipOverlay() {
    if (this._snipOverlay) this._snipOverlay.hidden = true;
    this._snipDragState = null;
  }

  _positionSnipSelection(rect) {
    if (!this._snipSelection) return;
    this._snipSelection.style.left = rect.left + "px";
    this._snipSelection.style.top = rect.top + "px";
    this._snipSelection.style.width = rect.width + "px";
    this._snipSelection.style.height = rect.height + "px";
  }

  // Crops the captured frame to whatever was dragged (or the whole frame,
  // if nothing was dragged) and runs it through the same OCR path as the
  // camera button / attach / drag-drop.
  _confirmSnip() {
    const canvas = this._snipCanvas;
    const rect = canvas.getBoundingClientRect();
    let sel = this._snipDragState && this._snipDragState.rect;
    if (!sel || sel.width < 4 || sel.height < 4) {
      sel = { left: 0, top: 0, width: rect.width, height: rect.height };
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sx = sel.left * scaleX;
    const sy = sel.top * scaleY;
    const sw = sel.width * scaleX;
    const sh = sel.height * scaleY;
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(sw));
    cropped.height = Math.max(1, Math.round(sh));
    cropped.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, cropped.width, cropped.height);
    this._closeSnipOverlay();
    cropped.toBlob((blob) => {
      if (blob) this._handleImageFile(blob);
    }, "image/png");
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

  // ---- chunked playback ----

  _chunkPlayPauseResume() {
    if (this._chunkState === "playing") {
      this._pauseChunks();
    } else if (this._chunkState === "paused") {
      this._resumeChunks();
    } else {
      this._startChunkedSpeak();
    }
  }

  async _startChunkedSpeak() {
    if (!this._hass || !this._config || !this._config.entity) {
      this._flashError("No target speaker configured");
      return;
    }
    const text = (this._textarea.value || "").trim();
    if (!text) return;
    const splitBy = this._config.chunk_split_by === "words" ? "words" : "sentences";
    const size = this._config.chunk_size || defaultChunkSize(splitBy);
    const chunks = buildChunks(text, splitBy, size);
    if (!chunks.length) return;

    this._chunkQueue = chunks;
    this._chunkIndex = 0;
    this._chunkDebugDismissed = false; // a fresh sequence brings the debug panel back, if it's on
    this._enterChunkDisplayMode();

    // same double-tap lock as a normal Speak click, but only for kicking
    // off a brand-new sequence - Pause/Resume/Next/Prev stay responsive
    const lockMs = this._lockSeconds() * 1000;
    const startedAt = Date.now();
    this._speakBtn.disabled = true;
    this._imageBtn.disabled = true;
    await this._playCurrentChunk();
    const remaining = lockMs - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    this._speakBtn.disabled = false;
    this._imageBtn.disabled = false;
  }

  async _playCurrentChunk() {
    if (!this._chunkQueue) return;
    const ttsEntityId = this._config.tts_entity || this._findDefaultTtsEntity();
    if (!ttsEntityId) {
      this._flashError("No TTS engine (tts.*) found in this HA instance");
      this._cancelChunks();
      return;
    }

    const ov = this._overrides || this._defaultsFromConfig();
    const data = {
      media_player_entity_id: this._config.entity,
      message: this._chunkQueue[this._chunkIndex],
      cache: ov.cache !== false,
    };
    if (ov.language) data.language = ov.language;
    const options = {};
    if (ov.voice) options.voice = ov.voice;
    if (Object.keys(options).length) data.options = options;

    this._chunkState = "playing";
    this._chunkStartedAt = Date.now();
    // Word-count guess up front so playback timing has *something* to go
    // on immediately - _probeChunkDuration() below replaces this with the
    // real, measured clip length as soon as it's available (usually well
    // before the guess would matter), which is what actually fixes chunks
    // getting cut off: no more guessing at all once we have it.
    this._chunkMinDurationMs = estimateChunkDurationMs(
      this._chunkQueue[this._chunkIndex],
      this._chunkFallbackBufferMs()
    );
    this._chunkDurationIsPrecise = false;
    this._chunkObservedPlaying = false;
    this._chunkNotPlayingSince = null;
    this._chunkGeneration = (this._chunkGeneration || 0) + 1;
    const myGeneration = this._chunkGeneration;
    this._startChunkTimer();
    this._updateChunkButtonLabel();
    this._renderChunkControls();
    this._renderChunkDisplay();
    this._renderChunkDebug();

    try {
      let result;
      if (!this._ttsResponseUnsupported) {
        try {
          result = await this._hass.callService(
            "tts",
            "speak",
            data,
            { entity_id: ttsEntityId },
            false,
            true // request response data - see _probeChunkDuration()
          );
        } catch (err) {
          if (!isReturnResponseUnsupportedError(err)) throw err;
          // this HA version's tts.speak doesn't support response data at
          // all - asking for it makes the WHOLE call fail validation
          // before anything is spoken, so remember that for the rest of
          // this session and actually retry for real, without it, rather
          // than silently leaving Speak broken.
          this._ttsResponseUnsupported = true;
          result = await this._hass.callService("tts", "speak", data, { entity_id: ttsEntityId });
        }
      } else {
        result = await this._hass.callService("tts", "speak", data, { entity_id: ttsEntityId });
      }
      this._probeChunkDuration(result, myGeneration);
    } catch (err) {
      this._flashError("Speak failed: " + (err && err.message ? err.message : err));
      this._cancelChunks();
    }
  }

  // tts.speak can return the actual generated clip's URL as response data
  // (HA versions that support it - older ones simply won't, and this is a
  // no-op fallback to the word-count guess in that case). When we get a
  // URL, load it into a throwaway <audio> element just far enough to read
  // its real `duration` - the exact length of the clip that's now playing
  // on the target speaker - and use THAT instead of a guess. This is what
  // actually solves chunks getting cut off, rather than tuning how
  // cautious the word-count guess and its safety margins are: previous
  // fixes (debounce, then a duration estimate) each narrowed the problem
  // without eliminating it, because they were all still guessing.
  async _probeChunkDuration(serviceCallResult, generation) {
    const url =
      (serviceCallResult &&
        serviceCallResult.response &&
        (serviceCallResult.response.url || serviceCallResult.response.path)) ||
      null;
    if (!url || typeof url !== "string") return; // unsupported HA version - keep the guess

    const measuredMs = await probeAudioDurationMs(url);
    // the sequence may have moved on (manual Next/Prev, Stop, or a new
    // chunk already started) by the time this resolves - only apply it if
    // we're still timing the same chunk it was measured for
    if (!measuredMs || this._chunkGeneration !== generation) return;
    this._chunkMinDurationMs = measuredMs + CHUNK_PRECISE_BUFFER_MS;
    this._chunkDurationIsPrecise = true;
  }

  async _pauseChunks() {
    if (this._chunkState !== "playing") return;
    // flip state before the (async) stop call so the finish-checker below
    // sees we're intentionally paused, not that the chunk finished
    this._chunkState = "paused";
    this._stopChunkTimer();
    this._updateChunkButtonLabel();
    this._renderChunkControls();
    this._renderChunkDebug();
    if (!this._hass || !this._config || !this._config.entity) return;
    try {
      await this._hass.callService(
        "media_player",
        "media_stop",
        {},
        { entity_id: this._config.entity }
      );
    } catch (err) {
      // some players don't support media_stop cleanly - not worth
      // surfacing as an error, the pause still took effect on our side
    }
  }

  _resumeChunks() {
    if (this._chunkState !== "paused") return;
    // re-speak the SAME chunk from its start - see the header comment for
    // why this is more reliable than trying to resume mid-clip
    this._playCurrentChunk();
  }

  _prevChunk() {
    if (!this._chunkQueue || this._chunkIndex <= 0) return;
    this._chunkIndex--;
    this._playCurrentChunk();
  }

  _nextChunkManual() {
    if (!this._chunkQueue) return;
    if (this._chunkIndex < this._chunkQueue.length - 1) {
      this._chunkIndex++;
      this._playCurrentChunk();
    } else {
      this._finishChunks();
    }
  }

  _finishChunks() {
    this._chunkQueue = null;
    this._chunkIndex = 0;
    this._chunkState = "idle";
    this._stopChunkTimer();
    this._chunkStartedAt = null;
    this._chunkMinDurationMs = null;
    this._chunkDurationIsPrecise = false;
    this._chunkObservedPlaying = false;
    this._chunkNotPlayingSince = null;
    this._updateChunkButtonLabel();
    this._renderChunkControls();
    this._exitChunkDisplayMode();
    this._renderChunkDebug();
    if (this._keepTextCheckbox && !this._keepTextCheckbox.checked) {
      this._textarea.value = "";
    }
  }

  // Stop must always actually stop, even if the internal bookkeeping thinks
  // there's nothing to stop (e.g. after some other bug leaves the row
  // visible with stale state) - the user's goal in clicking it is "make the
  // sound stop," not "only do something if my own state agrees a sequence
  // is running." So this resets state and sends media_stop unconditionally
  // rather than bailing out early, and it's safe to call repeatedly.
  async _cancelChunks() {
    this._chunkQueue = null;
    this._chunkIndex = 0;
    this._chunkState = "idle";
    this._stopChunkTimer();
    this._chunkStartedAt = null;
    this._chunkMinDurationMs = null;
    this._chunkDurationIsPrecise = false;
    this._chunkObservedPlaying = false;
    this._chunkNotPlayingSince = null;
    this._updateChunkButtonLabel();
    this._renderChunkControls();
    this._exitChunkDisplayMode();
    this._renderChunkDebug();
    if (!this._hass || !this._config || !this._config.entity) return;
    try {
      await this._hass.callService(
        "media_player",
        "media_stop",
        {},
        { entity_id: this._config.entity }
      );
    } catch (err) {
      // best-effort
    }
  }

  _startChunkTimer() {
    this._stopChunkTimer();
    this._chunkPollTimer = setInterval(() => this._checkChunkFinished(), CHUNK_POLL_MS);
  }

  _stopChunkTimer() {
    if (this._chunkPollTimer) {
      clearInterval(this._chunkPollTimer);
      this._chunkPollTimer = null;
    }
  }

  // Called on every hass update (hass updates on every entity state change
  // anywhere in the system) and on a periodic poll as a backstop. See the
  // header comment for why this leans on elapsed time rather than only
  // waiting to observe a literal "playing" state - some media_player
  // integrations never report one reliably, which used to leave auto-
  // advance stuck needing a manual click for every remaining chunk.
  _checkChunkFinished() {
    this._renderChunkDebug();
    if (!this._chunkQueue || this._chunkState !== "playing") return;
    if (!this._config || !this._config.entity || !this._hass) return;

    const elapsed = Date.now() - (this._chunkStartedAt || 0);
    const minDuration = this._chunkMinDurationMs || CHUNK_DURATION_FLOOR_MS;
    const state = this._hass.states[this._config.entity];

    // Best signal available: a real is_announcing attribute (Piper Browser
    // Speaker 2026.09.17.1+ and anything else that chooses to expose one),
    // reported live off the actual announcement audio's own play/pause/
    // ended events on that speaker - not a guess about how long speech
    // "should" take. When it's present it takes priority over everything
    // else below, and needs only a short debounce rather than multi-
    // second padding, since it's precise rather than estimated.
    const announcing =
      state && state.attributes && state.attributes.is_announcing !== undefined
        ? !!state.attributes.is_announcing
        : null;

    if (announcing !== null) {
      if (announcing) {
        this._chunkObservedPlaying = true;
        this._chunkNotPlayingSince = null;
        // guard against a stuck "true" forever (e.g. a media error on the
        // speaker that never fires its own "ended") - same outer safety
        // net as the other paths use
        if (elapsed > Math.max(CHUNK_MAX_WAIT_MS, minDuration * 2)) this._advanceChunk();
        return;
      }
      if (elapsed < CHUNK_START_GRACE_MS) return; // hasn't actually started yet
      if (!this._chunkObservedPlaying) {
        // never saw it flip true - give it the same startup grace the
        // fallback path uses before assuming something's wrong
        if (elapsed < CHUNK_STARTUP_TIMEOUT_MS) return;
        this._advanceChunk();
        return;
      }
      // it was observed announcing and is now reporting it stopped - a
      // real event, so only a brief debounce is needed before trusting it
      if (this._chunkNotPlayingSince == null) this._chunkNotPlayingSince = Date.now();
      if (Date.now() - this._chunkNotPlayingSince < CHUNK_ANNOUNCE_CONFIRM_MS) return;
      this._advanceChunk();
      return;
    }

    // Once _probeChunkDuration() has measured this chunk's ACTUAL clip
    // length (not just guessed it from word count), trust that directly
    // rather than also waiting on the target media_player's own state -
    // that state reporting is exactly what's been unreliable across every
    // earlier attempt at this bug. This is the fallback for when neither
    // is_announcing nor a measurement is available (an entity that
    // doesn't expose is_announcing, on an older HA version that also
    // doesn't return tts.speak response data, or the probe itself
    // failing/timing out).
    if (this._chunkDurationIsPrecise) {
      if (elapsed >= minDuration) this._advanceChunk();
      return;
    }

    const current = state ? state.state : null;

    if (current === "playing") {
      this._chunkObservedPlaying = true;
      // a genuine "playing" reading means it's NOT actually stopped, even
      // if it looked that way a moment ago - cancel any pending advance
      this._chunkNotPlayingSince = null;
      // stuck reporting "playing" way past any reasonable chunk length -
      // don't let it hang the whole sequence
      if (elapsed > Math.max(CHUNK_MAX_WAIT_MS, minDuration * 2)) this._advanceChunk();
      return;
    }

    if (elapsed < CHUNK_START_GRACE_MS) return; // too early to judge - still starting up

    // Not "playing" right now - but a brief dip here doesn't necessarily
    // mean the chunk is done. Some players report a short gap between
    // sentences/lines within the SAME utterance (this is what caused a
    // chunk to get cut off after only its first line, advancing early on
    // that first gap) - so a "not playing" reading has to hold steady for
    // CHUNK_STOP_CONFIRM_MS before it's trusted, not acted on immediately.
    if (this._chunkNotPlayingSince == null) this._chunkNotPlayingSince = Date.now();
    const notPlayingFor = Date.now() - this._chunkNotPlayingSince;
    if (notPlayingFor < CHUNK_STOP_CONFIRM_MS) return;

    // Even a confirmed, steady "not playing" reading is ignored before the
    // chunk's own estimated speaking time has passed - a multi-sentence
    // chunk simply can't be done in under a couple of seconds, no matter
    // what the media_player claims, and this is what a status-reporting
    // blip/lag actually looked like in practice (Stop cancelling the
    // auto-advance timer let the SAME audio finish correctly on its own,
    // proving the audio itself was fine and only this check was too eager).
    if (elapsed < minDuration) return;

    // confirmed stopped - trust it once we've either seen this chunk
    // actually start playing at some point, or given up waiting for that
    // pulse (this integration may never send one)
    if (this._chunkObservedPlaying || elapsed > Math.max(CHUNK_STARTUP_TIMEOUT_MS, minDuration)) {
      this._advanceChunk();
    }
  }

  // Live info panel for the "Show chunk timing debug info" editor option -
  // shows exactly what auto-advance is looking at right now (which signal
  // it's using, the raw is_announcing value, elapsed vs. minimum-duration
  // time, etc), so a timing problem can be watched happening instead of
  // guessed at from the outside. Purely a read of current state - never
  // changes any playback behavior itself.
  _renderChunkDebug() {
    if (!this._chunkDebug) return;
    const enabled = this._config && this._config.debug_chunk_info === true;
    if (!enabled || !this._chunkQueue || this._chunkDebugDismissed) {
      this._chunkDebug.hidden = true;
      return;
    }
    this._chunkDebug.hidden = false;

    const state = this._config && this._hass && this._hass.states[this._config.entity];
    const attrs = state && state.attributes;
    const hasAnnounceAttr = !!(attrs && attrs.is_announcing !== undefined);
    const announcingRaw = hasAnnounceAttr ? String(!!attrs.is_announcing) : "n/a";

    let signal = "word estimate (fallback)";
    if (hasAnnounceAttr) signal = "is_announcing";
    else if (this._chunkDurationIsPrecise) signal = "measured duration";

    const elapsedMs = this._chunkStartedAt ? Date.now() - this._chunkStartedAt : null;
    const elapsed = elapsedMs != null ? (elapsedMs / 1000).toFixed(1) + "s" : "-";
    const minDur =
      this._chunkMinDurationMs != null ? (this._chunkMinDurationMs / 1000).toFixed(1) + "s" : "-";
    const notPlayingFor = this._chunkNotPlayingSince
      ? ((Date.now() - this._chunkNotPlayingSince) / 1000).toFixed(1) + "s"
      : "-";

    this._chunkDebugText.textContent =
      `chunk ${this._chunkIndex + 1}/${this._chunkQueue.length}  [${this._chunkState}]\n` +
      `signal: ${signal}\n` +
      `is_announcing: ${announcingRaw}\n` +
      `entity state: ${state ? state.state : "n/a"}\n` +
      `elapsed: ${elapsed}  min: ${minDur}\n` +
      `observedPlaying: ${!!this._chunkObservedPlaying}\n` +
      `notPlayingFor: ${notPlayingFor}`;
  }

  _advanceChunk() {
    if (!this._chunkQueue) return;
    if (this._chunkIndex < this._chunkQueue.length - 1) {
      this._chunkIndex++;
      this._playCurrentChunk();
    } else {
      this._finishChunks();
    }
  }

  _updateChunkButtonLabel() {
    if (!this._speakBtn) return;
    if (this._chunkState === "playing") {
      this._speakBtn.textContent = "Pause";
    } else if (this._chunkState === "paused") {
      this._speakBtn.textContent = "Resume";
    } else {
      this._speakBtn.textContent = "Speak";
    }
  }

  _renderChunkControls() {
    if (!this._chunkRow) return;
    const active = !!this._chunkQueue;
    this._chunkRow.hidden = !active;
    if (this._chunkNavRow) this._chunkNavRow.hidden = !active;
    if (active) {
      this._chunkIndicator.textContent = `${this._chunkIndex + 1} of ${this._chunkQueue.length}`;
      this._chunkPrevBtn.disabled = this._chunkIndex <= 0;
    }
  }

  // Swaps the plain textarea out for a read-only display of the same text
  // with the currently-playing chunk highlighted. Editing is disabled for
  // the duration this way (there's no textarea to type into) rather than
  // via a separate disabled flag - which also means the chunk boundaries
  // computed at the start of the sequence can't drift out of sync with
  // the text mid-sequence. The file-input buttons are disabled too, for
  // the same reason - replacing the text mid-sequence would leave the
  // chunk queue pointing at text that no longer matches what's shown.
  _enterChunkDisplayMode() {
    if (!this._chunkDisplay || !this._textarea) return;
    this._textarea.hidden = true;
    if (this._clearBtn) this._clearBtn.hidden = true;
    if (this._imageBtn) this._imageBtn.disabled = true;
    if (this._attachBtn) this._attachBtn.disabled = true;
    if (this._snipBtn) this._snipBtn.disabled = true;
    this._chunkDisplay.hidden = false;
    this._renderChunkDisplay();
  }

  _exitChunkDisplayMode() {
    if (!this._chunkDisplay || !this._textarea) return;
    this._chunkDisplay.hidden = true;
    this._textarea.hidden = false;
    if (this._clearBtn) this._clearBtn.hidden = false;
    if (this._imageBtn) this._imageBtn.disabled = false;
    if (this._attachBtn) this._attachBtn.disabled = false;
    if (this._snipBtn) this._snipBtn.disabled = false;
  }

  _renderChunkDisplay() {
    if (!this._chunkDisplay || !this._chunkQueue) return;
    this._chunkDisplay.innerHTML = this._chunkQueue
      .map((chunk, i) => {
        const cls = i === this._chunkIndex ? "chunk-piece active" : "chunk-piece";
        return `<span class="${cls}">${escapeHtml(chunk)}</span>`;
      })
      .join(" ");
    const activeEl = this._chunkDisplay.querySelector(".chunk-piece.active");
    if (activeEl && activeEl.scrollIntoView) {
      activeEl.scrollIntoView({ block: "nearest" });
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
      if (this._textFileExtInput)
        this._textFileExtInput.value = this._config.text_file_extensions || "";
      if (this._chunkedCheckbox) {
        this._chunkedCheckbox.checked = this._config.chunked_playback === true;
        this._chunkSplitBySelect.value =
          this._config.chunk_split_by === "words" ? "words" : "sentences";
        this._chunkSizeInput.value =
          this._config.chunk_size != null ? this._config.chunk_size : "";
        const buffer =
          this._config.chunk_fallback_buffer_seconds != null
            ? this._config.chunk_fallback_buffer_seconds
            : 0;
        this._chunkBufferSlider.value = buffer;
        this._chunkBufferNumber.value = buffer;
        this._debugChunkInfoCheckbox.checked = this._config.debug_chunk_info === true;
        this._updateChunkFieldsVisibility();
      }
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
        <div class="settings-row">
          <label>Attach/drag-drop text file extensions</label>
          <input id="text_file_extensions" type="text" placeholder=".txt, .md" />
        </div>
        <div class="settings-row checkbox-row">
          <label><input id="chunked_playback" type="checkbox" /> Speak in chunks (word/sentence at a time)</label>
        </div>
        <div class="settings-row" id="chunk-split-row" hidden>
          <label>Split by</label>
          <select id="chunk_split_by">
            <option value="sentences">Sentences</option>
            <option value="words">Words</option>
          </select>
        </div>
        <div class="settings-row" id="chunk-size-row" hidden>
          <label id="chunk-size-label">Sentences per chunk</label>
          <input id="chunk_size" type="number" min="1" max="200" step="1" />
        </div>
        <div id="chunk-buffer-row" hidden>
          <div class="settings-row">
            <label>Fallback timing adjustment (sec)</label>
            <div class="buffer-control">
              <input
                id="chunk_fallback_buffer_slider"
                type="range"
                min="${CHUNK_FALLBACK_BUFFER_MIN_S}"
                max="${CHUNK_FALLBACK_BUFFER_MAX_S}"
                step="${CHUNK_FALLBACK_BUFFER_STEP_S}"
              />
              <input
                id="chunk_fallback_buffer_number"
                type="number"
                min="${CHUNK_FALLBACK_BUFFER_MIN_S}"
                max="${CHUNK_FALLBACK_BUFFER_MAX_S}"
                step="${CHUNK_FALLBACK_BUFFER_STEP_S}"
              />
            </div>
          </div>
          <p class="hint">Starts at 0 (the built-in fallback timing, unchanged). Raise it if chunks still cut off early on a speaker; lower it (into negative) to trim the pause between chunks if it feels too long. Only used when the speaker doesn't report precise announcement timing - e.g. Piper Browser Speaker 2026.09.17.1+ doesn't need this at all.</p>
        </div>
        <div class="settings-row checkbox-row" id="chunk-debug-row" hidden>
          <label><input id="debug_chunk_info" type="checkbox" /> Show chunk timing debug info while speaking</label>
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
    this._textFileExtInput = this.querySelector("#text_file_extensions");
    this._chunkedCheckbox = this.querySelector("#chunked_playback");
    this._chunkSplitRow = this.querySelector("#chunk-split-row");
    this._chunkSplitBySelect = this.querySelector("#chunk_split_by");
    this._chunkSizeRow = this.querySelector("#chunk-size-row");
    this._chunkSizeLabel = this.querySelector("#chunk-size-label");
    this._chunkSizeInput = this.querySelector("#chunk_size");
    this._chunkBufferRow = this.querySelector("#chunk-buffer-row");
    this._chunkBufferSlider = this.querySelector("#chunk_fallback_buffer_slider");
    this._chunkBufferNumber = this.querySelector("#chunk_fallback_buffer_number");
    this._chunkDebugRow = this.querySelector("#chunk-debug-row");
    this._debugChunkInfoCheckbox = this.querySelector("#debug_chunk_info");

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
    this._textFileExtInput.value = this._config.text_file_extensions || "";
    this._chunkedCheckbox.checked = this._config.chunked_playback === true;
    this._chunkSplitBySelect.value =
      this._config.chunk_split_by === "words" ? "words" : "sentences";
    this._chunkSizeInput.value = this._config.chunk_size != null ? this._config.chunk_size : "";
    const initialBuffer =
      this._config.chunk_fallback_buffer_seconds != null
        ? this._config.chunk_fallback_buffer_seconds
        : 0;
    this._chunkBufferSlider.value = initialBuffer;
    this._chunkBufferNumber.value = initialBuffer;
    this._debugChunkInfoCheckbox.checked = this._config.debug_chunk_info === true;
    this._updateChunkFieldsVisibility();

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
    this._textFileExtInput.addEventListener("change", () => {
      this._valueChanged("text_file_extensions", this._textFileExtInput.value.trim());
    });
    this._chunkedCheckbox.addEventListener("change", () => {
      this._valueChanged("chunked_playback", this._chunkedCheckbox.checked);
      this._updateChunkFieldsVisibility();
    });
    this._chunkSplitBySelect.addEventListener("change", () => {
      this._valueChanged("chunk_split_by", this._chunkSplitBySelect.value);
      this._updateChunkFieldsVisibility();
    });
    this._chunkSizeInput.addEventListener("change", () => {
      const raw = this._chunkSizeInput.value;
      const val = raw === "" ? NaN : parseInt(raw, 10);
      this._valueChanged("chunk_size", raw === "" || isNaN(val) || val < 1 ? "" : val);
    });
    // slider and number box mirror each other live (on every drag/keystroke)
    // but only actually save once a value is committed (drag release /
    // blur or Enter), same debounce-on-commit pattern as the other numeric
    // fields here.
    this._chunkBufferSlider.addEventListener("input", () => {
      this._chunkBufferNumber.value = this._chunkBufferSlider.value;
    });
    this._chunkBufferSlider.addEventListener("change", () => {
      this._valueChanged(
        "chunk_fallback_buffer_seconds",
        this._clampBufferSeconds(this._chunkBufferSlider.value)
      );
    });
    this._chunkBufferNumber.addEventListener("input", () => {
      this._chunkBufferSlider.value = this._chunkBufferNumber.value;
    });
    this._chunkBufferNumber.addEventListener("change", () => {
      const clamped = this._clampBufferSeconds(this._chunkBufferNumber.value);
      this._chunkBufferNumber.value = clamped;
      this._chunkBufferSlider.value = clamped;
      this._valueChanged("chunk_fallback_buffer_seconds", clamped);
    });
    this._debugChunkInfoCheckbox.addEventListener("change", () => {
      this._valueChanged("debug_chunk_info", this._debugChunkInfoCheckbox.checked);
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

  _updateChunkFieldsVisibility() {
    if (!this._chunkSplitRow) return;
    const enabled = this._chunkedCheckbox.checked;
    this._chunkSplitRow.hidden = !enabled;
    this._chunkSizeRow.hidden = !enabled;
    this._chunkBufferRow.hidden = !enabled;
    this._chunkDebugRow.hidden = !enabled;
    const bySentences = this._chunkSplitBySelect.value === "sentences";
    this._chunkSizeLabel.textContent = bySentences ? "Sentences per chunk" : "Words per chunk";
    this._chunkSizeInput.placeholder = String(defaultChunkSize(bySentences ? "sentences" : "words"));
  }

  // Keeps the slider and its paired number box from ever holding a value
  // outside the configured range regardless of which one the user typed
  // into, or if they type something non-numeric into the number box.
  _clampBufferSeconds(raw) {
    const val = parseFloat(raw);
    if (isNaN(val)) return 0;
    return clamp(val, CHUNK_FALLBACK_BUFFER_MIN_S, CHUNK_FALLBACK_BUFFER_MAX_S);
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
