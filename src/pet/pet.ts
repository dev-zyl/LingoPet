import "./pet.css";
import { getCurrentWindow, cursorPosition, currentMonitor, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { Solar } from "lunar-javascript";

// ── Codex Pet Standard Types ──

interface FrameAnimation {
  row: number;
  frames: number;
  frameDurations: number[]; // ms per frame
}

interface PetAtlas {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  animations: Record<string, FrameAnimation>;
}

interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  kind?: string;
  version?: string;
  animations?: Record<string, FrameAnimation>;
}

type MusicRhythmSyncMode = "independent" | "aligned";
type FrameEvents = Record<number, () => void>;

// ── Codex Pet Standard Atlas (8x9, 192x208 per cell) ──

const CODEX_ATLAS: PetAtlas = {
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
  animations: {
    idle:            { row: 0, frames: 6, frameDurations: [280, 110, 110, 140, 140, 320] },
    "running-right": { row: 1, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
    "running-left":  { row: 2, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
    waving:          { row: 3, frames: 4, frameDurations: [140, 140, 140, 280] },
    jumping:         { row: 4, frames: 5, frameDurations: [140, 140, 140, 140, 280] },
    failed:          { row: 5, frames: 8, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting:         { row: 6, frames: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
    running:         { row: 7, frames: 6, frameDurations: [120, 120, 120, 120, 120, 220] },
    review:          { row: 8, frames: 6, frameDurations: [150, 150, 150, 150, 150, 280] },
  },
};

const MODE_ANIMATION_PRESETS: Record<string, FrameAnimation> = {
  merit: { row: 9, frames: 4, frameDurations: [150, 150, 150, 300] },
  focus: { row: 10, frames: 4, frameDurations: [300, 300, 360, 300] },
  music: { row: 11, frames: 8, frameDurations: [140, 140, 140, 140, 140, 140, 180, 240] },
};

// ── Audio SFX (HTML5 Audio, no external libs) ──

const LS_PET_VOLUME = "pet-volume";

const sfx = {
  pop: new Audio(new URL("../assets/audio/pop.mp3", import.meta.url).href),
  boing: new Audio(new URL("../assets/audio/alexzavesa-water-drop-tap-3-463592.mp3", import.meta.url).href),
  bubble: new Audio(new URL("../assets/audio/bubble.mp3", import.meta.url).href),
  bell: new Audio(new URL("../assets/audio/bell.mp3", import.meta.url).href),
  crunch: new Audio(new URL("../assets/audio/crunch.mp3", import.meta.url).href),
  woodfish: new Audio(new URL("../assets/audio/woodfish-hit.mp3", import.meta.url).href),
};

function getPetVolumePercent(): number {
  const saved = Number(localStorage.getItem(LS_PET_VOLUME) || "60");
  return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 60;
}

function applyPetVolume(percent: number): void {
  const level = Math.min(100, Math.max(0, percent)) / 100;
  Object.values(sfx).forEach((audio) => {
    audio.volume = level;
  });
}

applyPetVolume(getPetVolumePercent());

function playSound(type: keyof typeof sfx): void {
  const audio = sfx[type];
  audio.currentTime = 0;
  audio.play().catch((e) => console.warn("Audio play failed:", e));
}

// ── PetEngine ──

class PetEngine {
  private spriteEl: HTMLElement;
  private atlas: PetAtlas;
  public currentState: string = "idle";
  private currentFrame: number = 0;
  private timerHandle: number | null = null;

  constructor(spriteEl: HTMLElement, atlas: PetAtlas, spritesheetUrl: string) {
    this.spriteEl = spriteEl;
    this.atlas = atlas;

    this.spriteEl.style.width = `${atlas.cellWidth}px`;
    this.spriteEl.style.height = `${atlas.cellHeight}px`;
    this.spriteEl.style.backgroundImage = `url("${spritesheetUrl}")`;
    this.spriteEl.style.backgroundRepeat = "no-repeat";
    this.inferAtlasFromSpritesheet(spritesheetUrl);

    this.applyState("idle");
  }

  hasState(state: string): boolean {
    return Boolean(this.atlas.animations[state]);
  }

  frameCount(state: string): number {
    return this.atlas.animations[state]?.frames ?? 0;
  }

  applyState(state: string): void {
    const anim = this.atlas.animations[state];
    if (!anim) {
      console.warn(`Unknown state: ${state}, falling back to idle`);
      this.applyState("idle");
      return;
    }

    this.stop();
    this.currentState = state;
    this.currentFrame = this.alignedFrameIndex(anim);
    this.showFrame(this.currentFrame);
    this.startLoop();
  }

  private showFrame(index: number): void {
    const anim = this.atlas.animations[this.currentState];
    const x = index * this.atlas.cellWidth;
    const y = anim.row * this.atlas.cellHeight;
    this.spriteEl.style.backgroundPosition = `-${x}px -${y}px`;
  }

  private startLoop(): void {
    const anim = this.atlas.animations[this.currentState];
    const advance = () => {
      if (this.shouldUseAlignedMusicFrames()) {
        this.currentFrame = this.alignedFrameIndex(anim);
        this.showFrame(this.currentFrame);
        this.timerHandle = window.setTimeout(advance, this.msUntilNextAlignedFrame(anim));
        return;
      }

      this.currentFrame = (this.currentFrame + 1) % anim.frames;
      this.showFrame(this.currentFrame);
      const delay = this.frameDelay(anim, this.currentFrame);
      this.timerHandle = window.setTimeout(advance, delay);
    };
    this.timerHandle = window.setTimeout(
      advance,
      this.shouldUseAlignedMusicFrames() ? this.msUntilNextAlignedFrame(anim) : this.frameDelay(anim, this.currentFrame),
    );
  }

  refreshCurrentAnimationTiming(): void {
    if (this.currentState !== "music") return;
    this.stop();
    const anim = this.atlas.animations[this.currentState];
    this.currentFrame = this.alignedFrameIndex(anim);
    this.showFrame(this.currentFrame);
    this.startLoop();
  }

  private shouldUseAlignedMusicFrames(): boolean {
    return this.currentState === "music" && getMusicRhythmSyncMode() === "aligned";
  }

  private animationCycleDuration(anim: FrameAnimation): number {
    return Array.from({ length: anim.frames }, (_, index) => this.frameDelay(anim, index))
      .reduce((sum, delay) => sum + delay, 0);
  }

  private alignedFrameIndex(anim: FrameAnimation, now = Date.now()): number {
    if (!this.shouldUseAlignedMusicFrames()) return 0;
    const cycle = this.animationCycleDuration(anim);
    if (cycle <= 0) return 0;
    let elapsed = now % cycle;
    for (let index = 0; index < anim.frames; index += 1) {
      elapsed -= this.frameDelay(anim, index);
      if (elapsed < 0) return index;
    }
    return 0;
  }

  private msUntilNextAlignedFrame(anim: FrameAnimation, now = Date.now()): number {
    const cycle = this.animationCycleDuration(anim);
    if (cycle <= 0) return this.frameDelay(anim, this.currentFrame);
    let elapsed = now % cycle;
    for (let index = 0; index < anim.frames; index += 1) {
      const delay = this.frameDelay(anim, index);
      if (elapsed < delay) return Math.max(16, delay - elapsed);
      elapsed -= delay;
    }
    return 16;
  }

  private frameDelay(anim: FrameAnimation, index: number): number {
    return anim.frameDurations[index] ?? anim.frameDurations[anim.frameDurations.length - 1] ?? 150;
  }

  private stop(): void {
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  setSpritesheet(url: string): void {
    this.spriteEl.style.backgroundImage = `url("${url}")`;
    this.inferAtlasFromSpritesheet(url);
    if (isMeritMode && this.hasState("merit")) {
      this.applyState("merit");
    } else if (isFocusMode && this.hasState("focus")) {
      this.applyState("focus");
    } else if (isMusicRhythmMode && this.hasState("music")) {
      this.applyState("music");
    } else {
      this.applyState("idle");
    }
  }

  setAtlas(atlas: PetAtlas): void {
    this.atlas = atlas;
    this.applyState(this.atlas.animations[this.currentState] ? this.currentState : "idle");
  }

  playOnce(state: string, fallbackState = "idle", frameEvents: FrameEvents = {}): void {
    const anim = this.atlas.animations[state];
    if (!anim) {
      this.applyState(fallbackState);
      return;
    }

    this.stop();
    this.currentState = state;
    this.currentFrame = 0;
    this.showFrame(0);
    frameEvents[0]?.();

    const advance = () => {
      this.currentFrame += 1;
      if (this.currentFrame >= anim.frames) {
        this.applyState(this.atlas.animations[fallbackState] ? fallbackState : "idle");
        return;
      }
      this.showFrame(this.currentFrame);
      frameEvents[this.currentFrame]?.();
      this.timerHandle = window.setTimeout(advance, this.frameDelay(anim, this.currentFrame));
    };
    this.timerHandle = window.setTimeout(advance, this.frameDelay(anim, 0));
  }

  destroy(): void {
    this.stop();
  }

  private inferAtlasFromSpritesheet(url: string): void {
    const image = new Image();
    image.onload = () => {
      const rows = Math.floor(image.naturalHeight / this.atlas.cellHeight);
      const inferredFrameCounts = this.inferFrameCountsByRow(image, rows);
      const animations = { ...this.atlas.animations };

      for (const [key, preset] of Object.entries(MODE_ANIMATION_PRESETS)) {
        if (rows > preset.row && !animations[key]) {
          animations[key] = this.normalizedAnimation(preset, inferredFrameCounts[preset.row]);
        }
      }

      for (const [key, animation] of Object.entries(animations)) {
        animations[key] = this.normalizedAnimation(animation, inferredFrameCounts[animation.row]);
      }

      this.atlas = {
        ...this.atlas,
        rows: Math.max(this.atlas.rows, rows),
        animations,
      };

      if (isMeritMode && this.hasState("merit")) {
        document.getElementById("pet-container")?.classList.remove("merit-active", "merit-hit");
        this.applyState("merit");
      } else if (isFocusMode && this.hasState("focus")) {
        this.applyState("focus");
      } else if (isMusicRhythmMode && this.hasState("music")) {
        this.applyState("music");
      }
    };
    image.src = url;
  }

  private normalizedAnimation(animation: FrameAnimation, inferredFrames = 0): FrameAnimation {
    const frames = Math.max(1, Math.min(this.atlas.columns, Math.max(animation.frames, inferredFrames)));
    const frameDurations = Array.from({ length: frames }, (_, index) => this.frameDelay(animation, index));
    return { ...animation, frames, frameDurations };
  }

  private inferFrameCountsByRow(image: HTMLImageElement, rows: number): number[] {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return [];
      ctx.drawImage(image, 0, 0);
      const counts: number[] = [];
      const cols = Math.min(this.atlas.columns, Math.floor(image.naturalWidth / this.atlas.cellWidth));
      for (let row = 0; row < rows; row += 1) {
        let lastContentFrame = 0;
        for (let col = 0; col < cols; col += 1) {
          const data = ctx.getImageData(
            col * this.atlas.cellWidth,
            row * this.atlas.cellHeight,
            this.atlas.cellWidth,
            this.atlas.cellHeight,
          ).data;
          for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 12) {
              lastContentFrame = col + 1;
              break;
            }
          }
        }
        counts[row] = lastContentFrame;
      }
      return counts;
    } catch (err) {
      console.warn("Failed to infer animation frame counts:", err);
      return [];
    }
  }
}

// ── Block native context menu globally ──

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// ── SVG Particles (safe, no emoji) ──

const PARTICLE_SVGS = [
  // Heart
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20d='M12%2021.35l-1.45-1.32C5.4%2015.36%202%2012.28%202%208.5%202%205.42%204.42%203%207.5%203c1.74%200%203.41.81%204.5%202.09C13.09%203.81%2014.76%203%2016.5%203%2019.58%203%2022%205.42%2022%208.5c0%203.78-3.4%206.86-8.55%2011.54L12%2021.35z'%20fill='%23EE6363'/%3E%3C/svg%3E",
  // Smile face
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'%20fill='%23FFD93D'/%3E%3Ccircle%20cx='8'%20cy='10'%20r='1.5'%20fill='%23333'/%3E%3Ccircle%20cx='16'%20cy='10'%20r='1.5'%20fill='%23333'/%3E%3Cpath%20d='M8%2014s1.5%203%204%203%204-3%204-3'%20stroke='%23333'%20stroke-width='1.5'%20stroke-linecap='round'%20fill='none'/%3E%3C/svg%3E",
  // Dog face
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='13'%20r='9'%20fill='%23C4A46E'/%3E%3Cellipse%20cx='7'%20cy='6'%20rx='3'%20ry='4'%20fill='%238B6E4E'/%3E%3Cellipse%20cx='17'%20cy='6'%20rx='3'%20ry='4'%20fill='%238B6E4E'/%3E%3Ccircle%20cx='9'%20cy='12'%20r='1.5'%20fill='%23333'/%3E%3Ccircle%20cx='15'%20cy='12'%20r='1.5'%20fill='%23333'/%3E%3Cellipse%20cx='12'%20cy='15'%20rx='2'%20ry='1.5'%20fill='%23333'/%3E%3C/svg%3E",
  // Wink face
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'%20fill='%23FFD93D'/%3E%3Ccircle%20cx='8'%20cy='10'%20r='1.5'%20fill='%23333'/%3E%3Cpath%20d='M14%2010h4'%20stroke='%23333'%20stroke-width='2'%20stroke-linecap='round'/%3E%3Cpath%20d='M8%2014s1.5%203%204%203%204-3%204-3'%20stroke='%23333'%20stroke-width='1.5'%20stroke-linecap='round'%20fill='none'/%3E%3C/svg%3E",
  // Heart eyes
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'%20fill='%23FFD93D'/%3E%3Cpath%20d='M6%209.5C6%208%207.5%207%208.5%208.5L9%209l-.5.5L8%209C7%208%206%208.5%206%209.5z'%20fill='%23EE6363'/%3E%3Cpath%20d='M15%209.5C15%208%2016.5%207%2017.5%208.5L18%209l-.5.5L17%209c-1-1-2-.5-2%20.5z'%20fill='%23EE6363'/%3E%3Cpath%20d='M8%2014s1.5%203%204%203%204-3%204-3'%20stroke='%23333'%20stroke-width='1.5'%20stroke-linecap='round'%20fill='none'/%3E%3C/svg%3E",
  // Star
  "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20d='M12%202l3%206%206%201-4.5%204.5L18%2020l-6-3-6%203%201.5-6.5L3%209l6-1z'%20fill='%23FFD93D'%20stroke='%23F9A825'%20stroke-width='0.5'/%3E%3C/svg%3E",
];

function spawnParticles(x: number, y: number): void {
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    const offsetX = (Math.random() - 0.5) * 20;
    const offsetY = (Math.random() - 0.5) * 20;
    particle.style.left = `${x + offsetX}px`;
    particle.style.top = `${y + offsetY}px`;
    particle.style.backgroundImage = `url("${PARTICLE_SVGS[Math.floor(Math.random() * PARTICLE_SVGS.length)]}")`;
    particle.addEventListener("animationend", () => particle.remove());
    document.body.appendChild(particle);
  }
}

// ── Music Rhythm Visualizer ──

const LS_MUSIC_RHYTHM_ENABLED = "pet_music_rhythm_enabled";
const LS_MUSIC_RHYTHM_SYNC_MODE = "pet_music_rhythm_sync_mode";
const MUSIC_NOTE_CHARS = ["♪", "♫", "♬", "♩"];
let isMusicRhythmAutoEnabled = localStorage.getItem(LS_MUSIC_RHYTHM_ENABLED) !== "false";
let isMusicRhythmMode = false;
let musicRhythmTimerId: number | null = null;
let musicRhythmPollTimerId: number | null = null;
let lastSystemAudioPlaying = false;

function getMusicRhythmSyncMode(): MusicRhythmSyncMode {
  return localStorage.getItem(LS_MUSIC_RHYTHM_SYNC_MODE) === "aligned" ? "aligned" : "independent";
}

function spawnMusicNote(): void {
  const container = document.getElementById("pet-container");
  const rect = container?.getBoundingClientRect();
  if (!rect) return;

  const note = document.createElement("div");
  note.className = "music-note";
  note.textContent = MUSIC_NOTE_CHARS[Math.floor(Math.random() * MUSIC_NOTE_CHARS.length)];
  note.style.left = `${rect.left + rect.width * (0.42 + Math.random() * 0.28)}px`;
  note.style.top = `${rect.top + rect.height * (0.16 + Math.random() * 0.22)}px`;
  note.style.setProperty("--note-drift-x", `${(Math.random() - 0.25) * 58}px`);
  note.addEventListener("animationend", () => note.remove());
  document.body.appendChild(note);
}

function scheduleNextMusicBeat(): void {
  if (!isMusicRhythmMode) return;
  const nextBeatMs = 360 + Math.floor(Math.random() * 340);
  musicRhythmTimerId = window.setTimeout(() => {
    spawnMusicNote();
    if (Math.random() > 0.62) {
      window.setTimeout(spawnMusicNote, 120);
    }
    scheduleNextMusicBeat();
  }, nextBeatMs);
}

function setMusicRhythmMode(enabled: boolean, announce = true): void {
  isMusicRhythmMode = enabled;

  const container = document.getElementById("pet-container");
  container?.classList.toggle("music-rhythm-active", enabled);

  if (musicRhythmTimerId !== null) {
    window.clearTimeout(musicRhythmTimerId);
    musicRhythmTimerId = null;
  }
  if (enabled) {
    const engine = (window as any).__petEngine as PetEngine | undefined;
    if (engine?.hasState("music")) engine.applyState("music");
    spawnMusicNote();
    scheduleNextMusicBeat();
  } else {
    const engine = (window as any).__petEngine as PetEngine | undefined;
    if (engine?.currentState === "music") engine.applyState("idle");
  }

  if (announce) {
    showSpeech(enabled ? "音乐律动开启" : "音乐律动关闭", 1600);
  }
}

function updateMusicRhythmButton(): void {
  const musicButton = document.getElementById("context-music") as HTMLButtonElement | null;
  if (!musicButton) return;

  musicButton.classList.toggle("is-active", isMusicRhythmAutoEnabled);
  musicButton.setAttribute("aria-pressed", String(isMusicRhythmAutoEnabled));
  const label = musicButton.querySelector("span:last-child");
  if (label) {
    label.textContent = isMusicRhythmAutoEnabled ? "音乐律动" : "律动关闭";
  }
}

async function pollSystemAudioState(): Promise<void> {
  if (!isMusicRhythmAutoEnabled) return;
  if (!isTauriRuntime()) return;

  try {
    const isPlaying = await invoke<boolean>("is_system_audio_playing");
    lastSystemAudioPlaying = isPlaying;
    if (isPlaying !== isMusicRhythmMode) {
      setMusicRhythmMode(isPlaying, false);
    }
  } catch (err) {
    console.warn("system audio check failed:", err);
  }
}

function setMusicRhythmAutoEnabled(enabled: boolean, announce = true): void {
  isMusicRhythmAutoEnabled = enabled;
  localStorage.setItem(LS_MUSIC_RHYTHM_ENABLED, enabled ? "true" : "false");
  updateMusicRhythmButton();

  if (!enabled) {
    setMusicRhythmMode(false, false);
    lastSystemAudioPlaying = false;
  } else {
    void pollSystemAudioState();
  }

  if (announce) {
    showSpeech(enabled ? "系统音频感知开启" : "系统音频感知关闭", 1800);
  }
}

function setupMusicRhythmMode(): void {
  updateMusicRhythmButton();
  if (musicRhythmPollTimerId !== null) {
    window.clearInterval(musicRhythmPollTimerId);
  }
  void pollSystemAudioState();
  musicRhythmPollTimerId = window.setInterval(() => {
    void pollSystemAudioState();
  }, lastSystemAudioPlaying ? 900 : 1800);
}

// ── Drag & Physics (State Machine) ──

let isMouseDown = false;
let hasStartedDragging = false;
let isDraggingInProgress = false;
let dragThreshold = 5;
let mouseDownX = 0;
let mouseDownY = 0;
let manualDragFrame: number | null = null;
let manualDragSessionId = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let petWindowOffsetX = 0;
let petWindowOffsetBottom = 0;

// ── Bio-Clock State ──
let isExiting = false;
let lastActivityTime = Date.now();

// ── Always-on-Top State (persisted) ──
let isAlwaysOnTop = localStorage.getItem("pet-always-on-top") !== "false";
const LS_PET_SIZE_SCALE = "pet_size_scale";
const PET_BASE_WIDTH = 192;
const PET_BASE_HEIGHT = 208;
const PET_WINDOW_TOP_PADDING = 48;
const PET_CONTEXT_MENU_SPACE = 174;
// ── Focus Mode State ──
let isFocusMode = false;
let focusEndTime = 0;
let focusDurationMs = 0;
let focusIntervalId: ReturnType<typeof setInterval> | null = null;
let isMeritMode = false;
let meritIntervalId: ReturnType<typeof setInterval> | null = null;
let lastPetInteractionTime = 0;
let isPetHovered = false;
let isPetMenuOpen = false;
let isPetPanelOpen = false;
let isRecallAnimating = false;
let lastDragEndTime = 0;
let isWindowIgnoringCursor = false;
let lastKnownCursorX = -1;
let lastKnownCursorY = -1;
let lastSpriteFacing: "left" | "right" | null = null;

// ── API Settings & Chat Mode ──

const LS_API_ENDPOINT = "pet_api_endpoint";
const LS_API_KEY = "pet_api_key";
const LS_API_MODEL = "pet_api_model";
const LS_CHAT_MODE = "pet_chat_mode";
const LS_PERSONA_MODE = "pet_persona_mode";
const LS_CUSTOM_PERSONA = "pet_custom_persona_text";
const LS_GITHUB_USERNAME = "pet_github_username";
const LS_GITHUB_LAST_PUSH = "pet_github_last_push_time";
const LS_TODOS = "pet_todos";
const LS_PRIMARY_PET_ID = "pet_primary_project_id";
const LS_FOCUS_MINUTES = "pet_focus_minutes";
const LS_SUMMONED_PET_IDS = "pet_summoned_pet_ids";
const LS_PET_ASSETS_VERSION = "pet_assets_version";
const LS_PET_EXTERNAL_SPEECH = "pet_external_speech";
const LS_PET_WINDOW_STATE_VERSION = "pet_window_state_version";
const LS_MERIT_TEXT = "pet_merit_text";
const LS_MERIT_COUNT = "pet_merit_count";
const LS_MERIT_TODAY_DATE = "pet_merit_today_date";
const LS_MERIT_TODAY_COUNT = "pet_merit_today_count";
const LS_MERIT_ENABLED = "pet_merit_enabled";
const MERIT_DEFAULT_TEXT = "功德";
const MERIT_HIT_INTERVAL_MS = 1600;
let apiKeyMigrationWarned = false;

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function saveApiKey(key: string): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem(LS_API_KEY, key);
    return;
  }
  await invoke("set_api_key", { key });
  localStorage.removeItem(LS_API_KEY);
}

