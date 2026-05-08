# VibePet

A lightweight desktop pet that lives on your screen. Built with Tauri v2 + Vite + Vanilla TypeScript. No frameworks, no Canvas/WebGL -- pure DOM, CSS sprite animation, and a bit of soul.

## Features   

### Sprite Animation Engine

A custom `PetEngine` drives all animation through CSS `background-position` stepping over a sprite sheet. Each state (idle, waving, jumping, running, etc.) maps to a row in the atlas with per-frame duration control :

```
idle            -> row 0, 6 frames
running-right   -> row 1, 8 frames
waving          -> row 3, 4 frames
jumping         -> row 4, 5 frames
review (think)  -> row 8, 6 frames
...
```

Default atlas: 8 columns x 9 rows, 192x208 per cell.

### Drag and Drop

Click and drag the pet across your desktop. The system uses a threshold-based state machine:

- **Mousedown** -- "latent" phase, pet squishes slightly (scaleY stretch)
- **Mousemove past 5px threshold** -- enters drag mode, switches to running animation, hands drag control to the OS via `appWindow.startDragging()`
- **Mouseup** -- drops with a squash animation, or spawns particles if it was just a click

A fallback mechanism detects when the OS swallows the mouseup event (buttons === 0 while isMouseDown) and resets state gracefully.

### Bio-Clock

The pet monitors your activity via global cursor polling (Tauri `cursorPosition` API). When you go idle:

| Idle Duration | Behavior |
|---|---|
| 5 minutes | Switches to "review" (thinking) for 3 seconds |
| 10 minutes | Falls asleep ("waiting" state) |
| Mouse returns | Wakes up with a jump |

### Speech Bubble

A context-aware speech bubble appears above the pet's head on boot, displaying messages based on the current date and time:

**Solar terms:**
- Winter Solstice (dong zhi) -- reminder to eat dumplings or tangyuan
- Start of Spring (li chun) -- new beginnings message

**Holidays:**
- December 13 -- National Memorial Day
- Mother's Day (2nd Sunday in May) -- call your mom
- Spring Festival (lunar Jan 1) -- new year greeting
- Mid-Autumn Festival (lunar Aug 15) -- mooncake reminder

**Time-based:**
- 23:00 -- late night health reminder (triggers "review" state + 8s bubble)

**Default:** "Have a great day!"

The bubble uses `width: max-content` for auto-sizing, with a CSS triangle tail and smooth fade-in/out transitions.

### Eye Tracking

The sprite flips horizontally based on cursor position relative to the window center, giving the illusion the pet is watching you.

### Particle Effects

Clicking the pet spawns 2-3 random SVG particles (heart, smile, star, etc.) that float upward and fade out. All particles are inline SVG data URIs -- no external images, no emoji.

### Context Menu

Right-click the pet for a native menu:

- Import pet (.zip) -- load a custom sprite sheet package
- Animation controls (idle, waving, jumping, running, etc.)
- Toggle always-on-top (persisted to localStorage)
- Quit (plays "failed" animation before exit)

### Pet Import

Import custom pets as `.zip` files through the dialog or drag-and-drop. The Rust backend (`pet_import.rs`) extracts the zip, reads `pet.json` for metadata, and stores the pet in the app data directory.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Tauri v2 (Rust backend, WebView2 frontend) |
| Frontend | Vite 8 + TypeScript 6, zero frameworks |
| Rendering | Pure DOM + CSS `steps()` sprite animation |
| Calendar | lunar-javascript (solar terms, lunar dates) |
| Build | Cargo (Rust) + Vite (frontend) |

## Project Structure

```
src/
  pet/                  # Pet window (transparent, borderless, always-on-top)
    index.html          # Entry HTML
    pet.ts              # PetEngine, drag, bio-clock, speech, context menu
    pet.css             # All pet window styles
    spritesheet.webp    # Default sprite sheet (fallback)
  config/               # Configuration panel window (hidden by default)
    index.html
    config.ts
    style.css
  lunar-javascript.d.ts # Type declarations for the calendar library

src-tauri/
  src/
    main.rs             # Tauri entry point
    lib.rs              # Plugin registration, command handler
    pet_import.rs       # Zip import, pet manifest, file management
  tauri.conf.json       # Window config, permissions, bundle settings
  capabilities/
    default.json        # Tauri capability permissions
```

## Commands

```bash
npm run dev            # Vite dev server only (frontend)
npm run tauri dev      # Full Tauri + Vite dev (desktop app)
npm run build          # TypeScript check + Vite production build
npm run tauri build    # Full Tauri release build (generates installer)
npx vite build         # Frontend-only build (skips tsc)
cargo check            # Check Rust compilation (from src-tauri/)
```

## Pet Package Format

A pet package is a `.zip` file containing:

```
pet.json              # Manifest
spritesheet.webp      # Sprite sheet image
```

**pet.json schema:**

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A custom pet",
  "spritesheetPath": "spritesheet.webp",
  "version": "1.0.0"
}
```

The engine uses a default fallback: each row in the sprite sheet = one state, frames per row assumed equal. No state/frame mapping is required in the manifest.

## Architecture Notes

- **No frameworks.** All rendering is pure DOM + CSS. No React, Vue, Pixi, Three, or Canvas.
- **No Canvas/WebGL.** Sprite animation uses only `background-position` + `steps()`.
- **Transparent window.** The pet window has `transparent: true`, `decorations: false`, `shadow: false` in Tauri config. The HTML body is `pointer-events: none` so only the pet sprite intercepts clicks.
- **Dual-window.** The pet window (`pet` label) is the always-visible desktop companion. The config window (`config` label) is hidden by default and can be shown programmatically.
- **Particle lifecycle.** Particles are DOM elements appended to `document.body`, removed via `.remove()` on `animationend`.

## License

MIT
