# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Install JS dependencies
npm run dev              # Vite dev server (frontend only)
npm run build            # TypeScript check + Vite production build
npm run tauri dev        # Full Tauri + Vite dev mode (desktop app)
npm run tauri build      # Production build (generates NSIS/MSI installer)
cargo check              # Rust compilation check (run from src-tauri/)
npx vite build           # Frontend-only build (skip tsc)
npx tauri icon <png>     # Generate app icons from a square PNG
```

Bundle output: `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/vibe-pet.exe`.

## Project Structure

```
src/
  pet/                    # Pet window (transparent, borderless, always-on-top)
    index.html            # Entry HTML + all panel DOM
    pet.ts                # PetEngine, drag system, bio-clock, speech bubbles,
                          # context menu, API chat, GitHub polling, todo/reminders,
                          # file drop, idle roaming, focus timer
    pet.css               # All pet-window styles (glassmorphism panels)
    spritesheet.webp      # Fallback/default spritesheet (8 cols x 9 rows, 192x208)
  config/                 # Config window (hidden by default)
    index.html
    config.ts             # Pet package import/list UI
    style.css
  assets/audio/           # SFX: pop, boing, bubble, bell, crunch
  lunar-javascript.d.ts   # Lunar calendar type declarations

src-tauri/
  src/
    main.rs               # Tauri entry point
    lib.rs                # Plugin registration + invoke handler registration
    pet_import.rs         # .zip pet import, manifest parsing, app-data management
  tauri.conf.json         # Window config (pet + config), build hooks, bundle settings
  capabilities/default.json  # Tauri permissions
```

## Architecture

**Two-window Tauri v2 app:**
- `pet` window: 192x208 transparent, borderless, always-on-top. Contains all main logic in `pet.ts`.
- `config` window: 800x600 settings panel, initially hidden. Simple import/list UI in `config.ts`.

Both entry points are built by Vite via `rollupOptions.input` in `vite.config.ts`, using `src` as the root directory.

**No framework, no Canvas.** All rendering is plain DOM + CSS. Sprite animation uses `background-position` with a timer-driven engine (`PetEngine` in `pet.ts:75-143`). The default atlas is 8 columns x 9 rows with state-specific frame durations.

**All user state** (API config, chat mode, persona, GitHub username, todos, volume, window-on-top, current pet) persists via `localStorage`.

## Key Patterns

- **Tauri commands**: Register in `lib.rs` inside `tauri::generate_handler![...]`. New Tauri API calls also need permissions added in `capabilities/default.json`.
- **Pet import**: Zip files extracted to `$APPDATA/pets/{id}/`. Spritesheets displayed via `convertFileSrc()` with asset protocol scoped to `$APPDATA/**`.
- **Drag system**: Asynchronous `appWindow.startDragging()` with `then/catch` (not `await`), guarded by `isDraggingInProgress` flag. Fallback detection for OS-swallowed mouseup events (`buttons === 0` while `isMouseDown`).
- **Speech bubble**: Single `#pet-speech-bubble` element with `show-bubble` CSS class toggle. Mutex via `isBubbleLocked` flag to prevent overlap.
- **SFX**: HTML5 `Audio` objects loaded via `new URL("../assets/audio/...", import.meta.url).href`.
- **Context menu**: Dynamic `@tauri-apps/api/menu` Menu/Submenu/CheckMenuItem with popup at cursor. Imported async only on right-click.

## Constraints

- Keep the frontend framework-free — plain DOM + CSS only.
- Sprite animation must remain DOM-based (no Canvas/WebGL).
- Pet window UI must fit within 192x208.
- `pet.json` schema has no state/frame mapping — code must assume rows map to states with equal frame counts as fallback.
- Do not rename localStorage keys without migration — existing users will lose settings.
- `AGENTS.md` contains supplementary repo guidelines; check it for context on project conventions.

## Verification

- TypeScript changes: `npm run build`
- Rust changes: `cargo check` in `src-tauri/`
- Tauri/permission/window changes: `npm run tauri dev` (browser-only Vite can't validate native permissions)
- Pet import changes: test with a `.zip` containing `pet.json` + `spritesheet.webp`