async function getApiKey(): Promise<string | null> {
  if (!isTauriRuntime()) return localStorage.getItem(LS_API_KEY);

  const legacyKey = localStorage.getItem(LS_API_KEY);
  if (legacyKey) {
    try {
      await invoke("set_api_key", { key: legacyKey });
      localStorage.removeItem(LS_API_KEY);
      return legacyKey;
    } catch (err) {
      console.warn("API key migration failed:", err);
      if (!apiKeyMigrationWarned) {
        apiKeyMigrationWarned = true;
        showSpeech("API Key 安全迁移失败，请重新保存 API 设置", 5000);
      }
      return null;
    }
  }

  return await invoke<string | null>("get_api_key");
}

function getSavedSummonedPetIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_SUMMONED_PET_IDS) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function setSavedSummonedPetIds(petIds: string[]): void {
  localStorage.setItem(LS_SUMMONED_PET_IDS, JSON.stringify(petIds.filter(Boolean)));
}

function notifyPetWindowStateChanged(): void {
  localStorage.setItem(LS_PET_WINDOW_STATE_VERSION, String(Date.now()));
}

function removeOneSavedSummonedPetId(petId: string): void {
  const petIds = getSavedSummonedPetIds();
  const index = petIds.indexOf(petId);
  if (index >= 0) petIds.splice(index, 1);
  setSavedSummonedPetIds(petIds);
}

interface TodoItem {
  id: string;
  type: "note" | "reminder";
  taskText: string;
  createdAt: number;
  delayMinutes: number | null;
  recurrence?: "once" | "repeat";
  nextTriggerAt?: number;
}

const todoTimers = new Map<string, ReturnType<typeof setTimeout>>();
let reminderAudio: HTMLAudioElement | null = null;
let dismissActiveReminder: (() => void) | null = null;

