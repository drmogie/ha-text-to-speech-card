# Text to Speech Card

A Home Assistant Lovelace card: paste or type any amount of text - no 255-character limit - and speak it out loud on any `media_player` entity, using the core `tts.speak` action. Works with any speaker (Piper, Sonos, Google, Alexa via media_player, etc.) - it isn't tied to a specific speaker integration.

## Features

- **No character limit.** Speaks directly through `tts.speak`'s service-call data, which (unlike an `input_text` helper's state) isn't capped at 255 characters.
- **Read text out of an image.** A camera-icon button, drag-and-drop, and paste (Ctrl+V) all run the same on-device OCR (via [Tesseract.js](https://github.com/naptha/tesseract.js), loaded from a CDN the first time it's used) and drop the recognized text straight into the box - handy for reading a screenshot or photo of text out loud.
- **Saved defaults, editable from the card face.** Set a default language, voice, voice-quality filter, and caching behavior in the GUI editor; a gear-icon "Quick settings" panel on the card lets you override any of them for just your next message, with a permanent "Reset to saved settings" button to snap back.
- **Keep text after speaking.** An optional checkbox (default on the card face, with a matching saved default) leaves your text in the box instead of clearing it once spoken.
- **Speak-button lock.** After clicking Speak, the button stays disabled for a configurable minimum time (default 2s) so a fast double-tap can't fire the same message twice.
- **Optional chunked playback.** Instead of waiting for the whole box to synthesize as one clip before anything plays, split it into chunks (by word count or sentence count) spoken one at a time. Speak becomes Pause/Resume once a sequence starts, with Previous/Next chunk controls and a "chunk N of M" indicator. Resume always replays the current chunk from its start rather than trying to resume mid-clip, since that's the one behavior that's consistent across every media_player.
- **No YAML required.** Full GUI configuration editor.
- **Built for Lovelace Sections**, the latest Home Assistant layout.

There's deliberately no "speed" control - it isn't a standard, cross-engine TTS option in Home Assistant. Some engines support something like it via their own option name, most don't, and sending an option an engine doesn't recognize fails the *entire* speak call rather than being ignored (confirmed against a Piper/Wyoming engine: `Invalid options found: ['speed']`).

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=drmogie&repository=ha-text-to-speech-card&category=plugin)

Or manually: HACS -> Frontend -> the **⋮** menu -> Custom repositories -> add `https://github.com/drmogie/ha-text-to-speech-card` as category **Lovelace**.

### Manual

1. Download `ha-text-to-speech-card.js` from the [latest release](https://github.com/drmogie/ha-text-to-speech-card/releases/latest).
2. Copy it into `<config>/www/ha-text-to-speech-card.js`.
3. Add it as a Lovelace resource:

   [![Open your Home Assistant instance and show your dashboard resources.](https://my.home-assistant.io/badges/lovelace_resources.svg)](https://my.home-assistant.io/redirect/lovelace_resources/)

   URL: `/local/ha-text-to-speech-card.js`, Resource type: **JavaScript module**.

## Adding the card

Add a new card, search for **Text to Speech Card**, and configure it in the GUI editor - no YAML needed.

## Configuration

| Option | Description |
| --- | --- |
| Title | Optional card header text. |
| Speaker (media_player entity) | Which `media_player` the speech plays on. |
| TTS engine | Optional - which `tts.*` entity to use. Defaults to the first one found, so it's worth setting explicitly if you have more than one (e.g. to avoid a rate-limited cloud engine). |
| Default language | Optional saved default, pulled live from the chosen TTS engine. |
| Voice quality | Filters the voice list by quality tier (e.g. low/medium/high) when the engine's voice names carry one, like Piper's. |
| Default voice | Optional saved default voice. |
| Cache repeated messages by default | Whether repeated identical messages reuse a cached audio clip. |
| Keep text in box after speaking by default | Whether the text box clears after a successful Speak. |
| Lock button after Speak (seconds) | How long the Speak button stays disabled after a click, regardless of how fast the speak call itself finishes. Default 2. |
| Speak in chunks | Splits the text and speaks it one chunk at a time instead of all at once, with Pause/Resume/Previous/Next controls. |
| Split by | Words or Sentences - only shown when chunked playback is on. |
| Words/Sentences per chunk | How many words (or sentences) go in each chunk. Defaults to 40 words or 2 sentences if left blank. |

## License

MIT
