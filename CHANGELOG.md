# Changelog

All notable changes to this card are documented here. Versions follow `YYYY.MM.DD.#`.

## 2026.09.17.10
- Found the actual root cause of chunked playback getting cut off, after `2026.09.17.9`'s timing pass fixed cutoff but left about 2 seconds of dead air between chunks: `tts.speak` plays announcements through a separate "announce" audio channel on the target speaker, and Piper Browser Speaker (the speaker used for testing this) never reported that channel's play/pause/ended events back to Home Assistant - so every earlier fix here was tuning around a state signal (`media_player.<x>.state`) that was structurally blind to whether an announcement was actually still playing. Piper Browser Speaker `2026.09.17.1` adds a real `is_announcing` attribute reported live off those events; this card now uses it as the primary, precise, event-driven "is this chunk done" signal (needing only a brief debounce, not padding) whenever the target entity exposes it, closing the dead-air gap entirely. Falls back to the exact `2026.09.17.9` behavior - unchanged - on any speaker that doesn't expose it, so this can't make anything worse, only better where it's available.

## 2026.09.17.9
- One more timing pass - the longest chunk was reported as coming up only about 4 words short at the end. Raised the flat latency allowance (which closes a shortfall regardless of chunk length) and the per-word rate a bit further.

## 2026.09.17.8
- Nudged the chunk-timing estimate up a bit more after a report that the longest section tested was still getting cut off, though closer than before. Raised the per-word speaking-rate estimate (~143 -> ~130 words/minute) since that's the part that scales with a chunk's length, plus a bit more flat buffer and confirmation time on top.

## 2026.09.17.7
- Fixed `2026.09.17.6` breaking Speak entirely with "Validation error: An action which does not return responses can't be called with return_response=True" - his HA version's `tts.speak` doesn't support response data at all, and asking for it rejects the WHOLE call before anything is spoken (not a graceful "no data back" like assumed). Now catches that specific error, remembers it for the rest of the session, and actually retries the same speak for real without asking for a response - chunked playback falls back to the previous word-count-estimate timing exactly as it did in `.17.5` on any HA version where this isn't supported.

## 2026.09.17.6
- Rebuilt how chunked playback decides a chunk is finished, since three earlier attempts (a debounce, then a word-count duration estimate, then widening its margins) each narrowed the "cut off mid-line" bug without eliminating it - all of them were still ultimately guessing. `tts.speak` now asks Home Assistant for its response data, which (on HA versions that support it) includes the actual generated audio clip's URL; the card silently loads that same clip in the background just far enough to read its real, exact duration, and times the chunk against that measured length instead of a guess or the target speaker's own state reporting. Falls back to the previous word-count-estimate behavior untouched on older HA versions, or if anything about the probe fails - this is a strict upgrade, not a replacement that can leave you worse off.

## 2026.09.17.5
- Fixed the chunk navigation arrows overlapping/hiding under the text box, and reworked the whole control-row layout to actually be responsive: on a normal-width card, the Previous/indicator/Next arrows sit on the left of the same line as the icon buttons and Speak/Pause (right), with Stop alone on the line below; on a narrow card, the icon buttons/Speak move to their own line, and the arrows (left) and Stop (right) share the line below that. Uses a CSS container query keyed to the card's own width (not the browser window), so it responds correctly regardless of how big the dashboard itself is.
- Chunks could still occasionally get cut off in their last second or two even with the estimated-duration floor from `2026.09.17.4` - the estimate itself was in the right ballpark, it just didn't leave quite enough margin right at the tail end. Raised the "not playing" confirmation window (1.8s -> 3s) and gave the per-chunk duration estimate a bit more headroom.

## 2026.09.17.4
- Fixed chunks still getting cut off mid-line and jumping to the next one even after `2026.09.16.7`'s debounce fix. The debounce only guarded against a brief blip, but a longer multi-sentence chunk can outlast even that on a media_player whose state reporting lags or hiccups - confirmed by the fact that pressing Stop mid-chunk let that same chunk's audio finish correctly on its own once auto-advance was cancelled, meaning the audio was always fine and only the "is it done" check was too eager. Auto-advance now also estimates how long a chunk should realistically take to speak from its word count (roughly 155 words/minute, with a floor for very short chunks) and won't trust ANY "not playing" or "still waiting to hear playing" reading before that estimate has elapsed, on top of the existing debounce and startup-timeout checks.