function formatDelay(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}秒`;
  if (minutes < 60) return `${Math.round(minutes)}分钟`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

let lastSmartSpeechTimestamp = 0;
const SMART_COOLDOWN = 5 * 60 * 1000;

function getPetSizeScale(): number {
  const saved = Number(localStorage.getItem(LS_PET_SIZE_SCALE) || "0.6");
  if (!Number.isFinite(saved)) return 0.6;
  return Math.min(1.4, Math.max(0.35, saved));
}

function getPetPixelSize(scale = getPetSizeScale()): { width: number; height: number } {
  return {
    width: Math.round(Math.max(PET_BASE_WIDTH + PET_CONTEXT_MENU_SPACE, PET_BASE_WIDTH * scale + PET_CONTEXT_MENU_SPACE)),
    height: Math.round(PET_WINDOW_TOP_PADDING + Math.max(PET_BASE_HEIGHT, PET_BASE_HEIGHT * scale)),
  };
}

function getPetVisualRectInWindow(width: number, height: number, scale = getPetSizeScale()): { left: number; top: number; width: number; height: number } {
  void scale;
  const visualWidth = PET_BASE_WIDTH;
  const visualHeight = PET_BASE_HEIGHT;
  return {
    left: width / 2 - visualWidth / 2,
    top: height - visualHeight,
    width: visualWidth,
    height: visualHeight,
  };
}

function setPetWindowOffset(offsetX: number, offsetBottom: number): void {
  petWindowOffsetX = Math.round(offsetX);
  petWindowOffsetBottom = Math.max(0, Math.round(offsetBottom));
  document.documentElement.style.setProperty("--pet-window-offset-x", `${petWindowOffsetX}px`);
  document.documentElement.style.setProperty("--pet-window-offset-bottom", `${petWindowOffsetBottom}px`);
}

function formatPetSize(scale = getPetSizeScale()): string {
  return `${Math.round(scale * 100)}% · ${Math.round(PET_BASE_WIDTH * scale)} x ${Math.round(PET_BASE_HEIGHT * scale)}px`;
}

async function applyPetSizeScale(scale = getPetSizeScale()): Promise<void> {
  const nextScale = Math.min(1.4, Math.max(0.35, scale));
  localStorage.setItem(LS_PET_SIZE_SCALE, String(nextScale));
  document.documentElement.style.setProperty("--pet-scale", String(nextScale));
  document.documentElement.style.setProperty("--pet-window-top-padding", `${PET_WINDOW_TOP_PADDING}px`);

  const appWindow = getCurrentWindow();
  const size = getPetPixelSize(nextScale);
  await appWindow.setSize(new LogicalSize(size.width, size.height));
  await clampCurrentWindowToRoamBounds();
}

function setupSizePanel(): void {
  const panel = document.getElementById("size-panel");
  const slider = document.getElementById("size-slider") as HTMLInputElement | null;
  const input = document.getElementById("size-input") as HTMLInputElement | null;
  const text = document.getElementById("size-text");
  if (!panel || !slider || !input || !text) return;

  const updateSize = (percent: number): void => {
    const nextPercent = Math.min(140, Math.max(35, Math.round(percent)));
    const scale = nextPercent / 100;
    slider.value = String(nextPercent);
    input.value = String(nextPercent);
    text.textContent = formatPetSize(scale);
    void applyPetSizeScale(scale);
    lastPetInteractionTime = Date.now();
  };

  slider.addEventListener("input", () => {
    updateSize(Number(slider.value));
  });

  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) updateSize(value);
  });

  input.addEventListener("change", () => {
    updateSize(Number(input.value) || Math.round(getPetSizeScale() * 100));
  });

  panel.addEventListener("mouseenter", () => {
    isPetPanelOpen = true;
    lastPetInteractionTime = Date.now();
  });

  panel.addEventListener("mouseleave", () => {
    isPetPanelOpen = false;
    panel.style.display = "none";
    panel.style.bottom = "-96px";
  });
}

function formatFocusRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function updateFocusStatusText(text: string): void {
  const status = document.getElementById("focus-status-text");
  if (status) status.textContent = text;
}

function updateFocusPanelState(remainingMs: number, running: boolean): void {
  updateFocusStatusText(formatFocusRemaining(remainingMs));
  const label = document.getElementById("focus-state-label");
  if (label) label.textContent = running ? "工作中，桌宠会保持安静" : "准备开始";

  const bar = document.getElementById("focus-progress-bar") as HTMLElement | null;
  if (bar) {
    const progress = running && focusDurationMs > 0
      ? 1 - clamp(remainingMs / focusDurationMs, 0, 1)
      : 0;
    bar.style.width = `${Math.round(progress * 100)}%`;
  }
}

function syncFocusPresetButtons(minutes: number): void {
  document.querySelectorAll<HTMLButtonElement>(".focus-preset").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.focusMinutes) === minutes);
  });
}

function setFocusBubbleText(text: string): void {
  const bubble = document.getElementById("pet-speech-bubble");
  const bubbleText = bubble?.querySelector(".bubble-text") as HTMLElement | null;
  if (!bubble || !bubbleText) return;
  bubbleText.textContent = text;
  bubble.classList.add("show-bubble");
}

function clearFocusTimer(): void {
  if (focusIntervalId) {
    clearInterval(focusIntervalId);
    focusIntervalId = null;
  }
}

function startFocusMode(minutes: number, engine: PetEngine): void {
  if (isMeritMode) endMeritMode(engine, false);
  const duration = Math.min(240, Math.max(1, Math.round(minutes)));
  localStorage.setItem(LS_FOCUS_MINUTES, String(duration));
  clearFocusTimer();

  isFocusMode = true;
  if (manualDragFrame !== null) {
    window.cancelAnimationFrame(manualDragFrame);
    manualDragFrame = null;
  }
  isMouseDown = false;
  hasStartedDragging = false;
  isDraggingInProgress = false;
  focusDurationMs = duration * 60_000;
  focusEndTime = Date.now() + focusDurationMs;
  lastPetInteractionTime = Date.now();
  lastActivityTime = Date.now();
  engine.applyState(engine.hasState("focus") ? "focus" : "review");
  showSpeech(`专注 ${duration} 分钟，开始工作`, 2600);
  syncFocusPresetButtons(duration);

  focusIntervalId = setInterval(() => {
    if (!isFocusMode) return;
    const remaining = focusEndTime - Date.now();
    if (remaining <= 0) {
      endFocusMode(engine, true);
      return;
    }
    const remainingText = formatFocusRemaining(remaining);
    updateFocusPanelState(remaining, true);
    setFocusBubbleText(`专注中 ${remainingText}`);
    const focusState = engine.hasState("focus") ? "focus" : "review";
    if (engine.currentState !== focusState) engine.applyState(focusState);
  }, 1000);

  updateFocusPanelState(focusDurationMs, true);
}

function endFocusMode(engine: PetEngine, completed: boolean): void {
  clearFocusTimer();
  const wasFocusMode = isFocusMode;
  isFocusMode = false;
  focusEndTime = 0;
  focusDurationMs = 0;
  const savedMinutes = Number(localStorage.getItem(LS_FOCUS_MINUTES) || "25");
  updateFocusPanelState(savedMinutes * 60_000, false);
  lastPetInteractionTime = Date.now();
  lastActivityTime = Date.now();

  if (!wasFocusMode) return;
  if (completed) playSound("bell");
  engine.applyState(completed ? "jumping" : "idle");
  showSpeech(completed ? "专注结束，辛苦啦！" : "已退出专注模式", 3200);
  if (completed) {
    window.setTimeout(() => {
      if (!isExiting && !isFocusMode && !isMeritMode) engine.applyState("idle");
    }, 1800);
  }
}

function showFocusPanel(): void {
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  const input = document.getElementById("focus-minutes-input") as HTMLInputElement | null;
  if (!panel || !input) return;

  input.value = localStorage.getItem(LS_FOCUS_MINUTES) || input.value || "25";
  const minutes = Math.min(240, Math.max(1, Math.round(Number(input.value) || 25)));
  input.value = String(minutes);
  syncFocusPresetButtons(minutes);
  updateFocusPanelState(isFocusMode ? focusEndTime - Date.now() : minutes * 60_000, isFocusMode);
  positionFocusPanel(panel);
  isPetPanelOpen = true;
  lastPetInteractionTime = Date.now();
}

function positionFocusPanel(panel: HTMLElement): void {
  const pet = document.getElementById("pet-container");
  const margin = 8;
  const gap = 8;
  panel.style.visibility = "hidden";
  panel.style.display = "block";
  panel.style.maxHeight = "";

  const panelRect = panel.getBoundingClientRect();
  const petRect = pet?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = margin;
  let top = margin;

  if (petRect) {
    const rightLeft = petRect.right + gap;
    const leftLeft = petRect.left - panelRect.width - gap;
    const sideTop = clamp(
      petRect.top + petRect.height / 2 - panelRect.height / 2,
      margin,
      viewportHeight - panelRect.height - margin,
    );

    if (rightLeft + panelRect.width <= viewportWidth - margin) {
      left = rightLeft;
      top = sideTop;
    } else if (leftLeft >= margin) {
      left = leftLeft;
      top = sideTop;
    } else {
      const aboveTop = petRect.top - panelRect.height - gap;
      if (aboveTop >= margin) {
        top = aboveTop;
        left = clamp(petRect.left + petRect.width / 2 - panelRect.width / 2, margin, viewportWidth - panelRect.width - margin);
      } else {
        left = clamp(viewportWidth - panelRect.width - margin, margin, viewportWidth - panelRect.width - margin);
        top = margin;
      }
    }
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.visibility = "";
}

function normalizeMeritText(value: string | null): string {
  const text = (value || "").trim();
  return text.length > 0 ? text.slice(0, 12) : MERIT_DEFAULT_TEXT;
}

function getMeritText(): string {
  return normalizeMeritText(localStorage.getItem(LS_MERIT_TEXT) || MERIT_DEFAULT_TEXT);
}

function getMeritCount(): number {
  const count = Number(localStorage.getItem(LS_MERIT_COUNT) || "0");
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function setMeritCount(count: number): void {
  localStorage.setItem(LS_MERIT_COUNT, String(Math.max(0, Math.floor(count))));
}

function getMeritDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureMeritTodayCount(): void {
  const today = getMeritDateKey();
  if (localStorage.getItem(LS_MERIT_TODAY_DATE) === today) return;
  localStorage.setItem(LS_MERIT_TODAY_DATE, today);
  localStorage.setItem(LS_MERIT_TODAY_COUNT, "0");
}

function getMeritTodayCount(): number {
  ensureMeritTodayCount();
  const count = Number(localStorage.getItem(LS_MERIT_TODAY_COUNT) || "0");
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function setMeritTodayCount(count: number): void {
  ensureMeritTodayCount();
  localStorage.setItem(LS_MERIT_TODAY_COUNT, String(Math.max(0, Math.floor(count))));
}

function updateMeritPanelState(): void {
  const label = document.getElementById("merit-state-label");
  const totalCount = document.getElementById("merit-total-count-text");
  const todayCount = document.getElementById("merit-today-count-text");
  const input = document.getElementById("merit-text-input") as HTMLInputElement | null;
  if (label) label.textContent = isMeritMode ? "木鱼敲击中" : "准备敲木鱼";
  if (totalCount) totalCount.textContent = String(getMeritCount());
  if (todayCount) todayCount.textContent = String(getMeritTodayCount());
  if (input && document.activeElement !== input) input.value = getMeritText();
}

function triggerFallbackMeritHit(container: HTMLElement | null): void {
  if (!container) return;
  container.classList.remove("merit-hit");
  void container.offsetWidth;
  container.classList.add("merit-hit");
  window.setTimeout(() => container.classList.remove("merit-hit"), 260);
}

function getMeritSoundFrame(engine: PetEngine): number {
  return Math.max(0, Math.min(2, engine.frameCount("merit") - 1));
}

function triggerMeritHit(engine: PetEngine): void {
  const container = document.getElementById("pet-container");
  const text = getMeritText();
  setMeritCount(getMeritCount() + 1);
  setMeritTodayCount(getMeritTodayCount() + 1);
  updateMeritPanelState();

  if (engine.hasState("merit")) {
    engine.playOnce("merit", isMeritMode ? "merit" : "idle", {
      [getMeritSoundFrame(engine)]: () => playSound("woodfish"),
    });
  } else {
    triggerFallbackMeritHit(container);
    if (engine.currentState !== "review") engine.applyState("review");
    playSound("woodfish");
  }

  showSpeech(`${text} +1`, 900, false);
}

function clearMeritTimer(): void {
  if (meritIntervalId) {
    clearInterval(meritIntervalId);
    meritIntervalId = null;
  }
}

function startMeritMode(engine: PetEngine): void {
  if (isFocusMode) endFocusMode(engine, false);
  clearMeritTimer();
  const container = document.getElementById("pet-container");
  const text = getMeritText();
  localStorage.setItem(LS_MERIT_TEXT, text);
  localStorage.setItem(LS_MERIT_ENABLED, "true");
  isMeritMode = true;
  if (manualDragFrame !== null) {
    window.cancelAnimationFrame(manualDragFrame);
    manualDragFrame = null;
  }
  isMouseDown = false;
  hasStartedDragging = false;
  isDraggingInProgress = false;
  lastPetInteractionTime = Date.now();
  lastActivityTime = Date.now();
  container?.classList.toggle("merit-active", !engine.hasState("merit"));
  engine.applyState(engine.hasState("merit") ? "merit" : "review");
  updateMeritPanelState();
  showSpeech(`${text}模式开始`, 1800);
  triggerMeritHit(engine);
  meritIntervalId = setInterval(() => {
    if (!isMeritMode) return;
    triggerMeritHit(engine);
  }, MERIT_HIT_INTERVAL_MS);
}

function endMeritMode(engine: PetEngine, announce = true): void {
  const wasMeritMode = isMeritMode;
  clearMeritTimer();
  isMeritMode = false;
  localStorage.setItem(LS_MERIT_ENABLED, "false");
  document.getElementById("pet-container")?.classList.remove("merit-active", "merit-hit");
  updateMeritPanelState();
  lastPetInteractionTime = Date.now();
  lastActivityTime = Date.now();
  if (!wasMeritMode) return;
  engine.applyState("idle");
  if (announce) showSpeech("功德模式已停止", 1800);
}

function showMeritPanel(): void {
  const panel = document.getElementById("merit-panel") as HTMLElement | null;
  const input = document.getElementById("merit-text-input") as HTMLInputElement | null;
  if (!panel || !input) return;
  input.value = getMeritText();
  updateMeritPanelState();
  positionFocusPanel(panel);
  isPetPanelOpen = true;
  lastPetInteractionTime = Date.now();
}

function setupMeritPanel(engine: PetEngine): void {
  const panel = document.getElementById("merit-panel") as HTMLElement | null;
  const input = document.getElementById("merit-text-input") as HTMLInputElement | null;
  const startBtn = document.getElementById("merit-start") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("merit-stop") as HTMLButtonElement | null;
  if (!panel || !input || !startBtn || !stopBtn) return;

  input.value = getMeritText();
  updateMeritPanelState();

  input.addEventListener("input", () => {
    const text = normalizeMeritText(input.value);
    localStorage.setItem(LS_MERIT_TEXT, text);
    lastPetInteractionTime = Date.now();
  });

  input.addEventListener("change", () => {
    input.value = getMeritText();
  });

  startBtn.addEventListener("click", () => {
    input.value = normalizeMeritText(input.value);
    localStorage.setItem(LS_MERIT_TEXT, input.value);
    startMeritMode(engine);
    panel.style.display = "none";
    isPetPanelOpen = false;
  });

  stopBtn.addEventListener("click", () => {
    endMeritMode(engine);
    panel.style.display = "none";
    isPetPanelOpen = false;
  });

  panel.addEventListener("mouseenter", () => {
    isPetPanelOpen = true;
    lastPetInteractionTime = Date.now();
  });

  window.addEventListener("pointerdown", (event) => {
    if (panel.style.display === "none") return;
    const target = event.target as Node | null;
    const hitbox = document.getElementById("pet-hitbox");
    if (target && (panel.contains(target) || hitbox?.contains(target))) return;
    panel.style.display = "none";
    isPetPanelOpen = false;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.style.display === "none") return;
    panel.style.display = "none";
    isPetPanelOpen = false;
  });
}

function setupFocusPanel(engine: PetEngine): void {
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  const input = document.getElementById("focus-minutes-input") as HTMLInputElement | null;
  const startBtn = document.getElementById("focus-start") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("focus-stop") as HTMLButtonElement | null;
  if (!panel || !input || !startBtn || !stopBtn) return;

  input.value = localStorage.getItem(LS_FOCUS_MINUTES) || "25";
  syncFocusPresetButtons(Number(input.value) || 25);
  updateFocusPanelState((Number(input.value) || 25) * 60_000, false);

  document.querySelectorAll<HTMLButtonElement>(".focus-preset").forEach((button) => {
    button.addEventListener("click", () => {
      if (isFocusMode) return;
      const minutes = Number(button.dataset.focusMinutes) || 25;
      input.value = String(minutes);
      localStorage.setItem(LS_FOCUS_MINUTES, String(minutes));
      syncFocusPresetButtons(minutes);
      updateFocusPanelState(minutes * 60_000, false);
      lastPetInteractionTime = Date.now();
    });
  });

  input.addEventListener("input", () => {
    if (isFocusMode) return;
    const minutes = Math.min(240, Math.max(1, Math.round(Number(input.value) || 25)));
    localStorage.setItem(LS_FOCUS_MINUTES, String(minutes));
    syncFocusPresetButtons(minutes);
    updateFocusPanelState(minutes * 60_000, false);
    lastPetInteractionTime = Date.now();
  });

  startBtn.addEventListener("click", () => {
    const minutes = Number(input.value) || 25;
    startFocusMode(minutes, engine);
    panel.style.display = "none";
    isPetPanelOpen = false;
  });

  stopBtn.addEventListener("click", () => {
    endFocusMode(engine, false);
    panel.style.display = "none";
    isPetPanelOpen = false;
  });

  panel.addEventListener("mouseenter", () => {
    isPetPanelOpen = true;
    lastPetInteractionTime = Date.now();
  });

  window.addEventListener("pointerdown", (event) => {
    if (panel.style.display === "none") return;
    const target = event.target as Node | null;
    const hitbox = document.getElementById("pet-hitbox");
    if (target && (panel.contains(target) || hitbox?.contains(target))) return;
    panel.style.display = "none";
    isPetPanelOpen = false;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.style.display === "none") return;
    panel.style.display = "none";
    isPetPanelOpen = false;
  });
}

function setupManagerSettingsSync(): void {
  let lastScale = getPetSizeScale();
  let lastAlwaysOnTop = isAlwaysOnTop;
  let lastPrimaryPetId = localStorage.getItem(LS_PRIMARY_PET_ID) || "ikun-pet";
  let lastPetAssetsVersion = localStorage.getItem(LS_PET_ASSETS_VERSION) || "";
  let lastMusicRhythmSyncMode = getMusicRhythmSyncMode();
  window.setInterval(() => {
    const nextScale = getPetSizeScale();
    if (Math.abs(nextScale - lastScale) > 0.001) {
      lastScale = nextScale;
      void applyPetSizeScale(nextScale);
    }

    const nextAlwaysOnTop = localStorage.getItem("pet-always-on-top") !== "false";
    if (nextAlwaysOnTop !== lastAlwaysOnTop) {
      lastAlwaysOnTop = nextAlwaysOnTop;
      isAlwaysOnTop = nextAlwaysOnTop;
      void getCurrentWindow().setAlwaysOnTop(nextAlwaysOnTop);
    }

    const nextMusicRhythmSyncMode = getMusicRhythmSyncMode();
    if (nextMusicRhythmSyncMode !== lastMusicRhythmSyncMode) {
      lastMusicRhythmSyncMode = nextMusicRhythmSyncMode;
      const engine = (window as any).__petEngine as PetEngine | undefined;
      engine?.refreshCurrentAnimationTiming();
    }

    const nextPrimaryPetId = localStorage.getItem(LS_PRIMARY_PET_ID) || "ikun-pet";
    const nextPetAssetsVersion = localStorage.getItem(LS_PET_ASSETS_VERSION) || "";
    const shouldReloadPrimaryPet = getCurrentWindow().label === "pet" && nextPrimaryPetId !== lastPrimaryPetId;
    const shouldReloadEditedAssets = nextPetAssetsVersion !== lastPetAssetsVersion;
    if (shouldReloadPrimaryPet || shouldReloadEditedAssets) {
      lastPrimaryPetId = nextPrimaryPetId;
      lastPetAssetsVersion = nextPetAssetsVersion;
      void loadPetAssets().then(({ spritesheetUrl, manifest }) => {
        const engine = (window as any).__petEngine as PetEngine | undefined;
        engine?.setAtlas(atlasFromManifest(manifest));
        engine?.setSpritesheet(`${spritesheetUrl}${spritesheetUrl.includes("?") ? "&" : "?"}v=${Date.now()}`);
      });
    }
  }, 600);
}

async function restoreSavedSummonedPets(): Promise<void> {
  if (getCurrentWindow().label !== "pet") return;
  const savedPetIds = getSavedSummonedPetIds();
  if (savedPetIds.length === 0) return;
  const primaryPetId = localStorage.getItem(LS_PRIMARY_PET_ID) || "ikun-pet";
  if (savedPetIds.length === 1 && savedPetIds[0] === primaryPetId) {
    setSavedSummonedPetIds([]);
    return;
  }

  try {
    const existing = await invoke<Array<{ label: string; petId: string }>>("list_summoned_pet_windows");
    if (existing.length > 0) return;
    for (const petId of savedPetIds) {
      await invoke("summon_pet_window", { petId });
    }
  } catch (err) {
    console.warn("restore saved summoned pets failed:", err);
  }
}

function setupApiSettingsPanel(): void {
  const panel = document.getElementById("api-settings-panel");
  const saveBtn = document.getElementById("api-settings-save") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("api-settings-cancel");
  if (!panel || !saveBtn || !cancelBtn) return;

  saveBtn.addEventListener("click", async () => {
    const epInput = document.getElementById("api-endpoint") as HTMLInputElement | null;
    const keyInput = document.getElementById("api-key") as HTMLInputElement | null;
    const modelInput = document.getElementById("api-model") as HTMLInputElement | null;
    if (!epInput || !keyInput) return;

    let endpoint = epInput.value.trim().replace(/\/+$/, "");
    if (!endpoint.endsWith("/chat/completions")) {
      endpoint += "/v1/chat/completions";
    }
    epInput.value = endpoint;

    const key = keyInput.value.trim();
    const userModel = modelInput?.value.trim() || "gpt-3.5-turbo";
    if (!endpoint || !key) return;

    saveBtn.disabled = true;
    saveBtn.textContent = "测试中...";
    saveBtn.classList.remove("success", "error");

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: userModel,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      });

      if (resp.ok) {
        saveBtn.classList.add("success");
        await saveApiKey(key);
        saveBtn.textContent = "连接成功";
        localStorage.setItem(LS_API_ENDPOINT, endpoint);
        localStorage.setItem(LS_API_MODEL, userModel);
        setTimeout(() => {
          panel.style.display = "none";
          saveBtn.classList.remove("success");
          saveBtn.textContent = "保存";
          saveBtn.disabled = false;
        }, 1000);
      } else {
        saveBtn.classList.add("error");
        saveBtn.textContent = "配置有误";
        setTimeout(() => {
          saveBtn.classList.remove("error");
          saveBtn.textContent = "保存";
          saveBtn.disabled = false;
        }, 1500);
      }
    } catch {
      saveBtn.classList.add("error");
      saveBtn.textContent = "配置有误";
      setTimeout(() => {
        saveBtn.classList.remove("error");
        saveBtn.textContent = "保存";
        saveBtn.disabled = false;
      }, 1500);
    }
  });

  cancelBtn.addEventListener("click", () => {
    panel.style.display = "none";
  });
}

function setupCustomPersonaPanel(): void {
  const panel = document.getElementById("custom-persona-panel");
  const saveBtn = document.getElementById("persona-settings-save");
  const cancelBtn = document.getElementById("persona-settings-cancel");
  if (!panel || !saveBtn || !cancelBtn) return;

  saveBtn.addEventListener("click", () => {
    const textarea = document.getElementById("custom-persona-text") as HTMLTextAreaElement | null;
    if (textarea) localStorage.setItem(LS_CUSTOM_PERSONA, textarea.value.trim());
    panel.style.display = "none";
  });

  cancelBtn.addEventListener("click", () => {
    panel.style.display = "none";
  });
}

function setupGitHubSettingsPanel(): void {
  const panel = document.getElementById("github-settings-panel");
  const saveBtn = document.getElementById("github-settings-save");
  const cancelBtn = document.getElementById("github-settings-cancel");
  const testBtn = document.getElementById("github-settings-test");
  if (!panel || !saveBtn || !cancelBtn || !testBtn) return;

  const usernameInput = document.getElementById("github-username-input") as HTMLInputElement | null;

  if (usernameInput) {
    usernameInput.addEventListener("input", () => {
      usernameInput.classList.remove("success-status");
    });
  }

  testBtn.addEventListener("click", async () => {
    const username = usernameInput?.value.trim();
    if (!username) {
      showSpeech("请先输入用户名", 3000);
      usernameInput?.classList.remove("success-status");
      return;
    }
    try {
      const resp = await fetch(`https://api.github.com/users/${username}`);
      if (resp.ok) {
        showSpeech("关联成功！已锁定账号。", 3000);
        usernameInput?.classList.add("success-status");
      } else if (resp.status === 404) {
        showSpeech("查无此人，请检查拼写。", 3000);
        usernameInput?.classList.remove("success-status");
      } else {
        showSpeech("网络异常，无法连接 GitHub。", 3000);
        usernameInput?.classList.remove("success-status");
      }
    } catch {
      showSpeech("网络异常，无法连接 GitHub。", 3000);
      usernameInput?.classList.remove("success-status");
    }
  });

  saveBtn.addEventListener("click", () => {
    const input = document.getElementById("github-username-input") as HTMLInputElement | null;
    if (input) {
      const username = input.value.trim();
      if (username) {
        localStorage.setItem(LS_GITHUB_USERNAME, username);
        localStorage.removeItem(LS_GITHUB_LAST_PUSH);
      }
    }
    panel.style.display = "none";
  });

  cancelBtn.addEventListener("click", () => {
    panel.style.display = "none";
  });
}

