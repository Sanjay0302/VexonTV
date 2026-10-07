# Changelog

All notable changes to VexonTV are documented here.

---

## [Unreleased] — 2026-10-07

### Changed

- **LEFT / OK while playing now opens the Favorites panel** instead of the
  category+channel browser. The new panel slides in from the left, shows
  only your saved channels (with logos, EPG progress bars and a ▶ marker
  on the channel currently playing), and is narrower (36 % of the screen)
  so more of the video remains visible.

### Added

- **RIGHT key closes the Favorites panel** — mirrors BACK / ESC, so you
  can dismiss the panel naturally in either direction.
- **Number + Enter directly plays favorite #N** from anywhere in the
  player screen. Works whether the panel is open or not; no second Enter
  press required. If the typed number exceeds the number of saved
  channels a brief toast is shown instead.
- Empty-state message in the Favorites panel when no channels have been
  saved yet ("Press RED while watching a channel to save it").

### Fixed

- Channel numbers (1, 2, 3 …) were missing from rows in the Favorites
  panel — restored to match the standard channel list style.
- Pressing a number then Enter while the Favorites panel was open showed
  "No channel N on this screen" — the number-jump logic now recognises
  the player context and performs a direct play instead of a focus jump.