## 2026.09.17.3
- Fixed `2026.09.17.2` moving the Stop button above Speak/Pause along with the Previous/Next arrows - only the arrow row (Previous/indicator/Next) was meant to move up under the text box. Stop is back in its usual spot right below the Speak/Pause row.

## 2026.09.17.2
- Fixed the highlighted chunk-playback view growing past the text box's normal height instead of scrolling inside it - on a real dashboard this could push cards below it down the page or off-screen. It's a classic flexbox sizing gap (a flex child with `overflow-y: auto` still needs `min-height: 0` to actually respect its container's height instead of expanding to fit its content); the text box now stays the same size during playback as it is normally, and scrolls internally to follow the highlighted chunk instead.
- Moved the chunk navigation row (Previous/Next arrows, "chunk N of M", Stop) to sit directly under the text box instead of below the action-button row, and let it wrap onto a second line on a narrow card instead of squeezing/overflowing.
- Chunked playback now defaults to splitting by sentences instead of words when "Split by" hasn't been set.

## 2026.09.17.1
- Moved the "Keep text after speaking" checkbox off the card face and into the gear-icon Quick settings panel, next to "Cache repeated messages" - one less row cluttering the card itself. It's still a live, this-session choice read at speak time (not part of the saved config), so it's unaffected by "Reset to saved settings", same as before.

## 2026.09.16.7
- Fixed chunked playback cutting a chunk off after only its first line/sentence before auto-advancing to the next one. Auto-advance previously acted on the very first "not playing" reading it saw once a chunk had started - but some media_player integrations report a brief gap between sentences or lines within the SAME chunk, which looked identical to the chunk actually finishing. A "not playing" reading now has to hold steady for about 1.8 seconds before it's trusted, so a momentary inter-sentence gap no longer triggers a premature advance.

## 2026.09.16.6
- Added a scissors "snip" button next to the image button: it opens the browser's own screen-share picker (`getDisplayMedia`), grabs a single frame from whatever tab/window/screen you pick, immediately stops the share again, then opens a crop overlay where you drag a selection box over just the text you want (or convert the whole frame if you don't drag one) - the selection runs through the same OCR as the camera/attach/drag-drop inputs. Desktop browsers only; `getDisplayMedia` isn't available on mobile browsers, so the button will just show an error there.

## 2026.09.16.5
- Added highlighted chunk playback: while a chunked sequence is running, the text box switches to a read-only view of the same text with whichever chunk is currently being spoken highlighted, and switches back to a normal editable box once the sequence stops or finishes. Editing is effectively disabled during playback as a side effect (there's no textarea to type into while the highlighted view is showing), which also keeps the chunk boundaries from drifting out of sync with the text mid-sequence.
- Added a paperclip "attach" button next to the image button, and extended drag-and-drop, to also accept plain text files - not just images. A recognized text file's contents replace the box, same as an OCR result does. Which extensions count is configurable in the editor (`Attach/drag-drop text file extensions`, default `.txt, .md`).

## 2026.09.16.4
- Made the chunked-playback Stop button always actually stop - it now resets state and sends `media_player.media_stop` unconditionally instead of bailing out early if its own internal bookkeeping thought there was nothing to stop, and the chunk row/indicator now re-syncs itself on every update rather than only when a chunk method happens to redraw it. Response to a report that Pause/Next/Stop all seemed unresponsive at times after `2026.09.16.3` - this closes a real gap in Stop's reliability; if Pause/Next were also affected by a stale display (row showing but out of sync with the real state), the added self-healing redraw should catch that too. Still watching for a report back to confirm this fully resolves it, since it couldn't be reproduced live from here.

## 2026.09.16.3
- Fixed chunked playback not auto-advancing after a manually-navigated chunk (Previous/Next) finished, requiring a click for every remaining chunk. Auto-advance previously required observing the target media_player report a literal `playing` state before it would trust a later non-`playing` reading as "done" - some media_player integrations (including browser-based custom speakers) never report that state at all, which left the sequence permanently stuck once that happened. It's now time-based: a short grace period after a chunk starts (so a not-yet-started player isn't mistaken for a finished one), a longer window after which a never-seen `playing` state is trusted anyway, and an outer max-wait so a stuck-reporting player can't hang the sequence.

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