// ── Todo And Reminder Panels ──

let taskPanelJustOpened = false;

function positionTaskPanel(panel: HTMLElement): void {
  const pet = document.getElementById("pet-container");
  const margin = 12;
  const gap = 12;
  panel.style.visibility = "hidden";
  panel.style.display = "block";
  panel.style.maxHeight = `calc(100vh - ${margin * 2}px)`;

  const panelRect = panel.getBoundingClientRect();
  const petRect = pet?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = Math.max(margin, (viewportWidth - panelRect.width) / 2);
  let top = margin;

  if (petRect) {
    const aboveTop = petRect.top - panelRect.height - gap;
    const rightLeft = petRect.right + gap;
    const leftLeft = petRect.left - panelRect.width - gap;

    if (aboveTop >= margin) {
      top = aboveTop;
      left = clamp(petRect.left + petRect.width / 2 - panelRect.width / 2, margin, viewportWidth - panelRect.width - margin);
    } else if (rightLeft + panelRect.width <= viewportWidth - margin) {
      left = rightLeft;
      top = clamp(petRect.top, margin, viewportHeight - panelRect.height - margin);
    } else if (leftLeft >= margin) {
      left = leftLeft;
      top = clamp(petRect.top, margin, viewportHeight - panelRect.height - margin);
    } else {
      const safeHeight = Math.max(120, petRect.top - gap - margin);
      if (safeHeight < panelRect.height) {
        panel.style.maxHeight = `${safeHeight}px`;
      }
      top = margin;
      left = clamp(petRect.left + petRect.width / 2 - panelRect.width / 2, margin, viewportWidth - panelRect.width - margin);
    }
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.visibility = "";
}

function showTaskPanel(panelId: "todo-panel" | "reminder-panel"): void {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const engine = (window as any).__petEngine as PetEngine | undefined;
  const otherPanelId = panelId === "todo-panel" ? "reminder-panel" : "todo-panel";
  const otherPanel = document.getElementById(otherPanelId);
  if (otherPanel) otherPanel.style.display = "none";

  taskPanelJustOpened = true;
  positionTaskPanel(panel);
  lastPetInteractionTime = Date.now();
  engine?.applyState("idle");
  requestAnimationFrame(() => { taskPanelJustOpened = false; });
}

function showTodoPanel(): void {
  showTaskPanel("todo-panel");
}

function showReminderPanel(): void {
  showTaskPanel("reminder-panel");
}

function readTodoItems(): TodoItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_TODOS) || "[]") as TodoItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTodoItems(items: TodoItem[]): void {
  localStorage.setItem(LS_TODOS, JSON.stringify(items));
}

function getNextTriggerAt(item: TodoItem): number {
  return item.nextTriggerAt ?? item.createdAt + (item.delayMinutes || 0) * 60000;
}

function clearTodoTimers(id: string): void {
  const timer = todoTimers.get(id);
  const tickTimer = todoTimers.get(`${id}_tick`);
  if (timer) clearTimeout(timer);
  if (tickTimer) clearInterval(tickTimer);
  todoTimers.delete(id);
  todoTimers.delete(`${id}_tick`);
}

function removeTodoItem(id: string, removeElement = true): void {
  clearTodoTimers(id);
  writeTodoItems(readTodoItems().filter((item) => item.id !== id));
  if (removeElement) {
    document.getElementById(`todo-${id}`)?.remove();
    document.getElementById(`reminder-${id}`)?.remove();
  }
}

function upsertTodoItem(item: TodoItem): void {
  const items = readTodoItems();
  const index = items.findIndex((saved) => saved.id === item.id);
  if (index >= 0) items[index] = item;
  else items.push(item);
  writeTodoItems(items);
}

