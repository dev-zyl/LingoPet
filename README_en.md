# VibePet

[简体中文](README.md)

> A desktop AI soul pet -- built on Tauri v2 + Rust kernel, zero-framework pure DOM rendering, ultra-lightweight at just 5MB.

Inspired by Codex Pet, standalone with even more companion-level desktop capabilities. No code editor needed -- just a pet that understands you.

## Core Features

### Smart Intent Todo

With an LLM API connected, natural language input is automatically classified as a countdown reminder or a permanent memo:

```
"remind me to drink water in 30 min"  -->  countdown timer, looping alarm + visual pulse
"learn deep learning"                  -->  permanent memo, persisted to localStorage
"call me for a meeting in 1 hour"     -->  countdown timer
```

Without an API configured, it falls back to a simple notepad mode with one-click copy.

### AI Persona Chat

Connects to any OpenAI-compatible API with six built-in personality presets and a custom persona panel:

| Preset | Style |
|--------|-------|
| Tsundere Cat | Aloof exterior, secretly caring |
| Genki Girl | Bubbly energy, exclamation mark overflow |
| Toxic Friend | Sarcastic roasts, zero malice |
| Gentle Senior | Warm, patient, soft-spoken |
| Chuunibyou | Dramatic monologues, delusional flair |
| Zen Shiba | Stoic philosophy, minimal words |

First click triggers a full LLM response, then falls back to lightweight quotes. 10-minute cooldown before the next LLM trigger -- balancing experience and cost.

### Focus Mode

A freely adjustable Pomodoro timer (5-60 minutes). During focus, the pet stays quiet and displays a countdown. A bell rings when time is up.

### Merit Woodfish

Open Merit Mode from the right-click menu and the pet starts striking a woodfish automatically, adding “merit +1” on a fixed rhythm. The panel supports custom merit text, daily count persistence, and a dedicated woodfish hit sound so it does not overlap with regular speech-bubble audio.

### Holiday Blessings

Built-in calendar that automatically sends greetings on the first boot of a holiday.

### Interactive Easter Eggs

Click the pet's body to spawn random emoji tags and speech bubbles overhead. Seven built-in animated actions (idle, walk, run, sit, sleep, greet, play), each with its own personality.

### Custom Pet Skins

Import community-made pet packages (`.zip`) and switch with one click. From ikun to Nai Dragon -- or create your own from friends, family, or loved ones.

Visit [codexpet.xyz](https://codexpet.xyz/zh) or [codex-pet.org](https://codex-pet.org/zh) for more pets.

### Ultra Lightweight

The installer is only 5MB. Background residence has zero impact on system performance.

### Deep System Integration

- Windows system audio sensing -- when system audio output is detected, the pet bops and floats music-note particles automatically
- File drop to recycle bin -- drag files onto the pet to delete
- GitHub commit monitoring -- bind your account and the pet cheers on new commits
- Auto-start on boot (Tauri autostart plugin)
- Always-on-top (preference persisted across sessions)

### Rich Right-Click Menu

Right-click the pet to open a feature menu with everything at a glance.

## Quick Start

**Install**

Download the latest installer (`.msi`, `setup.exe`, or macOS build artifact) from the [Releases](https://github.com/ZhangYiLong416/DesktopPet/releases) page. Launch after installation.

**Configure API (Optional)**

Right-click the pet > Chat Mode > Connect API, and fill in:

| Field | Description |
|-------|-------------|
| Endpoint | API service URL (any OpenAI-compatible endpoint) |
| Key | Your API key |
| Model | Model name |

Click "Save" to test connectivity. Green means success. Free API setup tutorial: [getAPI.md](docs/getAPI.md).

## Basic Controls

| Action | Effect |
|--------|--------|
| Left click | Pet greets you, spawns particle effects |
| Click and drag | Pet follows cursor, bounces on release |
| Right click | Opens context menu |
| Right click > Merit Mode | Opens the woodfish panel and starts/stops automatic hits |
| Drop files on pet | Files sent to recycle bin |
| Long idle | Pet zones out, thinks, then falls asleep |
| Move mouse to wake | Pet jumps up in surprise |

## Development

```bash
npm install            # Install dependencies
npm run build          # TypeScript check + Vite frontend build
npm run tauri dev      # Development mode (hot reload)
npm run tauri build    # Production build (generates installer)
```

Build output is located at `src-tauri/target/release/bundle/` (both NSIS and MSI formats).

Rust-only check:

```bash
cd src-tauri
cargo check
```

Pushing a `v*` tag triggers the GitHub Actions release workflow at `.github/workflows/publish.yml`. It currently builds Windows `nsis/msi` and macOS `dmg/app` artifacts.

## Technical Specs

- **Runtime**: Tauri v2 (Rust backend + WebView2 frontend)
- **Frontend**: Vite + TypeScript, zero-framework pure DOM rendering
- **Animation**: TypeScript timer-driven sprite engine + CSS feedback animations, no Canvas/WebGL
- **Audio**: HTML5 `Audio`, local sound assets managed by Vite
- **Installer**: Windows NSIS (.exe) / MSI, macOS DMG / App

## Pet Package Format

Supports importing custom pets (`.zip` files):

```
pet.json              -- Pet manifest (id, displayName, description, spritesheetPath, version)
spritesheet.webp      -- Sprite sheet (192x208 per cell, actions arranged by row)
```

Right-click > Settings > Import Pet (.zip) to swap. Detailed tutorial: [Import Guide](docs/daorujiaocheng.md).

## License

MIT
