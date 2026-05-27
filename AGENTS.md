# Repository Guidelines

## Project Overview

VibePet is a Tauri v2 desktop pet app. The backend is Rust under `src-tauri/`, and the frontend is Vite + TypeScript with plain DOM and CSS under `src/`. There is no React, Vue, Canvas, or WebGL runtime in the app.

The app has two Tauri windows:

- `pet`: transparent, borderless, always-on-top pet window from `src/pet/index.html`.
- `config`: hidden-by-default pet manager window from `src/config/index.html`.

## Important Paths

- `src/pet/pet.ts`: main app logic, including `PetEngine`, drag behavior, context menu, focus timer, API chat, GitHub polling, todo/reminder handling, file drop, and pet loading.
- `src/pet/pet.css`: all pet-window styles, panels, animation feedback, speech bubbles, and hitbox/debug styles.
- `src/pet/spritesheet.webp`: fallback/default pet spritesheet.
- `src/config/config.ts`: simple pet package import/list UI for the config window.
- `src-tauri/src/lib.rs`: Tauri plugin registration, invoke handler registration, `move_to_trash`.
- `src-tauri/src/pet_import.rs`: `.zip` pet import, pet manifest parsing, app-data pet directory management.
- `src-tauri/tauri.conf.json`: window definitions, build hooks, app identifier, bundle configuration, asset protocol scope.
- `src-tauri/capabilities/default.json`: Tauri permissions. Add permissions here when introducing new frontend Tauri APIs.
- `ARCHITECTURE.md`: developer whitepaper. Check against source before relying on implementation details because it may lag behind code.
- `docs/`: static docs/demo site assets.

## Commands

Run from the repository root unless noted:

```bash
npm install
npm run dev
npm run build
npm run tauri dev
npm run tauri build
```

Rust-only checks are run from `src-tauri/`:

```bash
cargo check
```

`npm run build` runs TypeScript checking and Vite production build. `npm run tauri dev` starts the full desktop app and runs the Vite dev server through Tauri's `beforeDevCommand`.

## Frontend Architecture

Vite uses `src` as the root and builds two HTML entrypoints configured in `vite.config.ts`:

- `src/pet/index.html`
- `src/config/index.html`

Keep the frontend framework-free. Prefer direct DOM APIs, typed helper functions, and scoped CSS. Avoid introducing a UI framework for small panels or menu interactions.

The current sprite engine in `src/pet/pet.ts` is timer-driven TypeScript using a `PetAtlas` map and `background-position`; do not assume CSS `steps()` is the only animation driver. The default atlas is 8 columns by 9 rows, with 192x208 cells.

## Tauri/Rust Notes

Register any new Tauri commands in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]`.

When adding frontend calls to Tauri APIs or plugins, update `src-tauri/capabilities/default.json` with the required permissions for both `pet` and `config` if needed.

Pet packages are imported into the app data directory under a `pets/` subfolder. A package must contain `pet.json`; top-level directory wrappers inside zip files are stripped during extraction.

The asset protocol is enabled and scoped to `$APPDATA/**`, which is required for displaying imported pet spritesheets through `convertFileSrc`.

## Persistent State

Most user settings live in `localStorage`, including API endpoint/key/model, chat mode, persona mode, custom persona, GitHub username, last push timestamp, todos, current pet id, and always-on-top state.

Be careful when renaming localStorage keys because existing users may lose settings.

## Product Constraints

- Keep the app lightweight and desktop-pet focused.
- Preserve plain DOM + CSS rendering unless the requested feature truly requires otherwise.
- Avoid Canvas/WebGL for sprite rendering.
- Keep pet-window UI compact; the main pet window is only 192x208 by default.
- Respect transparent window behavior, hitbox behavior, and always-on-top interactions.
- Audio effects are HTML5 `Audio` objects loaded through Vite `new URL(...)`.

## Verification Checklist

For code changes, prefer the smallest verification that covers the touched layer:

- TypeScript/frontend changes: `npm run build`.
- Rust command or Tauri plugin changes: `cargo check` in `src-tauri/`, and `npm run tauri dev` when behavior needs runtime verification.
- Tauri permission or window changes: test with `npm run tauri dev` because browser-only Vite cannot validate native permissions.
- Pet import changes: test with a `.zip` containing `pet.json` and `spritesheet.webp`.

## Current Git State Guidance

This repository may have user edits in progress. Do not revert files unless explicitly asked. Before touching a file, inspect its current content and keep edits narrowly scoped to the requested behavior.

## Feature Completion Log

After completing a user-facing feature or behavior fix, append a concise entry to the root `FEATURE_LOG.md` file. Record the date, affected area, completed behavior, and verification performed. Do not rewrite prior entries when adding new work.