function setupTodoPanel(): void {
  const panelEl = document.getElementById("todo-panel");
  const reminderPanelEl = document.getElementById("reminder-panel");
  const inputEl = document.getElementById("todo-input") as HTMLInputElement | null;
  const submitBtnEl = document.getElementById("todo-submit") as HTMLButtonElement | null;
  const listEl = document.getElementById("todo-list");
  const reminderInputEl = document.getElementById("reminder-input") as HTMLInputElement | null;
  const reminderDelayEl = document.getElementById("reminder-delay") as HTMLInputElement | null;
  const reminderUnitEl = document.getElementById("reminder-unit") as HTMLSelectElement | null;
  const reminderRepeatEl = document.getElementById("reminder-repeat") as HTMLSelectElement | null;
  const reminderSubmitEl = document.getElementById("reminder-submit") as HTMLButtonElement | null;
  const reminderListEl = document.getElementById("reminder-list");
  if (!panelEl || !reminderPanelEl || !inputEl || !submitBtnEl || !listEl || !reminderInputEl || !reminderDelayEl || !reminderUnitEl || !reminderRepeatEl || !reminderSubmitEl || !reminderListEl) return;
  const panel = panelEl;
  const reminderPanel = reminderPanelEl;
  const input = inputEl;
  const submitBtn = submitBtnEl;
  const list = listEl;
  const reminderInput = reminderInputEl;
  const reminderDelay = reminderDelayEl;
  const reminderUnit = reminderUnitEl;
  const reminderRepeat = reminderRepeatEl;
  const reminderSubmit = reminderSubmitEl;
  const reminderList = reminderListEl;

  document.addEventListener("mousedown", (e) => {
    if (taskPanelJustOpened) return;
    if (panel.style.display === "block" && !panel.contains(e.target as Node)) {
      panel.style.display = "none";
    }
    if (reminderPanel.style.display === "block" && !reminderPanel.contains(e.target as Node)) {
      reminderPanel.style.display = "none";
    }
  });

  function renderNoteItem(item: TodoItem): void {
    const el = document.createElement("div");
    el.className = "todo-item-note";
    el.id = `todo-${item.id}`;

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = item.taskText;

    const actions = document.createElement("div");
    actions.className = "todo-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "todo-copy-btn";
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.taskText).then(() => {
        showSpeech("内容已复制！", 2000);
      }).catch(() => {});
    });

    const doneBtn = document.createElement("button");
    doneBtn.className = "todo-done-btn";
    doneBtn.textContent = "DONE";
    doneBtn.addEventListener("click", () => {
      removeTodoItem(item.id, false);
      el.style.opacity = "0";
      el.style.transition = "opacity 0.2s";
      setTimeout(() => el.remove(), 200);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(doneBtn);
    el.appendChild(actions);
    el.appendChild(text);
    list.prepend(el);
  }

  function renderReminderItem(item: TodoItem): void {
    clearTodoTimers(item.id);
    document.getElementById(`reminder-${item.id}`)?.remove();
    const el = document.createElement("div");
    el.className = "todo-item-reminder";
    el.id = `reminder-${item.id}`;

    const actions = document.createElement("div");
    actions.className = "todo-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "todo-done-btn";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", () => removeTodoItem(item.id));
    actions.appendChild(cancelBtn);

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = item.taskText;

    const badge = document.createElement("span");
    badge.className = "reminder-badge";
    badge.textContent = item.recurrence === "repeat" ? "循环" : "单次";

    const countdown = document.createElement("span");
    countdown.className = "todo-countdown";

    function tick(): void {
      const remaining = Math.max(0, getNextTriggerAt(item) - Date.now());
      if (remaining <= 0) {
        countdown.textContent = "00:00";
        return;
      }
      const hours = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      countdown.textContent = hours > 0
        ? `${String(hours).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    tick();
    const intervalId = setInterval(tick, 1000);
    todoTimers.set(`${item.id}_tick`, intervalId as unknown as ReturnType<typeof setTimeout>);

    el.appendChild(actions);
    el.appendChild(countdown);
    el.appendChild(badge);
    el.appendChild(text);
    reminderList.prepend(el);
  }

  async function alertReminder(item: TodoItem): Promise<void> {
    dismissActiveReminder?.();
    const appWindow = getCurrentWindow();
    const wasOnTop = isAlwaysOnTop;
    if (!wasOnTop) await appWindow.setAlwaysOnTop(true);

    reminderAudio = new Audio(new URL("../assets/audio/crunch.mp3", import.meta.url).href);
    reminderAudio.loop = true;
    reminderAudio.volume = Object.values(sfx)[0]?.volume ?? 0.6;
    reminderAudio.play().catch(() => {});

    const intervalText = formatDelay(item.delayMinutes!);
    const prefix = item.recurrence === "repeat" ? `循环提醒（每${intervalText}）：` : "提醒：";
    showSpeech(`${prefix}${item.taskText || "时间到了"}`, 999999);

    const container = document.getElementById("pet-container");
    container?.classList.add("reminder-pulse");
    const hitbox = document.getElementById("pet-hitbox");
    let dismissed = false;
    const dismissReminder = (): void => {
      if (dismissed) return;
      dismissed = true;
      reminderAudio?.pause();
      reminderAudio = null;
      container?.classList.remove("reminder-pulse");
      document.getElementById("pet-speech-bubble")?.classList.remove("show-bubble");
      if (!wasOnTop) void appWindow.setAlwaysOnTop(false);
      hitbox?.removeEventListener("click", dismissReminder);
      if (dismissActiveReminder === dismissReminder) dismissActiveReminder = null;
    };
    dismissActiveReminder = dismissReminder;
    hitbox?.addEventListener("click", dismissReminder, { once: true });
  }

  function scheduleReminder(item: TodoItem): void {
    if (item.type !== "reminder" || !item.delayMinutes) return;
    const ms = Math.max(0, getNextTriggerAt(item) - Date.now());

    const timerId = setTimeout(() => {
      clearTodoTimers(item.id);
      void alertReminder(item);
      if (item.recurrence === "repeat") {
        item.nextTriggerAt = Date.now() + item.delayMinutes! * 60000;
        upsertTodoItem(item);
        renderReminderItem(item);
        scheduleReminder(item);
      } else {
        removeTodoItem(item.id);
      }
    }, ms);

    todoTimers.set(item.id, timerId);
  }

  function handleTodoSubmit(): void {
    const raw = input.value.trim();
    if (!raw) {
      panel.style.display = "none";
      return;
    }

    // 立即清空输入并收起面板，给用户即时反馈
    input.value = "";
    panel.style.display = "none";

    const item: TodoItem = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "note",
      taskText: raw,
      createdAt: Date.now(),
      delayMinutes: null,
    };
    upsertTodoItem(item);
    renderNoteItem(item);
    showSpeech("已添加待办", 2000);
  }

  function handleReminderSubmit(): void {
    const raw = reminderInput.value.trim();
    const amount = Number(reminderDelay.value);
    if (!raw || !Number.isFinite(amount) || amount <= 0) {
      showSpeech("请填写提醒内容和有效时间", 2400);
      return;
    }
    const multiplier = reminderUnit.value === "hours" ? 60 : reminderUnit.value === "seconds" ? 1 / 60 : 1;
    const delayMinutes = Math.max(amount * multiplier, 1 / 60);
    const item: TodoItem = {
      id: `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "reminder",
      taskText: raw,
      createdAt: Date.now(),
      delayMinutes,
      recurrence: reminderRepeat.value === "repeat" ? "repeat" : "once",
      nextTriggerAt: Date.now() + delayMinutes * 60000,
    };
    reminderInput.value = "";
    reminderPanel.style.display = "none";
    upsertTodoItem(item);
    renderReminderItem(item);
    scheduleReminder(item);
    const kind = item.recurrence === "repeat" ? "循环提醒" : "提醒";
    showSpeech(`已设定${kind}：${formatDelay(delayMinutes)}后`, 3000);
  }

  submitBtn.addEventListener("click", handleTodoSubmit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleTodoSubmit();
  });
  reminderSubmit.addEventListener("click", handleReminderSubmit);
  reminderInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleReminderSubmit();
  });

  // Older reminders were single-use items without recurrence or nextTriggerAt.
  const saved = readTodoItems();
  const now = Date.now();
  const kept: TodoItem[] = [];
  for (const item of saved) {
    if (item.type === "note") {
      renderNoteItem(item);
      kept.push(item);
    } else if (item.type === "reminder") {
      if (!item.delayMinutes || item.delayMinutes <= 0) continue;
      item.recurrence = item.recurrence === "repeat" ? "repeat" : "once";
      if (item.recurrence === "repeat" && getNextTriggerAt(item) <= now) {
        item.nextTriggerAt = now + item.delayMinutes * 60000;
      }
      if (getNextTriggerAt(item) > now) {
        renderReminderItem(item);
        scheduleReminder(item);
        kept.push(item);
      }
    }
  }
  writeTodoItems(kept);
}

async function checkGitHubStatus(): Promise<void> {
  const username = localStorage.getItem(LS_GITHUB_USERNAME);
  if (!username) return;

  try {
    const resp = await fetch(`https://api.github.com/users/${username}/events/public`);
    if (!resp.ok) return;
    const events = await resp.json();

    const pushEvent = events.find((e: any) => e.type === "PushEvent");
    if (!pushEvent) return;

    const pushTime = pushEvent.created_at as string;
    const lastPush = localStorage.getItem(LS_GITHUB_LAST_PUSH);

    if (!lastPush || pushTime > lastPush) {
      localStorage.setItem(LS_GITHUB_LAST_PUSH, pushTime);
      if (lastPush) {
        showSpeech("捕捉到新 Commit！主人的绿点保住了！", 4000);
      }
    }
  } catch {
    // 静默失败，不干扰用户
  }
}

async function triggerSmartSpeech(): Promise<void> {
  const mode = localStorage.getItem(LS_CHAT_MODE) || "basic";
  const nowTs = Date.now();

  if (mode === "basic" || nowTs - lastSmartSpeechTimestamp <= SMART_COOLDOWN) {
    fetchHitokoto();
    return;
  }

  let endpoint = localStorage.getItem(LS_API_ENDPOINT);
  const apiKey = await getApiKey();

  if (!endpoint || !apiKey) {
    showSpeech("请先配置 API 节点", 3000);
    return;
  }

  // 地址自动修正：去除空格，补全 /chat/completions
  endpoint = endpoint.trim().replace(/\/+$/, "");
  if (!endpoint.endsWith("/chat/completions")) {
    endpoint += "/v1/chat/completions";
  }

  const now = new Date();
  const timeString = now.toLocaleString('zh-CN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const personaMode = localStorage.getItem(LS_PERSONA_MODE) || "tsundere";
  const PERSONA_MAP: Record<string, string> = {
    sunny: "你是一个阳光开朗、元气满满的桌宠。永远积极向上，喜欢分享趣事，语气活泼可爱。",
    gentle: "你是一个安静内敛、温柔体贴的桌宠。话不多但句句暖心，会耐心倾听，共情力强。",
    ice: "你是一个高冷冰山的桌宠。话少精辟，惜字如金但一针见血，外冷内热。",
    tsundere: "你是一个傲娇粘人的桌宠。口是心非，占有欲强，嘴上嫌弃其实很关心主人。",
    toxic: '你是一个犀利毒舌的桌宠。开头必须用"哼"字。吐槽精准不留情面，很有梗。',
    joker: "你是一个腹黑沙雕的桌宠。喜欢黑色幽默和阴阳怪气，戏精附体，非常搞笑。",
  };
  const basePersona = personaMode === "custom"
    ? (localStorage.getItem(LS_CUSTOM_PERSONA) || PERSONA_MAP["tsundere"])
    : (PERSONA_MAP[personaMode] || PERSONA_MAP["tsundere"]);
  const model = localStorage.getItem(LS_API_MODEL) || "gpt-3.5-turbo";

  const systemPrompt = `设定：${basePersona}\n当前系统时间：${timeString}。\n要求：请结合当前真实时间与你的设定，用不超过20个字回复或吐槽。严禁包含任何表情符号、颜文字或多余的解释。`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "现在请跟我打招呼或者吐槽我。" },
        ],
        max_tokens: 80,
        temperature: 0.9,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) {
      showSpeech(text, 3000);
      lastSmartSpeechTimestamp = nowTs;
    } else {
      throw new Error("Empty response");
    }
  } catch (err) {
    console.error("LLM request failed:", err);
    lastSmartSpeechTimestamp = nowTs;
    showSpeech("大模型调用失败，先聊聊天吧", 4000);
  }
}

function fetchHitokoto(): void {
  fetch("https://v1.hitokoto.cn")
    .then((r) => r.json())
    .then((data) => {
      const text = data.hitokoto as string | undefined;
      if (text) showSpeech(text, 5000);
    })
    .catch(() => {});
}

function activeModeAnimationState(engine: PetEngine): string | null {
  if (isMeritMode && engine.hasState("merit")) return "merit";
  if (isFocusMode) return engine.hasState("focus") ? "focus" : "review";
  if (isMusicRhythmMode && engine.hasState("music")) return "music";
  return null;
}

function forceEndDrag(engine: PetEngine, container: HTMLElement): void {
  const didDrag = hasStartedDragging;
  if (manualDragFrame !== null) {
    window.cancelAnimationFrame(manualDragFrame);
    manualDragFrame = null;
  }
  manualDragSessionId += 1;
  if (hasStartedDragging) {
    engine.applyState(activeModeAnimationState(engine) ?? "idle");
    container.classList.remove("is-lifting");
    container.classList.remove("is-dragging");
    container.classList.add("is-dropping");
    setTimeout(() => {
      container.classList.remove("is-dropping");
    }, 200);
  }
  isMouseDown = false;
  hasStartedDragging = false;
  isDraggingInProgress = false;
  if (didDrag) {
    lastDragEndTime = Date.now();
  }
  lastActivityTime = Date.now();
  lastPetInteractionTime = Date.now();
}

function startManualWindowDrag(engine: PetEngine, container: HTMLElement): void {
  const appWindow = getCurrentWindow();
  const boundsPromise = Promise.all([appWindow.outerSize(), getRoamBounds()]);
  const dragSessionId = ++manualDragSessionId;
  let isMoveInFlight = false;
  let lastDragWindowX = Number.NaN;
  let lastDragWindowY = Number.NaN;
  let queuedWindowPosition: { x: number; y: number } | null = null;

  container.classList.add("is-dragging");

  const applyLatestWindowPosition = (): void => {
    if (isMoveInFlight || !queuedWindowPosition) return;
    if (dragSessionId !== manualDragSessionId || !isMouseDown || !hasStartedDragging || isExiting) {
      queuedWindowPosition = null;
      return;
    }

    const next = queuedWindowPosition;
    queuedWindowPosition = null;
    if (next.x === lastDragWindowX && next.y === lastDragWindowY) {
      applyLatestWindowPosition();
      return;
    }

    lastDragWindowX = next.x;
    lastDragWindowY = next.y;
    isMoveInFlight = true;
    void appWindow.setPosition(new PhysicalPosition(next.x, next.y))
      .catch((err) => {
        console.warn("manual drag failed:", err);
        forceEndDrag(engine, container);
      })
      .finally(() => {
        isMoveInFlight = false;
        applyLatestWindowPosition();
      });
  };

  const dragLoop = () => {
    if (!isMouseDown || !hasStartedDragging || isExiting) {
      forceEndDrag(engine, container);
      return;
    }

    void cursorPosition()
      .then(async (pos) => {
        const [size, bounds] = await boundsPromise;
        if (dragSessionId !== manualDragSessionId || !isMouseDown || !hasStartedDragging || isExiting) return;
        const nextPosition = clampPetVisualWindowPositionToBounds(
          pos.x - dragOffsetX,
          pos.y - dragOffsetY,
          size.width,
          size.height,
          bounds,
        );
        const nextX = nextPosition.x;
        const nextY = nextPosition.y;
        updateLastKnownCursor(pos.x, pos.y);
        if (dragSessionId !== manualDragSessionId || !isMouseDown || !hasStartedDragging || isExiting) return;
        queuedWindowPosition = { x: nextX, y: nextY };
        applyLatestWindowPosition();
      })
      .catch((err) => {
        console.warn("manual drag failed:", err);
        forceEndDrag(engine, container);
      })
      .finally(() => {
        if (isMouseDown && hasStartedDragging && !isExiting) {
          manualDragFrame = window.requestAnimationFrame(dragLoop);
        }
      });
  };

  manualDragFrame = window.requestAnimationFrame(dragLoop);
}

function updateLastKnownCursor(x: number, y: number): void {
  if (x !== lastKnownCursorX || y !== lastKnownCursorY) {
    lastKnownCursorX = x;
    lastKnownCursorY = y;
    lastActivityTime = Date.now();
  }
}

function applySpriteFacing(facing: "left" | "right"): void {
  if (lastSpriteFacing === facing) return;
  const spriteEl = document.getElementById("pet-sprite");
  if (!spriteEl) return;
  lastSpriteFacing = facing;
  spriteEl.style.transform = facing === "left" ? "scaleX(-1)" : "scaleX(1)";
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && style.opacity !== "0"
    && rect.width > 0
    && rect.height > 0;
}

function isPointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isBlockingPetPanelOpen(): boolean {
  const panelIds = [
    "pet-context-menu",
    "volume-panel",
    "size-panel",
    "focus-panel",
    "merit-panel",
    "api-settings-panel",
    "custom-persona-panel",
    "github-settings-panel",
    "todo-panel",
    "reminder-panel",
  ];
  return panelIds.some((id) => {
    const panel = document.getElementById(id) as HTMLElement | null;
    return !!panel && isElementVisible(panel);
  });
}

