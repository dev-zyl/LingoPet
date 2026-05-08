# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibePet is a desktop pet application built with Tauri v2 (Rust backend) + Vite + Vanilla TypeScript. The pet renders via CSS `steps()` sprite sheet animation — no frameworks (React/Vue/Pixi/Three/Canvas) allowed.

## Commands

```bash
npm run dev          # Start Vite dev server only
npm run tauri dev    # Start Tauri + Vite dev (full app)
npm run build        # TypeScript check + Vite production build
npm run tauri build  # Full Tauri release build
npx vite build       # Frontend-only build (skip tsc)
cargo check          # Check Rust compilation (from src-tauri/)
```

## Architecture

### Dual-Window Design

- **`src/pet/`** — Transparent, borderless, always-on-top pet display window. Contains `pet.ts` (PetEngine + drag), `pet.css`, `spritesheet.webp`.
- **`src/config/`** — Hidden-by-default configuration panel window. Contains `config.ts`, `style.css`.

Windows are registered in `src-tauri/tauri.conf.json` with labels `pet` and `config`. Vite builds both via `rollupOptions.input` in `vite.config.ts` (root is `src/`).

### PetEngine (`src/pet/pet.ts`)

Core class for sprite animation. Uses `SpriteConfig` to define frame dimensions and state-to-row mappings. `injectKeyframes()` dynamically creates CSS `@keyframes` per state; `applyState()` sets the animation on the sprite element. Default fallback: every row = one state, each row assumed to have equal frame count.

### Tauri Capabilities

`src-tauri/capabilities/default.json` grants `core:default` + `core:window:allow-start-dragging` to both windows.

## Constraints  

- **No UI frameworks.** All rendering is pure DOM + CSS.
- **No Canvas/WebGL.** Sprite animation uses only `background-position` + `steps()`.
- **Particle effects** must be native DOM elements with CSS Animation, removed via `.remove()` after completion.
- **pet.json schema** (`id`, `displayName`, `description`, `spritesheetPath`, `version`) — no state/frame mapping provided; code must have a default fallback (row-per-state assumption).
