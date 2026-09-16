# Changelog

All notable changes to this card are documented here. Versions follow `YYYY.MM.DD.#`.

## 2026.09.16.2
- Added optional chunked playback: split the text into chunks by word count or sentence count (your choice, in the editor) and speak them one at a time instead of waiting for the whole box to synthesize as a single clip. The Speak button becomes Pause/Resume once a sequence is running, with Previous/Next chunk controls and a "chunk N of M" indicator. Resume always replays the current chunk from its start rather than trying to resume mid-clip at an exact position, since real position-resume support varies too much across different media_player integrations to rely on - replaying the whole chunk behaves the same on any of them. Auto-advance to the next chunk is driven by watching the target speaker's own state (`playing` -> something else), not a timer.

## 2026.09.16.1
- Added a small "Clear" button in the top-right corner of the text box to empty it in one tap - deliberately understated (a muted outline chip) so it doesn't compete with the Speak button.

## 2026.09.15.11
- Pasting (Ctrl+V) an image or screenshot into the text box now reads its text via OCR, same as the camera button and drag-and-drop. Plain text/link pastes still behave normally.

## 2026.09.15.10
- Dragging an image file onto the text box now reads its text via OCR (with a highlighted drop target). Plain text/link drops still behave normally.

## 2026.09.15.9
- Added image-to-text: a camera-icon button opens a file picker, and the recognized text (via on-device OCR, [Tesseract.js](https://github.com/naptha/tesseract.js), loaded from a CDN on first use) replaces the box contents.

## 2026.09.15.8
- Added a configurable lock duration (`lock_seconds` in the editor, default 2s) - the Speak button now stays disabled for at least that long after a click, even if the `tts.speak` call itself finishes faster, so a fast double-tap can't fire it twice.

## 2026.09.15.7
- Fixed the Speak button visibly shifting sideways when its label changed to "Speaking..." - it now has a fixed minimum width.

## 2026.09.15.6
- Replaced the Speak button's `mwc-button` (which loads/upgrades lazily and could silently eat an early tap) with a plain native `<button>` that's clickable immediately, styled with clear hover/press feedback and a "Speaking..." label while the call is in flight.

## 2026.09.15.5
- Removed the "speed" control - it isn't a supported cross-engine TTS option, and sending it fails the entire speak call on at least one common engine (Piper/Wyoming). Added a "Voice quality" filter dropdown (low/medium/high, etc.) instead, derived from the engine's own voice list.

## 2026.09.15.4
- Added a "Keep text after speaking" checkbox on the card face (with a matching saved default in the editor) so the box doesn't have to clear after every Speak.

## 2026.09.15.3
- Added language, voice, speed, and cache-behavior options: saved defaults in the GUI editor, plus a gear-icon "Quick settings" panel on the card face for one-off overrides on just the next message, with a "Reset to saved settings" button.

## 2026.09.15.2
- Added a TTS engine picker to the editor. Fixes an intermittent "stops working after a couple of messages" issue that was actually the card auto-selecting a rate-limited cloud TTS engine instead of a local one.

## 2026.09.15.1
- Initial release: a text box with no character limit (calls `tts.speak` directly, which has no state-length cap), a Speak button, and a GUI editor to pick the target `media_player` speaker. Built for Lovelace Sections.