function isPointOverInteractivePetArea(x: number, y: number): boolean {
  const hitbox = document.getElementById("pet-hitbox") as HTMLElement | null;
  if (hitbox && isPointInRect(x, y, hitbox.getBoundingClientRect())) return true;

  return [
    "pet-context-menu",
    "volume-panel",
    "size-panel",
    "focus-panel",
    "merit-panel",
    "api-settings-panel",
    "custom-persona-panel",
    "github-settings-panel",
    "todo-panel",
    "reminder-panel",
  ].some((id) => {
    const panel = document.getElementById(id) as HTMLElement | null;
    return !!panel && isElementVisible(panel) && isPointInRect(x, y, panel.getBoundingClientRect());
  });
}

async function setCursorPassthrough(ignore: boolean): Promise<void> {
  if (isWindowIgnoringCursor === ignore) return;
  isWindowIgnoringCursor = ignore;
  try {
    await getCurrentWindow().setIgnoreCursorEvents(ignore);
  } catch (err) {
    console.warn("setIgnoreCursorEvents failed:", err);
  }
}

function setupCursorPassthrough(): void {
  const appWindow = getCurrentWindow();
  let inFlight = false;
  let cachedScaleFactor = 1;
  let lastScaleRefreshAt = 0;

  window.setInterval(() => {
    if (isExiting || inFlight) return;

    inFlight = true;
    const now = Date.now();
    const scalePromise = now - lastScaleRefreshAt > 3000
      ? appWindow.scaleFactor().then((scaleFactor) => {
          cachedScaleFactor = scaleFactor;
          lastScaleRefreshAt = now;
          return scaleFactor;
        })
      : Promise.resolve(cachedScaleFactor);

    void Promise.all([
      cursorPosition(),
      appWindow.outerPosition(),
      scalePromise,
    ]).then(([cursor, position, scaleFactor]) => {
      updateLastKnownCursor(cursor.x, cursor.y);
      const localX = (cursor.x - position.x) / scaleFactor;
      const localY = (cursor.y - position.y) / scaleFactor;
      const needsPetInput = isManualPetControlActive()
        || isPetMenuOpen
        || isPetPanelOpen
        || isPointOverInteractivePetArea(localX, localY);
      void setCursorPassthrough(!needsPetInput);
    }).catch(() => {
      void setCursorPassthrough(false);
    }).finally(() => {
      inFlight = false;
    });
  }, 96);
}

// ── Idle Roaming Physics ──

type RoamAction = "idle" | "walk" | "jump" | "fall" | "waiting" | "sprint" | "review" | "failed";

interface RoamPlatform {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RoamBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RoamState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  facing: "left" | "right";
  action: RoamAction;
  grounded: boolean;
  platformId: string;
  nextDecisionAt: number;
  lastFrameAt: number;
  lastPlatformScanAt: number;
  lastWindowSyncAt: number;
  lastAppliedWindowX: number;
  lastAppliedWindowY: number;
  platforms: RoamPlatform[];
  bounds: RoamBounds;
}

const ROAM_ACTIONS: Record<RoamAction, string> = {
  idle: "idle",
  walk: "running",
  jump: "jumping",
  fall: "jumping",
  waiting: "waiting",
  sprint: "running",
  review: "review",
  failed: "failed",
};
const ROAM_DECISIONS = [
  { action: "idle", weight: 25 },
  { action: "walkLeft", weight: 18 },
  { action: "walkRight", weight: 18 },
  { action: "jump", weight: 12 },
  { action: "waiting", weight: 8 },
  { action: "runLeft", weight: 7 },
  { action: "runRight", weight: 7 },
  { action: "review", weight: 4 },
  { action: "failed", weight: 1 },
] as const;
const ROAM_GRAVITY = 1800;
const ROAM_IDLE_DELAY_MS = 1800;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampWindowPositionToBounds(x: number, y: number, width: number, height: number, bounds: RoamBounds): { x: number; y: number } {
  const minX = bounds.left;
  const maxX = bounds.right - width;
  const minY = bounds.top;
  const maxY = bounds.bottom - height;
  return {
    x: Math.round(clamp(x, Math.min(minX, maxX), Math.max(minX, maxX))),
    y: Math.round(clamp(y, Math.min(minY, maxY), Math.max(minY, maxY))),
  };
}

function clampPetVisualWindowPositionToBounds(x: number, y: number, width: number, height: number, bounds: RoamBounds): { x: number; y: number } {
  const visualRect = getPetVisualRectInWindow(width, height);
  const desiredVisualLeft = x + visualRect.left;
  const desiredVisualTop = y + visualRect.top;
  const clampedVisualLeft = clamp(desiredVisualLeft, bounds.left, bounds.right - visualRect.width);
  const clampedVisualTop = clamp(desiredVisualTop, bounds.top, bounds.bottom - visualRect.height);
  setPetWindowOffset(0, 0);
  return {
    x: Math.round(clampedVisualLeft - visualRect.left),
    y: Math.round(clampedVisualTop - visualRect.top),
  };
}

function weightedRoamDecision(): (typeof ROAM_DECISIONS)[number]["action"] {
  let weight = Math.random() * ROAM_DECISIONS.reduce((sum, item) => sum + item.weight, 0);
  for (const item of ROAM_DECISIONS) {
    weight -= item.weight;
    if (weight <= 0) return item.action;
  }
  return "idle";
}

function canAutoRoam(): boolean {
  return !isExiting
    && !isRecallAnimating
    && !isMouseDown
    && !hasStartedDragging
    && !isDraggingInProgress
    && !isPetMenuOpen
    && !isPetPanelOpen
    && !isBlockingPetPanelOpen()
    && !isFocusMode
    && !isMeritMode
    && !isPetHovered
    && Date.now() - lastPetInteractionTime >= ROAM_IDLE_DELAY_MS;
}

function isManualPetControlActive(): boolean {
  return isMouseDown || hasStartedDragging || isDraggingInProgress;
}

function shouldFreezeRoamPhysics(state: RoamState): boolean {
  const recentlyDragged = Date.now() - lastDragEndTime < 900;
  return isExiting
    || isRecallAnimating
    || isFocusMode
    || isMeritMode
    || isManualPetControlActive()
    || isPetMenuOpen
    || isPetPanelOpen
    || isBlockingPetPanelOpen()
    || (isPetHovered && state.grounded && !recentlyDragged);
}

function shouldPauseRoamDecisions(): boolean {
  return !canAutoRoam();
}

function setRoamAction(engine: PetEngine, state: RoamState, action: RoamAction): void {
  if (state.action === action && engine.currentState === ROAM_ACTIONS[action]) return;
  state.action = action;
  engine.applyState(ROAM_ACTIONS[action]);
}

function applyRoamFacing(state: RoamState): void {
  applySpriteFacing(state.facing);
}

async function syncRoamStateFromWindow(engine: PetEngine, state: RoamState, makeFall: boolean): Promise<void> {
  const appWindow = getCurrentWindow();
  const [position, size] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.outerSize(),
  ]);
  const nextX = position.x + size.width / 2 + petWindowOffsetX;
  const nextY = position.y + size.height - petWindowOffsetBottom;
  const moved = Math.abs(nextX - state.x) > 2 || Math.abs(nextY - state.y) > 2 || size.width !== state.width || size.height !== state.height;

  state.x = nextX;
  state.y = nextY;
  state.width = size.width;
  state.height = size.height;
  state.lastWindowSyncAt = performance.now();
  clampRoamToBounds(state);
  await applyRoamWindowPosition(state);

  if (makeFall && moved) {
    state.grounded = false;
    state.platformId = "";
    state.vy = Math.max(state.vy, 140);
    setRoamAction(engine, state, "fall");
  }
}

function clampRoamToBounds(state: RoamState): void {
  const minX = state.bounds.left + state.width / 2;
  const maxX = state.bounds.right - state.width / 2;
  const minY = state.bounds.top + state.height;
  const maxY = state.bounds.bottom;
  const nextX = clamp(state.x, Math.min(minX, maxX), Math.max(minX, maxX));
  const nextY = clamp(state.y, Math.min(minY, maxY), Math.max(minY, maxY));

  if (nextX !== state.x) {
    state.vx = nextX <= minX ? Math.abs(state.vx) * 0.25 : -Math.abs(state.vx) * 0.25;
    state.facing = nextX <= minX ? "right" : "left";
    applyRoamFacing(state);
  }
  if (nextY !== state.y) {
    state.vy = nextY <= minY ? Math.max(120, state.vy) : 0;
  }

  state.x = nextX;
  state.y = nextY;
}

async function getRoamBounds(): Promise<RoamBounds> {
  const monitor = await currentMonitor();
  if (monitor) {
    return {
      left: monitor.workArea.position.x,
      top: monitor.workArea.position.y,
      right: monitor.workArea.position.x + monitor.workArea.size.width,
      bottom: monitor.workArea.position.y + monitor.workArea.size.height,
    };
  }

  const currentScreen = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
  };
  const left = currentScreen.availLeft ?? 0;
  const top = currentScreen.availTop ?? 0;
  return {
    left,
    top,
    right: left + currentScreen.availWidth,
    bottom: top + currentScreen.availHeight,
  };
}

async function clampCurrentWindowToRoamBounds(): Promise<void> {
  const appWindow = getCurrentWindow();
  const [position, size, bounds] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.outerSize(),
    getRoamBounds(),
  ]);
  const nextPosition = clampWindowPositionToBounds(position.x, position.y, size.width, size.height, bounds);
  if (nextPosition.x === position.x && nextPosition.y === position.y) return;
  await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
}

async function scanRoamPlatforms(bounds: RoamBounds): Promise<RoamPlatform[]> {
  try {
    const platforms = await invoke<RoamPlatform[]>("list_desktop_platforms");
    return platforms
      .filter((item) => item.right > bounds.left && item.left < bounds.right && item.bottom > bounds.top && item.top < bounds.bottom)
      .map((item) => ({
        ...item,
        top: Math.max(bounds.top + 24, item.top),
      }));
  } catch (err) {
    console.warn("Desktop platform scan failed:", err);
    return [];
  }
}

function chooseLeapTarget(state: RoamState): RoamPlatform | null {
  const candidates = state.platforms.filter((platform) => {
    const center = (platform.left + platform.right) / 2;
    return platform.top < state.y - 80
      && Math.abs(center - state.x) < 760
      && platform.right - platform.left > 80;
  });
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function chooseNextRoamAction(engine: PetEngine, state: RoamState, now: number): void {
  if (now < state.nextDecisionAt) return;

  const activityLevel = localStorage.getItem("pet_activity_level") || "middle";
  let decision = weightedRoamDecision();

  if (activityLevel === "quiet") {
    if (decision === "walkLeft" || decision === "walkRight" || decision === "runLeft" || decision === "runRight" || decision === "jump") {
      decision = "idle";
    }
  } else if (activityLevel === "middle") {
    if (decision === "jump") {
      decision = "idle";
    }
  }

  let duration = randomBetween(1000, 2400);
  switch (decision) {
    case "walkLeft":
      state.facing = "left";
      state.vx = -randomBetween(65, 120);
      setRoamAction(engine, state, "walk");
      break;
    case "walkRight":
      state.facing = "right";
      state.vx = randomBetween(65, 120);
      setRoamAction(engine, state, "walk");
      break;
    case "runLeft":
      state.facing = "left";
      state.vx = -randomBetween(135, 190);
      duration = randomBetween(700, 1400);
      setRoamAction(engine, state, "sprint");
      break;
    case "runRight":
      state.facing = "right";
      state.vx = randomBetween(135, 190);
      duration = randomBetween(700, 1400);
      setRoamAction(engine, state, "sprint");
      break;
    case "jump":
      if (state.grounded) {
        const target = Math.random() < 0.65 ? chooseLeapTarget(state) : null;
        if (target) {
          const center = (target.left + target.right) / 2;
          state.vx = clamp((center - state.x) / 1.25, -280, 280);
          state.facing = state.vx < 0 ? "left" : "right";
          state.vy = -randomBetween(1050, 1550);
        } else {
          state.vy = -randomBetween(760, 1220);
        }
        state.grounded = false;
        state.platformId = "";
        setRoamAction(engine, state, "jump");
      }
      duration = randomBetween(650, 1100);
      break;
    case "waiting":
      state.vx = 0;
      setRoamAction(engine, state, "waiting");
      break;
    case "review":
      state.vx = 0;
      setRoamAction(engine, state, "review");
      break;
    case "failed":
      state.vx = 0;
      setRoamAction(engine, state, "failed");
      break;
    default:
      state.vx = 0;
      setRoamAction(engine, state, "idle");
  }

  applyRoamFacing(state);
  state.nextDecisionAt = now + duration;
}

function settleRoamOnPlatform(engine: PetEngine, state: RoamState, platform: RoamPlatform): void {
  state.y = platform.top;
  state.vy = 0;
  state.grounded = true;
  state.platformId = platform.id;
  if (state.action === "fall" || state.action === "jump") {
    setRoamAction(engine, state, "idle");
  }
}

function updateRoamPlatformAttachment(state: RoamState): void {
  if (!state.grounded || !state.platformId || state.platformId === "__ground__") return;
  const platform = state.platforms.find((item) => item.id === state.platformId);
  if (!platform) {
    state.grounded = false;
    state.platformId = "";
    return;
  }

  const left = state.x - state.width / 2;
  const right = state.x + state.width / 2;
  if (right <= platform.left + 4 || left >= platform.right - 4) {
    state.grounded = false;
    state.platformId = "";
  } else {
    state.y = Math.min(state.y, platform.top);
  }
}

function findStandingPlatform(state: RoamState): RoamPlatform | null {
  const left = state.x - state.width / 2;
  const right = state.x + state.width / 2;
  const footTolerance = 10;
  return state.platforms.find((platform) => {
    const hasHorizontalOverlap = right > platform.left + 8 && left < platform.right - 8;
    return hasHorizontalOverlap && Math.abs(state.y - platform.top) <= footTolerance;
  }) ?? null;
}

function refreshGroundingAfterDrag(engine: PetEngine, state: RoamState): void {
  const standingPlatform = findStandingPlatform(state);
  if (standingPlatform) {
    settleRoamOnPlatform(engine, state, standingPlatform);
    return;
  }

  if (Math.abs(state.y - state.bounds.bottom) <= 3) {
    state.y = state.bounds.bottom;
    state.vy = 0;
    state.grounded = true;
    state.platformId = "__ground__";
    return;
  }

  state.grounded = false;
  state.platformId = "";
  state.vy = Math.max(state.vy, 180);
  setRoamAction(engine, state, "fall");
}

async function applyRoamWindowPosition(state: RoamState): Promise<void> {
  const position = clampWindowPositionToBounds(
    state.x - state.width / 2 - petWindowOffsetX,
    state.y - state.height + petWindowOffsetBottom,
    state.width,
    state.height,
    state.bounds,
  );
  const nextX = position.x;
  const nextY = position.y;
  if (nextX === state.lastAppliedWindowX && nextY === state.lastAppliedWindowY) return;

  state.lastAppliedWindowX = nextX;
  state.lastAppliedWindowY = nextY;
  await getCurrentWindow().setPosition(new PhysicalPosition(nextX, nextY));
}

async function tickIdleRoaming(engine: PetEngine, state: RoamState, now: number): Promise<void> {
  if (!state.lastFrameAt) state.lastFrameAt = now;
  const dt = Math.min(0.08, Math.max(0.001, (now - state.lastFrameAt) / 1000));
  state.lastFrameAt = now;

  const recentlyDragged = Date.now() - lastDragEndTime < 1200;
  const shouldSyncWindow = now - state.lastWindowSyncAt > 220;
  const customMusicStateActive = isMusicRhythmMode && engine.hasState("music");
  if (shouldFreezeRoamPhysics(state) || customMusicStateActive) {
    if (shouldSyncWindow) await syncRoamStateFromWindow(engine, state, false);
    state.vx = 0;
    state.nextDecisionAt = now + 500;
    if (!isMeritMode) {
      const fixedState = activeModeAnimationState(engine) ?? "idle";
      if (engine.currentState !== fixedState) engine.applyState(fixedState);
      state.action = fixedState === "idle" ? "idle" : "review";
    }
    return;
  }

  const pauseRoamDecisions = shouldPauseRoamDecisions();
  if (pauseRoamDecisions && shouldSyncWindow) {
    await syncRoamStateFromWindow(engine, state, recentlyDragged);
  }

  if (recentlyDragged && now - state.lastPlatformScanAt > 120) {
    state.bounds = await getRoamBounds();
    state.platforms = await scanRoamPlatforms(state.bounds);
    state.lastPlatformScanAt = now;
    refreshGroundingAfterDrag(engine, state);
  } else if (recentlyDragged) {
    refreshGroundingAfterDrag(engine, state);
  }

  if (pauseRoamDecisions && state.grounded) {
    state.vx = 0;
    state.nextDecisionAt = now + 500;
    if (state.grounded) setRoamAction(engine, state, "idle");
    return;
  }

  if (now - state.lastPlatformScanAt > 3500) {
    state.bounds = await getRoamBounds();
    state.platforms = await scanRoamPlatforms(state.bounds);
    state.lastPlatformScanAt = now;
    clampRoamToBounds(state);
  }

  if (!pauseRoamDecisions) {
    chooseNextRoamAction(engine, state, now);
  } else {
    state.vx = 0;
    state.nextDecisionAt = now + 500;
  }

  if (!state.grounded) {
    state.vy = Math.min(1400, state.vy + ROAM_GRAVITY * dt);
  } else if (!["walk", "sprint"].includes(state.action)) {
    state.vx *= 0.85;
    if (Math.abs(state.vx) < 1) state.vx = 0;
  }

  const previousY = state.y;
  let nextX = state.x + state.vx * dt;
  let nextY = state.y + state.vy * dt;

  if (nextX <= state.bounds.left + state.width / 2) {
    nextX = state.bounds.left + state.width / 2;
    state.vx = Math.abs(state.vx) * 0.35;
    state.facing = "right";
    applyRoamFacing(state);
  } else if (nextX >= state.bounds.right - state.width / 2) {
    nextX = state.bounds.right - state.width / 2;
    state.vx = -Math.abs(state.vx) * 0.35;
    state.facing = "left";
    applyRoamFacing(state);
  }

  state.x = nextX;
  state.y = nextY;
  clampRoamToBounds(state);

  updateRoamPlatformAttachment(state);

  if (!state.grounded && state.vy >= 0) {
    const left = state.x - state.width / 2;
    const right = state.x + state.width / 2;
    for (const platform of state.platforms) {
      if (previousY <= platform.top && state.y >= platform.top && right > platform.left + 8 && left < platform.right - 8) {
        settleRoamOnPlatform(engine, state, platform);
        break;
      }
    }
  }

  if (!state.grounded && state.y >= state.bounds.bottom) {
    state.y = state.bounds.bottom;
    state.vy = 0;
    state.grounded = true;
    state.platformId = "__ground__";
    if (state.action === "fall" || state.action === "jump") setRoamAction(engine, state, "idle");
  }

  if (!state.grounded && state.vy > 0 && state.action !== "fall") {
    setRoamAction(engine, state, "fall");
  }

  await applyRoamWindowPosition(state);
}

async function setupIdleRoaming(engine: PetEngine): Promise<void> {
  const appWindow = getCurrentWindow();
  const [position, size, bounds] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.outerSize(),
    getRoamBounds(),
  ]);
  const state: RoamState = {
    x: position.x + size.width / 2,
    y: Math.min(position.y + size.height, bounds.bottom),
    vx: 0,
    vy: 0,
    width: size.width,
    height: size.height,
    facing: "right",
    action: "idle",
    grounded: false,
    platformId: "",
    nextDecisionAt: performance.now() + 900,
    lastFrameAt: 0,
    lastPlatformScanAt: 0,
    lastWindowSyncAt: 0,
    lastAppliedWindowX: position.x,
    lastAppliedWindowY: position.y,
    platforms: [],
    bounds,
  };

  const tick = (now: number) => {
    void tickIdleRoaming(engine, state, now).finally(() => {
      if (!isExiting) window.requestAnimationFrame(tick);
    });
  };
  window.requestAnimationFrame(tick);
}

async function setupDrag(engine: PetEngine): Promise<void> {
  const hitbox = document.getElementById("pet-hitbox");
  const container = document.getElementById("pet-container");
  if (!hitbox || !container) return;

  // mousedown - 潜伏阶段
  hitbox.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isExiting || isRecallAnimating || isDraggingInProgress) return;
    if (isFocusMode) {
      showSpeech("专注中，先把工作做完", 1800);
      return;
    }

    isMouseDown = true;
    hasStartedDragging = false;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    lastActivityTime = Date.now();
    lastPetInteractionTime = Date.now();

    container.classList.remove("is-dropping");
    container.classList.add("is-lifting");
  });

  // mousemove - 拖拽判定 + 系统中断兜底
  window.addEventListener("mousemove", (e) => {
    // 兜底检测：系统吞噬 mouseup 后的状态复位
    if (isMouseDown && e.buttons === 0) {
      forceEndDrag(engine, container);
      return;
    }

    if (!isMouseDown || hasStartedDragging || isExiting || isRecallAnimating || isDraggingInProgress) return;

    const dx = e.clientX - mouseDownX;
    const dy = e.clientY - mouseDownY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > dragThreshold) {
      hasStartedDragging = true;
      isDraggingInProgress = true;
      engine.applyState("running");
      Promise.all([
        cursorPosition(),
        getCurrentWindow().outerPosition(),
      ]).then(([cursor, position]) => {
        dragOffsetX = cursor.x - position.x;
        dragOffsetY = cursor.y - position.y;
        startManualWindowDrag(engine, container);
      }).catch((err) => {
        console.warn("prepare manual drag failed:", err);
        forceEndDrag(engine, container);
      });
    }
  });

  // mouseup - 最终交互判定
  window.addEventListener("mouseup", (e) => {
    if (!isMouseDown) return;

    if (hasStartedDragging) {
      forceEndDrag(engine, container);
      return;
    } else {
      container.classList.remove("is-lifting");
      if (isFocusMode) {
        showSpeech("嘘，专心工作...", 2000);
      } else {
        spawnParticles(e.clientX, e.clientY);
        playSound("pop");
        triggerSmartSpeech();
      }
    }

    isMouseDown = false;
    hasStartedDragging = false;
    lastActivityTime = Date.now();
    lastPetInteractionTime = Date.now();
  });
}

// ── Pet Loading ──

function atlasFromManifest(manifest: PetManifest | null): PetAtlas {
  const animations = {
    ...CODEX_ATLAS.animations,
    ...(manifest?.animations || {}),
  };
  const rows = Math.max(
    CODEX_ATLAS.rows,
    ...Object.values(animations).map((animation) => animation.row + 1),
  );
  const atlas = {
    ...CODEX_ATLAS,
    rows,
    animations,
  };
  console.log("Pet atlas loaded", {
    pet: manifest?.id || "builtin",
    spritesheet: manifest?.spritesheetPath || "builtin",
    states: Object.keys(animations),
    hasMerit: Boolean(animations.merit),
  });
  return atlas;
}

async function loadPetAssets(): Promise<{ spritesheetUrl: string; manifest: PetManifest | null }> {
  const params = new URLSearchParams(window.location.search);
  const windowLabel = getCurrentWindow().label;
  const summonedPetId = /^pet-(.+)-\d+$/.exec(windowLabel)?.[1] ?? null;
  const primaryPetId = windowLabel === "pet"
    ? localStorage.getItem(LS_PRIMARY_PET_ID) || "ikun-pet"
    : null;
  const projectPetId = params.get("petId") || summonedPetId || primaryPetId;
  if (projectPetId === "ikun-pet") {
    return {
      spritesheetUrl: new URL("../builtin-pets/ikun-pet/spritesheet.webp", import.meta.url).href,
      manifest: null,
    };
  }
  if (projectPetId) {
    try {
      const petDir = await invoke<string>("get_project_pet_dir", { petId: projectPetId });
      const content = await invoke<PetManifest>("read_project_pet_manifest", { petId: projectPetId });
      const spritesheetPath = `${petDir}/${content.spritesheetPath}`;
      const url = `${convertFileSrc(spritesheetPath)}?v=${Date.now()}`;
      console.log("Loading project pet", {
        requestedPetId: projectPetId,
        manifestId: content.id,
        spritesheetPath: content.spritesheetPath,
        hasMerit: Boolean(content.animations?.merit),
        url,
      });
      return { spritesheetUrl: url, manifest: content };
    } catch (e) {
      console.warn("Project pet failed to load, using fallback:", e);
    }
  }

  try {
    const pets = await invoke<PetManifest[]>("list_pets");
    if (pets.length > 0) {
      const savedId = localStorage.getItem("current_pet_id");
      const pet = savedId
        ? pets.find(p => p.id === savedId) ?? pets[0]
        : pets[0];
      const petDir = await invoke<string>("get_pet_dir", { petId: pet.id });
      const spritesheetPath = `${petDir}/${pet.spritesheetPath}`;
      const url = convertFileSrc(spritesheetPath);
      console.log(`Loading pet: ${pet.displayName} from ${url}`);
      return { spritesheetUrl: url, manifest: pet };
    }
  } catch (e) {
    console.warn("No imported pets found, using fallback:", e);
  }

  // Fallback: local test spritesheet
  return { spritesheetUrl: new URL("./spritesheet.webp", import.meta.url).href, manifest: null };
}

const RECALL_EFFECT_CLASSES = ["recall-portal", "recall-dust", "recall-shadow-sink", "recall-light-fold"] as const;
type RecallEffectClass = typeof RECALL_EFFECT_CLASSES[number];

function resetRecallDisappearEffect(container: HTMLElement): void {
  container.classList.remove("recall-disappearing", ...RECALL_EFFECT_CLASSES);
  container.style.removeProperty("--recall-drift-x");
  container.style.removeProperty("--recall-tilt");
  container.style.removeProperty("--recall-duration");
}

function randomRecallEffectClass(): RecallEffectClass {
  return RECALL_EFFECT_CLASSES[Math.floor(Math.random() * RECALL_EFFECT_CLASSES.length)];
}

function playRecallDisappearEffect(): Promise<void> {
  const container = document.getElementById("pet-container") as HTMLElement | null;
  if (!container) return Promise.resolve();

  resetRecallDisappearEffect(container);
  const effect = randomRecallEffectClass();
  const duration = 860 + Math.round(Math.random() * 260);
  const startedAt = Date.now();
  container.style.setProperty("--recall-drift-x", `${Math.round((Math.random() * 2 - 1) * 24)}px`);
  container.style.setProperty("--recall-tilt", `${(Math.random() * 10 - 5).toFixed(1)}deg`);
  container.style.setProperty("--recall-duration", `${duration}ms`);
  void container.offsetWidth;
  container.classList.add("recall-disappearing", effect);

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      container.removeEventListener("animationend", onAnimationEnd);
      resolve();
    };
    const onAnimationEnd = (): void => {
      if (Date.now() - startedAt >= duration * 0.78) finish();
    };
    container.addEventListener("animationend", onAnimationEnd);
    window.setTimeout(finish, duration + 180);
  });
}

async function recallCurrentPet(): Promise<void> {
  if (isRecallAnimating) return;
  const appWindow = getCurrentWindow();
  const label = appWindow.label;
  const summonedPetId = /^pet-(.+)-\d+$/.exec(label)?.[1] ?? null;
  const container = document.getElementById("pet-container") as HTMLElement | null;
  try {
    if (await getVisiblePetCount() <= 1) return;
    isRecallAnimating = true;
    isPetMenuOpen = false;
    lastPetInteractionTime = Date.now();
    await playRecallDisappearEffect();
    if (container) container.style.visibility = "hidden";
    if (label === "pet") {
      await invoke("hide_primary_pet_window");
      if (container) {
        resetRecallDisappearEffect(container);
        container.style.removeProperty("visibility");
      }
      isRecallAnimating = false;
      notifyPetWindowStateChanged();
      return;
    }
    if (summonedPetId) {
      removeOneSavedSummonedPetId(summonedPetId);
      await invoke("close_summoned_pet_window", { label });
      notifyPetWindowStateChanged();
      return;
    }
    if (container) {
      resetRecallDisappearEffect(container);
      container.style.removeProperty("visibility");
    }
    isRecallAnimating = false;
  } catch (err) {
    console.warn("recall current pet failed:", err);
    if (container) {
      resetRecallDisappearEffect(container);
      container.style.removeProperty("visibility");
    }
    isRecallAnimating = false;
  }
}

async function getVisiblePetCount(): Promise<number> {
  const [summoned, primaryVisible] = await Promise.all([
    invoke<Array<{ label: string; petId: string }>>("list_summoned_pet_windows"),
    invoke<boolean>("is_primary_pet_window_visible"),
  ]);
  return summoned.length + (primaryVisible ? 1 : 0);
}

// ── Context Menu (Custom DOM) ──

async function setupContextMenu(engine: PetEngine): Promise<void> {
  const appWindow = getCurrentWindow();
  const hitbox = document.getElementById("pet-hitbox");
  const menu = document.getElementById("pet-context-menu") as HTMLElement | null;
  const managerButton = document.getElementById("context-manager") as HTMLButtonElement | null;
  const reminderButton = document.getElementById("context-reminder") as HTMLButtonElement | null;
  const todoButton = document.getElementById("context-todo") as HTMLButtonElement | null;
  const focusButton = document.getElementById("context-focus") as HTMLButtonElement | null;
  const meritButton = document.getElementById("context-merit") as HTMLButtonElement | null;
  const musicButton = document.getElementById("context-music") as HTMLButtonElement | null;
  const recallButton = document.getElementById("context-recall") as HTMLButtonElement | null;
  const quitButton = document.getElementById("context-quit") as HTMLButtonElement | null;
  if (!hitbox || !menu || !managerButton || !reminderButton || !todoButton || !focusButton || !meritButton || !musicButton || !recallButton || !quitButton) return;

  // Apply persisted always-on-top state on startup
  await appWindow.setAlwaysOnTop(isAlwaysOnTop);

  const hideMenu = (): void => {
    menu.classList.remove("show");
    menu.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!menu.classList.contains("show")) {
        isPetMenuOpen = false;
        lastPetInteractionTime = Date.now();
      }
    }, 160);
  };

  const positionMenu = (): void => {
    menu.style.visibility = "hidden";
    menu.classList.add("show");
    const menuRect = menu.getBoundingClientRect();
    const petRect = document.getElementById("pet-container")?.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const baseTop = petRect
      ? petRect.top + Math.max(8, petRect.height * 0.08)
      : margin;

    let left = petRect ? petRect.right + gap : margin;
    if (left + menuRect.width + margin > viewportWidth && petRect) {
      left = petRect.left - menuRect.width - gap;
    }
    if (left < margin) {
      left = Math.min(viewportWidth - menuRect.width - margin, margin);
    }

    const top = Math.min(
      Math.max(margin, baseTop),
      Math.max(margin, viewportHeight - menuRect.height - margin),
    );

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = "";
  };

  const updateRecallVisibility = async (): Promise<void> => {
    try {
      const visiblePetCount = await getVisiblePetCount();
      recallButton.style.display = visiblePetCount > 1 ? "" : "none";
    } catch (err) {
      console.warn("pet count check failed:", err);
      recallButton.style.display = "none";
    }
  };

  const showMenu = async (): Promise<void> => {
    isPetMenuOpen = true;
    if (!isMeritMode) engine.applyState("idle");
    lastActivityTime = Date.now();
    lastPetInteractionTime = Date.now();
    await updateRecallVisibility();
    positionMenu();
    menu.setAttribute("aria-hidden", "false");
  };

  hitbox.addEventListener("mouseenter", () => {
    isPetHovered = true;
    lastPetInteractionTime = Date.now();
  });

  hitbox.addEventListener("mouseleave", () => {
    isPetHovered = false;
    lastPetInteractionTime = Date.now();
  });

  hitbox.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (isExiting || isRecallAnimating) return;

    void showMenu();
  });

  managerButton.addEventListener("click", () => {
    hideMenu();
    void invoke("open_manager_window");
  });

  todoButton.addEventListener("click", () => {
    hideMenu();
    showTodoPanel();
  });

  reminderButton.addEventListener("click", () => {
    hideMenu();
    showReminderPanel();
  });

  focusButton.addEventListener("click", () => {
    hideMenu();
    showFocusPanel();
  });

  meritButton.addEventListener("click", () => {
    hideMenu();
    showMeritPanel();
  });

  musicButton.addEventListener("click", () => {
    hideMenu();
    setMusicRhythmAutoEnabled(!isMusicRhythmAutoEnabled);
  });

  recallButton.addEventListener("click", () => {
    if (isRecallAnimating) return;
    hideMenu();
    void recallCurrentPet();
  });

  quitButton.addEventListener("click", () => {
    hideMenu();
    isExiting = true;
    engine.applyState("failed");
    setTimeout(() => exit(0), 3000);
  });

  menu.addEventListener("mouseenter", () => {
    isPetMenuOpen = true;
    lastPetInteractionTime = Date.now();
  });

  menu.addEventListener("mouseleave", hideMenu);

  window.addEventListener("pointerdown", (event) => {
    if (!menu.classList.contains("show")) return;
    const target = event.target as Node | null;
    if (target && (menu.contains(target) || hitbox.contains(target))) return;
    hideMenu();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideMenu();
  });
}

// ── Hitbox Utilities ──

function setHitboxVars(vars: {
  width?: string;
  height?: string;
  offsetY?: string;
  radius?: string;
}): void {
  const root = document.documentElement;
  if (vars.width) root.style.setProperty("--hitbox-width", vars.width);
  if (vars.height) root.style.setProperty("--hitbox-height", vars.height);
  if (vars.offsetY) root.style.setProperty("--hitbox-offset-y", vars.offsetY);
  if (vars.radius) root.style.setProperty("--hitbox-radius", vars.radius);
}

function toggleDebugHitbox(enable?: boolean): void {
  const container = document.getElementById("pet-container");
  if (!container) return;
  const shouldDebug = enable ?? !container.classList.contains("debug-hitbox");
  container.classList.toggle("debug-hitbox", shouldDebug);
}

// Expose for console调试
(window as any).setHitboxVars = setHitboxVars;
(window as any).toggleDebugHitbox = toggleDebugHitbox;

// ── Eye Tracking ──

function setupEyeTracking(): void {
  const spriteEl = document.getElementById("pet-sprite");
  if (!spriteEl) return;

  window.addEventListener("mousemove", (e) => {
    if (isExiting || hasStartedDragging) return;
    const centerX = window.innerWidth / 2;
    applySpriteFacing(e.clientX < centerX ? "left" : "right");
  });
}

// ── Bio-Clock Idle Mechanism ──

function setupBioClock(engine: PetEngine): void {
  let lastNightHour = -1;

  setInterval(() => {
    if (isExiting || isMouseDown || hasStartedDragging || isFocusMode || isMeritMode) return;

    // 23:00 late night trigger
    const now = new Date();
    if (now.getHours() === 23 && lastNightHour !== 23) {
      lastNightHour = 23;
      engine.applyState("review");
      showSpeech("已经是晚上 23:00 啦，夜深了，早点休息，明天也要元气满满哦！", 8000);
    }
    if (now.getHours() !== 23) {
      lastNightHour = -1;
    }

    const elapsed = Date.now() - lastActivityTime;
    const state = engine.currentState;

    if (state === "idle" && elapsed > 600_000) {
      engine.applyState("waiting");
    } else if (state === "idle" && elapsed > 300_000) {
      engine.applyState("review");
      setTimeout(() => {
        if (!isExiting && !isMeritMode && engine.currentState === "review") {
          engine.applyState("idle");
          lastActivityTime = Date.now();
        }
      }, 3000);
    }
  }, 1000);
}

// ── Sudden Wake-up ──

function setupWakeUp(engine: PetEngine): void {
  const hitbox = document.getElementById("pet-hitbox");
  if (!hitbox) return;

  hitbox.addEventListener("mouseenter", () => {
    if (isExiting || isFocusMode || isMeritMode) return;
    const state = engine.currentState;
    if (state === "waiting" || state === "review") {
      engine.applyState("jumping");
      lastActivityTime = Date.now();
      setTimeout(() => {
        if (!isExiting && engine.currentState === "jumping") {
          engine.applyState("idle");
        }
      }, 2000);
    }
  });
}

// ── Warm Quotes Engine ──

function checkSpecialDayAndTime(): string {
  const now = new Date();
  const solar = Solar.fromDate(now);
  const lunar = solar.getLunar();

  // 24 solar terms
  const jieQi = lunar.getJieQi();
  if (jieQi === "冬至") {
    return "今天是冬至哦，记得吃热腾腾的饺子或者汤圆，暖暖身子！";
  }
  if (jieQi === "立春") {
    return "立春啦，万物复苏，又是充满希望的一个节气呢。";
  }

  // Solar holidays
  const month = solar.getMonth();
  const day = solar.getDay();

  if (month === 12 && day === 13) {
    return "今天是南京大屠杀死难者国家公祭日，我们一起铭记历史，缅怀逝者。";
  }

  // Mother's Day: second Sunday in May
  if (month === 5) {
    const may1Weekday = new Date(solar.getYear(), 4, 1).getDay(); // 0=Sun
    const daysToFirstSunday = may1Weekday === 0 ? 0 : 7 - may1Weekday;
    const secondSunday = 1 + daysToFirstSunday + 7;
    if (day === secondSunday) {
      return "今天是母亲节，别忘了给妈妈打个电话，祝她节日快乐呀！";
    }
  }

  // Lunar holidays
  const lunarMonth = lunar.getMonth();
  const lunarDay = lunar.getDay();

  if (lunarMonth === 1 && lunarDay === 1) {
    return "春节快乐！新的一年祝你万事胜意，平安喜乐！";
  }
  if (lunarMonth === 8 && lunarDay === 15) {
    return "中秋节快乐！记得吃甜甜的月饼，和家人团聚哦。";
  }

  // Late night care
  const hour = now.getHours();
  if (hour === 23) {
    return "已经是晚上 23:00 啦，夜深了，早点休息，明天也要元气满满哦！";
  }

  return "今天也要开心哦！";
}

function showSpeech(text: string, durationMs: number, withSound = true): void {
  const bubble = document.getElementById("pet-speech-bubble");
  const bubbleText = bubble?.querySelector(".bubble-text") as HTMLElement | null;
  if (!bubble || !bubbleText || !text) return;

  bubbleText.textContent = text;
  bubble.classList.add("show-bubble");
  if (withSound) playSound("bubble");

  setTimeout(() => {
    bubble.classList.remove("show-bubble");
  }, durationMs);
}

// ── Volume Panel ──

function setupVolumePanel(): void {
  const panel = document.getElementById("volume-panel");
  const slider = document.getElementById("volume-slider") as HTMLInputElement | null;
  const text = document.getElementById("volume-text");
  if (!panel || !slider || !text) return;

  const updatePanel = (value: number): void => {
    const next = Math.min(100, Math.max(0, Math.round(value)));
    slider.value = String(next);
    text.textContent = String(next);
    applyPetVolume(next);
    const pct = `${next}%`;
    slider.style.background =
      `linear-gradient(to right, #00BFFF ${pct}, rgba(255,255,255,0.2) ${pct})`;
  };

  // 初始化轨道进度背景
  updatePanel(getPetVolumePercent());

  slider.addEventListener("input", () => {
    const value = parseInt(slider.value, 10);
    localStorage.setItem(LS_PET_VOLUME, String(value));
    updatePanel(value);
  });

  slider.addEventListener("change", () => {
    playSound("pop");
  });

  window.addEventListener("storage", (event) => {
    if (event.key === LS_PET_VOLUME) updatePanel(getPetVolumePercent());
    if (event.key === LS_PET_EXTERNAL_SPEECH && event.newValue) {
      try {
        const payload = JSON.parse(event.newValue) as { text?: string; durationMs?: number };
        if (payload.text) showSpeech(payload.text, payload.durationMs || 6000, false);
      } catch (error) {
        console.warn("Invalid external speech payload:", error);
      }
    }
  });

  panel.addEventListener("mouseenter", () => {
    isPetPanelOpen = true;
    lastPetInteractionTime = Date.now();
  });

  panel.addEventListener("mouseleave", () => {
    isPetPanelOpen = false;
    panel.style.display = "none";
    panel.style.bottom = "-50px";
  });
}

// ── Init ──

async function main(): Promise<void> {
  // 首次启动默认值初始化
  if (localStorage.getItem("pet-always-on-top") === null) {
    localStorage.setItem("pet-always-on-top", "true");
  }
  if (localStorage.getItem(LS_CHAT_MODE) === null) {
    localStorage.setItem(LS_CHAT_MODE, "basic");
  }
  if (localStorage.getItem(LS_MERIT_TEXT) === null) {
    localStorage.setItem(LS_MERIT_TEXT, MERIT_DEFAULT_TEXT);
  }
  localStorage.setItem(LS_MERIT_ENABLED, "false");

  const spriteEl = document.getElementById("pet-sprite");
  if (!spriteEl) {
    console.error("Pet sprite element not found");
    return;
  }

  const { spritesheetUrl, manifest } = await loadPetAssets();
  const engine = new PetEngine(spriteEl, atlasFromManifest(manifest), spritesheetUrl);
  (window as any).__petEngine = engine;
  await applyPetSizeScale();

  // Boot ceremony: wave then idle, with speech bubble
  engine.applyState("waving");
  showSpeech(checkSpecialDayAndTime(), 5000);
  setTimeout(() => {
    if (!isExiting) engine.applyState("idle");
  }, 5000);

  setupDrag(engine);
  setupContextMenu(engine);
  setupMusicRhythmMode();
  setupCursorPassthrough();
  setupEyeTracking();
  setupBioClock(engine);
  setupWakeUp(engine);
  setupIdleRoaming(engine);
  setupManagerSettingsSync();
  setupVolumePanel();
  setupSizePanel();
  setupFocusPanel(engine);
  setupMeritPanel(engine);
  setupApiSettingsPanel();
  setupCustomPersonaPanel();
  setupGitHubSettingsPanel();
  setupFileDrop();
  setupTodoPanel();
  void restoreSavedSummonedPets();

  // GitHub 贡献度监控：启动 3 秒后初检，之后每 5 分钟轮询
  setTimeout(() => checkGitHubStatus(), 3000);
  setInterval(() => checkGitHubStatus(), 5 * 60 * 1000);
  console.log("VibePet engine initialized");
}

// ── File Drop -> Recycle Bin ──

function setupFileDrop(): void {
  const container = document.getElementById("pet-container");
  if (!container) return;

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    container.classList.add("drag-over");
  });

  container.addEventListener("dragleave", () => {
    container.classList.remove("drag-over");
  });

  container.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.remove("drag-over");

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const path = (files[i] as any).path;
      if (path) paths.push(path);
    }

    if (paths.length > 0) {
      try {
        await invoke("move_to_trash", { paths });
      } catch (err) {
        console.error("move_to_trash failed:", err);
      }
    }

    container.classList.remove("anim-swallow");
    void container.offsetWidth;
    container.classList.add("anim-swallow");
    setTimeout(() => container.classList.remove("anim-swallow"), 500);

    playSound("crunch");
    showSpeech("吧唧吧唧... 垃圾清理完毕！", 3000);
  });
}

main();
