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
const LS_SPEECH_BUBBLE_STYLE = "pet_speech_bubble_style";
const LS_PET_GRAVITY_ENABLED = "pet_gravity_enabled";
const SPEECH_BUBBLE_STYLE_IDS = new Set(["1", "2", "3", "5", "6", "7", "8", "9"]);

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

function isPetGravityEnabled(): boolean {
  return localStorage.getItem(LS_PET_GRAVITY_ENABLED) !== "false";
}

function playSound(type: keyof typeof sfx): void {
  const audio = sfx[type];
  audio.currentTime = 0;
  audio.play().catch((e) => console.warn("Audio play failed:", e));
}

function stopSound(type: keyof typeof sfx): void {
  const audio = sfx[type];
  audio.pause();
  audio.currentTime = 0;
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

  halt(): void {
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
const PET_WINDOW_TOP_PADDING = 100;
const PET_CONTEXT_MENU_SPACE = 174;
// ── Focus Mode State ──
let isFocusMode = false;
let isFocusPaused = false;
let focusEndTime = 0;
let focusDurationMs = 0;
let focusPausedRemainingMs = 0;
let focusIntervalId: ReturnType<typeof setInterval> | null = null;
const FOCUS_PANEL_WINDOW_WIDTH = 344;
const FOCUS_PANEL_WINDOW_HEIGHT = 640;
let lastPetInteractionTime = 0;
let isPetHovered = false;
let isPetMenuOpen = false;
let isPetPanelOpen = false;
let isRecallAnimating = false;
let isTeleportAnimating = false;
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
const DEFAULT_PRIMARY_PET_ID = "doro";
const LS_FOCUS_MINUTES = "pet_focus_minutes";
const LS_SUMMONED_PET_IDS = "pet_summoned_pet_ids";
const LS_PET_ASSETS_VERSION = "pet_assets_version";
const LS_PET_EXTERNAL_SPEECH = "pet_external_speech";
const LS_PET_WINDOW_STATE_VERSION = "pet_window_state_version";
let apiKeyMigrationWarned = false;

function getPrimaryPetId(): string {
  const saved = localStorage.getItem(LS_PRIMARY_PET_ID);
  return saved && saved !== "ikun-pet" ? saved : DEFAULT_PRIMARY_PET_ID;
}

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

function getBubbleScaleFactor(petScale: number): number {
  let targetVisualScale = 0.85;
  if (petScale <= 0.4) {
    // 迷你尺寸：适当缩小视觉占比至 0.62，避免气泡过于庞大遮挡头部
    targetVisualScale = 0.62;
  } else if (petScale <= 0.6) {
    // 标准尺寸：视觉占比 0.80
    targetVisualScale = 0.80;
  } else if (petScale <= 1.0) {
    // 醒目尺寸：视觉占比 0.92
    targetVisualScale = 0.92;
  } else {
    // 超大尺寸：视觉占比 0.85，精致小巧
    targetVisualScale = 0.85;
  }
  return targetVisualScale / petScale;
}

async function updateSpeechBubbleWindowState(show: boolean): Promise<void> {
  const bubble = document.getElementById("pet-speech-bubble");
  if (!bubble) return;

  const scale = getPetSizeScale();
  if (show) {
    const bubbleScaleFactor = getBubbleScaleFactor(scale);
    document.documentElement.style.setProperty("--bubble-scale-factor", String(bubbleScaleFactor));
  }
}

function getPetPixelSize(scale = getPetSizeScale()): { width: number; height: number } {
  return {
    width: Math.round(Math.max(PET_BASE_WIDTH + PET_CONTEXT_MENU_SPACE * 2, PET_BASE_WIDTH * scale + PET_CONTEXT_MENU_SPACE * 2)),
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

  const bubbleScaleFactor = getBubbleScaleFactor(nextScale);
  document.documentElement.style.setProperty("--bubble-scale-factor", String(bubbleScaleFactor));

  const bubble = document.getElementById("pet-speech-bubble");
  const isSpeechShowing = bubble?.classList.contains("show-bubble") || false;

  if (isSpeechShowing) {
    // 气泡正在展示中，同步重新计算气泡展开需要的窗口高度
    void updateSpeechBubbleWindowState(true);
  } else {
    // 气泡不在展示中，应用正常的紧凑高度
    document.documentElement.style.setProperty("--pet-window-top-padding", `${PET_WINDOW_TOP_PADDING}px`);
    const appWindow = getCurrentWindow();
    const size = getPetPixelSize(nextScale);
    await appWindow.setSize(new LogicalSize(size.width, size.height));
    await clampCurrentWindowToRoamBounds();
  }
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
  const safeRemainingMs = Math.max(0, remainingMs);
  const progress = running && focusDurationMs > 0
    ? 1 - clamp(safeRemainingMs / focusDurationMs, 0, 1)
    : 0;
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  if (panel) {
    panel.style.setProperty("--focus-progress", `${Math.round(progress * 100)}%`);
    panel.classList.toggle("focus-running", running && !isFocusPaused);
    panel.classList.toggle("focus-paused", running && isFocusPaused);
  }
  if (label) {
    label.textContent = running
      ? (isFocusPaused ? "已暂停，保留当前进度" : "专注进行中")
      : "准备开始";
  }
  const startBtn = document.getElementById("focus-start") as HTMLButtonElement | null;
  const pauseBtn = document.getElementById("focus-pause") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("focus-reset") as HTMLButtonElement | null;
  if (startBtn) startBtn.textContent = running ? (isFocusPaused ? "继续" : "结束") : "开始";
  if (pauseBtn) {
    pauseBtn.textContent = isFocusPaused ? "继续" : "暂停";
    pauseBtn.disabled = !running;
  }
  if (resetBtn) resetBtn.disabled = !running && progress === 0;
}

function syncFocusPresetButtons(minutes: number): void {
  document.querySelectorAll<HTMLButtonElement>(".focus-preset").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.focusMinutes) === minutes);
  });
}

function ensureFocusPanelLayout(panel: HTMLElement): void {
  if (panel.dataset.focusLayoutReady === "true") return;
  const top = panel.querySelector(".focus-panel-top");
  const title = panel.querySelector(".focus-panel-title");
  const label = document.getElementById("focus-state-label");
  if (top && title && label) {
    top.innerHTML = "";
    const copy = document.createElement("div");
    copy.className = "focus-title-copy";
    const titleRow = document.createElement("div");
    titleRow.className = "focus-title-row";
    const icon = document.createElement("span");
    icon.className = "focus-title-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path><path d="M6 4 4 6"></path><path d="m18 4 2 2"></path></svg>';
    title.textContent = "专注空间";
    label.textContent = "准备开始";
    titleRow.append(icon, title);
    copy.append(titleRow, label);
    const closeBtn = document.createElement("button");
    closeBtn.id = "focus-close";
    closeBtn.className = "merit-close-x focus-close-btn";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "×";
    top.append(copy, closeBtn);
  }

  const timerCard = panel.querySelector(".focus-timer-card");
  if (timerCard) {
    timerCard.innerHTML = '<div class="focus-ring" aria-hidden="true"><div class="focus-ring-fill"></div><div class="focus-ring-inner"><div id="focus-status-text">25:00</div><div class="focus-ring-caption">分钟专注</div></div></div>';
  }

  const actionRow = panel.querySelector(".focus-action-row");
  if (actionRow) {
    actionRow.innerHTML = '<button id="focus-start" type="button">开始</button><button id="focus-pause" type="button">暂停</button><button id="focus-reset" type="button">重置</button>';
  }
  panel.dataset.focusLayoutReady = "true";
}

function setFocusBubbleText(text: string): void {
  const bubble = document.getElementById("pet-speech-bubble");
  const bubbleText = bubble?.querySelector(".bubble-text") as HTMLElement | null;
  if (!bubble || !bubbleText) return;
  bubbleText.textContent = text;
  bubble.classList.add("show-bubble");
  void updateSpeechBubbleWindowState(true);
}

function clearFocusTimer(): void {
  if (focusIntervalId) {
    clearInterval(focusIntervalId);
    focusIntervalId = null;
  }
}

function getFocusRemainingMs(): number {
  if (!isFocusMode) return (Number(localStorage.getItem(LS_FOCUS_MINUTES) || "25") || 25) * 60_000;
  return isFocusPaused ? focusPausedRemainingMs : Math.max(0, focusEndTime - Date.now());
}

function tickFocusMode(engine: PetEngine): void {
  if (!isFocusMode || isFocusPaused) return;
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
}

function startFocusTicker(engine: PetEngine): void {
  clearFocusTimer();
  focusIntervalId = setInterval(() => {
    tickFocusMode(engine);
  }, 1000);
}

function startFocusMode(minutes: number, engine: PetEngine): void {
  if (isMeritMode) endMeritMode(engine, false);
  const duration = Math.min(240, Math.max(1, Math.round(minutes)));
  localStorage.setItem(LS_FOCUS_MINUTES, String(duration));
  clearFocusTimer();

  isFocusMode = true;
  isFocusPaused = false;
  focusPausedRemainingMs = 0;
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

  startFocusTicker(engine);
  updateFocusPanelState(focusDurationMs, true);
}

function pauseFocusMode(engine: PetEngine): void {
  if (!isFocusMode || isFocusPaused) return;
  focusPausedRemainingMs = Math.max(0, focusEndTime - Date.now());
  isFocusPaused = true;
  clearFocusTimer();
  engine.applyState("idle");
  updateFocusPanelState(focusPausedRemainingMs, true);
}

function resumeFocusMode(engine: PetEngine): void {
  if (!isFocusMode || !isFocusPaused) return;
  isFocusPaused = false;
  focusEndTime = Date.now() + Math.max(0, focusPausedRemainingMs);
  focusPausedRemainingMs = 0;
  engine.applyState(engine.hasState("focus") ? "focus" : "review");
  startFocusTicker(engine);
  updateFocusPanelState(Math.max(0, focusEndTime - Date.now()), true);
}

function resetFocusMode(engine: PetEngine): void {
  clearFocusTimer();
  isFocusMode = false;
  isFocusPaused = false;
  focusEndTime = 0;
  focusDurationMs = 0;
  focusPausedRemainingMs = 0;
  const savedMinutes = Number(localStorage.getItem(LS_FOCUS_MINUTES) || "25") || 25;
  updateFocusPanelState(savedMinutes * 60_000, false);
  engine.applyState("idle");
}

function endFocusMode(engine: PetEngine, completed: boolean): void {
  clearFocusTimer();
  const wasFocusMode = isFocusMode;
  isFocusMode = false;
  isFocusPaused = false;
  focusEndTime = 0;
  focusDurationMs = 0;
  focusPausedRemainingMs = 0;
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

async function expandFocusPanelWindow(): Promise<void> {
  const normalSize = getPetPixelSize();
  await setPetWindowSizePreservingAnchor(
    Math.max(normalSize.width, FOCUS_PANEL_WINDOW_WIDTH),
    Math.max(normalSize.height, FOCUS_PANEL_WINDOW_HEIGHT),
  );
}

async function restoreFocusPanelWindow(): Promise<void> {
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  if (panel?.style.display === "block") return;
  const normalSize = getPetPixelSize();
  await setPetWindowSizePreservingAnchor(normalSize.width, normalSize.height);
  await clampCurrentWindowToRoamBounds();
}

function hideFocusPanel(): void {
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  if (!panel) return;
  panel.style.display = "none";
  isPetPanelOpen = false;
  void restoreFocusPanelWindow();
}

async function showFocusPanel(): Promise<void> {
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  const input = document.getElementById("focus-minutes-input") as HTMLInputElement | null;
  if (!panel || !input) return;

  input.value = localStorage.getItem(LS_FOCUS_MINUTES) || input.value || "25";
  const minutes = Math.min(240, Math.max(1, Math.round(Number(input.value) || 25)));
  input.value = String(minutes);
  syncFocusPresetButtons(minutes);
  updateFocusPanelState(isFocusMode ? getFocusRemainingMs() : minutes * 60_000, isFocusMode);
  await expandFocusPanelWindow();
  positionFocusPanel(panel);
  isPetPanelOpen = true;
  lastPetInteractionTime = Date.now();
}

function positionFocusPanel(panel: HTMLElement): void {
  const pet = document.getElementById("pet-container");
  const margin = 8;
  const bottomSafeMargin = 72;
  const gap = 8;
  panel.style.visibility = "hidden";
  panel.style.display = "block";
  panel.style.maxHeight = "";

  const panelRect = panel.getBoundingClientRect();
  const petRect = pet?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxPanelTop = Math.max(margin, viewportHeight - panelRect.height - bottomSafeMargin);
  let left = margin;
  let top = margin;

  if (petRect) {
    const rightLeft = petRect.right + gap;
    const leftLeft = petRect.left - panelRect.width - gap;
    const sideTop = clamp(
      petRect.top + petRect.height / 2 - panelRect.height / 2,
      margin,
      maxPanelTop,
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

// ── Merit State & Helpers ──

const LS_MERIT_TEXT = "pet_merit_text";
const LS_MERIT_COUNT = "pet_merit_count"; // 累计功德数
const LS_MERIT_TODAY_DATE = "pet_merit_today_date";
const LS_MERIT_TODAY_COUNT = "pet_merit_today_count";
const LS_MERIT_ENABLED = "pet_merit_enabled";
const LS_MERIT_SIGN = "pet_merit_sign";       // 变动符号
const LS_MERIT_VALUE = "pet_merit_value";     // 变动数值
const LS_MERIT_FREQ = "pet_merit_freq";       // 自动敲击频率
const LS_MERIT_STREAK = "pet_merit_streak";   // 连续天数
const LS_MERIT_LAST_HIT_DATE = "pet_merit_last_hit_date"; // 上次敲击日期
const LS_MERIT_HISTORY = "pet_merit_history"; // 历史记录

const MERIT_DEFAULT_TEXT = "功德";
const MERIT_BADGE_THRESHOLDS = [100, 500, 1000] as const;
let isMeritMode = false;
let meritIntervalId: ReturnType<typeof setInterval> | null = null;
let isMeritPanelOpen = false; // 是否开启了功德大面板

function getMeritSign(): string {
  return localStorage.getItem(LS_MERIT_SIGN) || "+";
}

function setMeritSign(sign: string): void {
  localStorage.setItem(LS_MERIT_SIGN, sign);
}

function getMeritValue(): number {
  const val = Number(localStorage.getItem(LS_MERIT_VALUE) || "1");
  return Number.isFinite(val) ? val : 1;
}

function setMeritValue(value: number): void {
  localStorage.setItem(LS_MERIT_VALUE, String(value));
}

function getMeritFreq(): number {
  const freq = Number(localStorage.getItem(LS_MERIT_FREQ) || "1.0");
  return Number.isFinite(freq) && freq >= 0.3 && freq <= 5.0 ? freq : 1.0;
}

function setMeritFreq(freq: number): void {
  localStorage.setItem(LS_MERIT_FREQ, String(Math.max(0.3, Math.min(5.0, freq))));
}

function getMeritStreak(): number {
  const streak = Number(localStorage.getItem(LS_MERIT_STREAK) || "0");
  return Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0;
}

function getMeritHistory(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_MERIT_HISTORY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveMeritHistory(history: Record<string, number>): void {
  localStorage.setItem(LS_MERIT_HISTORY, JSON.stringify(history));
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

// 格式化数据，过万后用w表示，保留一位小数
function formatMeritNumber(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}w`;
  }
  return count.toLocaleString();
}

function updateMeritBadgesState(): void {
  const today = getMeritTodayCount();
  const b1 = document.getElementById("badge-level1");
  const b2 = document.getElementById("badge-level2");
  const b3 = document.getElementById("badge-level3");

  if (b1) {
    if (today >= MERIT_BADGE_THRESHOLDS[0]) b1.classList.add("unlocked");
    else b1.classList.remove("unlocked");
  }
  if (b2) {
    if (today >= MERIT_BADGE_THRESHOLDS[1]) b2.classList.add("unlocked");
    else b2.classList.remove("unlocked");
  }
  if (b3) {
    if (today >= MERIT_BADGE_THRESHOLDS[2]) b3.classList.add("unlocked");
    else b3.classList.remove("unlocked");
  }
}

function updateMeritPanelState(): void {
  const textInput = document.getElementById("merit-text-input") as HTMLInputElement | null;
  const bigNum = document.getElementById("merit-big-number");
  const totalText = document.getElementById("merit-total-count-text");
  const todayText = document.getElementById("merit-today-count-text");
  const streakText = document.getElementById("merit-streak-count-text");
  const freqText = document.getElementById("merit-freq-text");
  const freqSlider = document.getElementById("merit-freq-slider") as HTMLInputElement | null;

  const statusDot = document.getElementById("merit-status-dot");
  const statusLabel = document.getElementById("merit-status-label-text");
  const actionBtn = document.getElementById("merit-action-btn");

  // 自定义词汇
  if (textInput && document.activeElement !== textInput) {
    textInput.value = getMeritText();
  }

  // 变动数值与符号
  const sign = getMeritSign();
  const val = getMeritValue();
  if (bigNum) {
    bigNum.textContent = `${sign}${val}`;
    if (sign === "-") {
      bigNum.classList.add("minus-style");
    } else {
      bigNum.classList.remove("minus-style");
    }
  }

  // 纵向列表选中状态同步
  const valList = document.getElementById("merit-value-list");
  if (valList) {
    const combinedVal = String(val * (sign === "-" ? -1 : 1));
    const buttons = valList.querySelectorAll(".merit-list-item");
    buttons.forEach(btn => {
      if ((btn as HTMLElement).dataset.val === combinedVal) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  // 累计、今日、天数
  if (totalText) totalText.textContent = formatMeritNumber(getMeritCount());
  if (todayText) todayText.textContent = formatMeritNumber(getMeritTodayCount());
  if (streakText) streakText.textContent = `${getMeritStreak()} 天`;

  // 频率
  const freq = getMeritFreq();
  if (freqText) freqText.textContent = `${freq.toFixed(1)} 次/秒`;
  if (freqSlider) freqSlider.value = String(freq);

  // 状态指示灯
  if (statusDot) {
    if (isMeritMode) statusDot.classList.add("active");
    else statusDot.classList.remove("active");
  }
  if (statusLabel) {
    statusLabel.textContent = isMeritMode ? "敲击中" : "未开始";
  }

  // 大动作按钮
  if (actionBtn) {
    const textSpan = document.getElementById("merit-action-text-span");
    const sub = document.getElementById("merit-action-sub-text-span");
    const primary = actionBtn.querySelector(".btn-primary-text");
    if (isMeritMode) {
      actionBtn.classList.add("running");
      if (textSpan) textSpan.textContent = "结束敲击";
      if (sub) sub.textContent = "停止积累功德";
      if (primary) {
        const svg = primary.querySelector("svg");
        if (svg) svg.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
      }
    } else {
      actionBtn.classList.remove("running");
      if (textSpan) textSpan.textContent = "开始敲击";
      if (sub) sub.textContent = "开始积累功德";
      if (primary) {
        const svg = primary.querySelector("svg");
        if (svg) svg.innerHTML = '<path d="M5 3l14 9-14 9V3z"/>';
      }
    }
  }

  // 成就状态
  updateMeritBadgesState();
}

function updateStreak(): void {
  const today = getMeritDateKey();
  
  // 计算昨日的日期字符串 YYYY-MM-DD
  const now = new Date();
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yYear = yesterdayDate.getFullYear();
  const yMonth = String(yesterdayDate.getMonth() + 1).padStart(2, "0");
  const yDay = String(yesterdayDate.getDate()).padStart(2, "0");
  const yesterday = `${yYear}-${yMonth}-${yDay}`;
  
  const lastHitDate = localStorage.getItem(LS_MERIT_LAST_HIT_DATE) || "";
  let streak = getMeritStreak();
  
  if (lastHitDate !== today) {
    if (lastHitDate === yesterday) {
      streak += 1;
    } else {
      streak = 1;
    }
    localStorage.setItem(LS_MERIT_STREAK, String(streak));
    localStorage.setItem(LS_MERIT_LAST_HIT_DATE, today);
  }
}

function updateHistoryRecord(): void {
  const today = getMeritDateKey();
  const history = getMeritHistory();
  
  // 记录今日总敲击数
  history[today] = getMeritTodayCount();
  
  // 只保留最近 14 天记录
  const keys = Object.keys(history).sort((a, b) => b.localeCompare(a));
  const newHistory: Record<string, number> = {};
  keys.slice(0, 14).forEach((k) => {
    newHistory[k] = history[k];
  });
  
  saveMeritHistory(newHistory);
}

function renderHistoryList(): void {
  const listEl = document.getElementById("merit-history-list");
  if (!listEl) return;
  
  listEl.innerHTML = "";
  const history = getMeritHistory();
  const keys = Object.keys(history).sort((a, b) => b.localeCompare(a));
  
  if (keys.length === 0) {
    const tip = document.createElement("div");
    tip.style.textAlign = "center";
    tip.style.fontSize = "11px";
    tip.style.color = "rgba(255, 255, 255, 0.35)";
    tip.style.marginTop = "30px";
    tip.textContent = "暂无修行记录";
    listEl.appendChild(tip);
    return;
  }
  
  keys.forEach((date) => {
    const count = history[date];
    const item = document.createElement("div");
    item.className = "history-item";
    
    const dateSpan = document.createElement("span");
    dateSpan.className = "history-date";
    dateSpan.textContent = date;
    
    const countSpan = document.createElement("strong");
    countSpan.className = "history-count";
    countSpan.textContent = `+${count.toLocaleString()}`;
    
    item.appendChild(dateSpan);
    item.appendChild(countSpan);
    listEl.appendChild(item);
  });
}

function triggerFallbackMeritHit(container: HTMLElement | null): void {
  if (!container) return;
  container.classList.remove("merit-hit");
  void container.offsetWidth;
  container.classList.add("merit-hit");
  window.setTimeout(() => container.classList.remove("merit-hit"), 260);
}

function showMeritHitSpeech(text: string): void {
  const intervalMs = Math.round(1000 / getMeritFreq());
  const durationMs = clamp(Math.round(intervalMs * 0.45), 120, 420);
  showSpeech(text, durationMs, false);
}

function getMeritSoundFrame(engine: PetEngine): number {
  return Math.max(0, Math.min(2, engine.frameCount("merit") - 1));
}

function triggerMeritHit(engine: PetEngine): void {
  const container = document.getElementById("pet-container");
  const text = getMeritText();
  const sign = getMeritSign();
  const val = getMeritValue();
  
  // 累加累计和今日功德
  setMeritCount(getMeritCount() + val);
  setMeritTodayCount(getMeritTodayCount() + val);
  
  // 更新连续打卡与历史日历记录
  updateStreak();
  updateHistoryRecord();
  updateMeritPanelState();

  // 1. 面板内大数字跳动动画
  const bigNum = document.getElementById("merit-big-number");
  if (bigNum) {
    bigNum.classList.remove("bounce");
    void bigNum.offsetWidth;
    bigNum.classList.add("bounce");
    window.setTimeout(() => bigNum.classList.remove("bounce"), 100);
  }

  // 2. 面板内静态切片敲击动效
  const imgBox = document.querySelector(".merit-pet-image-box");
  if (imgBox) {
    imgBox.classList.remove("hitting");
    void (imgBox as HTMLElement).offsetWidth;
    imgBox.classList.add("hitting");
    window.setTimeout(() => imgBox.classList.remove("hitting"), 150);
  }

  // 3. 面板内部飘字气泡
  const panelFloatContainer = document.getElementById("merit-panel-floating-container");
  if (panelFloatContainer) {
    const floatEl = document.createElement("span");
    floatEl.className = "panel-float-text";
    const randomOffset = Math.round((Math.random() - 0.5) * 45);
    floatEl.style.left = `calc(50% + ${randomOffset}px - 20px)`;
    floatEl.style.top = "15px";
    floatEl.textContent = `${text} ${sign}${val}`;
    panelFloatContainer.appendChild(floatEl);
    window.setTimeout(() => {
      floatEl.remove();
    }, 1200);
  }

  // 4. 播放动画与木鱼声音
  const meritEngine = (window as any).__meritPanelEngine as PetEngine | undefined;
  if (engine.hasState("merit")) {
    engine.playOnce("merit", isMeritMode ? "merit" : "idle", {
      [getMeritSoundFrame(engine)]: () => playSound("woodfish"),
    });
    if (meritEngine && meritEngine.hasState("merit")) {
      meritEngine.playOnce("merit", "merit");
    }
  } else {
    triggerFallbackMeritHit(container);
    if (engine.currentState !== "review") engine.applyState("review");
    playSound("woodfish");
    // Fallback animation for merit panel pet
    if (meritEngine && meritEngine.hasState("review") && meritEngine.currentState !== "review") {
      meritEngine.applyState("review");
    }
  }

  // 5. 飘出主桌宠头顶气泡
  showMeritHitSpeech(`${text} ${sign}${val}`);
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
  
  const meritEngine = (window as any).__meritPanelEngine as PetEngine | undefined;
  if (meritEngine) {
    meritEngine.applyState(meritEngine.hasState("merit") ? "merit" : "idle");
  }
  
  updateMeritPanelState();
  showSpeech(`${text}模式开始`, 1800);
  triggerMeritHit(engine);
  
  // 定时自动敲击
  const freq = getMeritFreq();
  const intervalMs = Math.round(1000 / freq);
  meritIntervalId = setInterval(() => {
    if (!isMeritMode) return;
    triggerMeritHit(engine);
  }, intervalMs);
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
  const meritEngine = (window as any).__meritPanelEngine as PetEngine | undefined;
  if (meritEngine) {
    meritEngine.applyState("idle");
  }
  if (announce) {
    showSpeech("敲击结束，功德圆满", 1800);
  }
}

function stopCurrentPetActivitiesImmediately(): void {
  clearMeritTimer();
  isMeritMode = false;
  localStorage.setItem(LS_MERIT_ENABLED, "false");
  document.getElementById("pet-container")?.classList.remove("merit-active", "merit-hit");
  stopSound("woodfish");

  const engine = (window as any).__petEngine as PetEngine | undefined;
  const meritEngine = (window as any).__meritPanelEngine as PetEngine | undefined;

  engine?.halt();
  meritEngine?.halt();

  if (engine?.hasState("idle")) {
    engine.applyState("idle");
    engine.halt();
  }
  if (meritEngine?.hasState("idle")) {
    meritEngine.applyState("idle");
    meritEngine.halt();
  }

  updateMeritPanelState();
}

let meritOrigWindowPos: { x: number; y: number } | null = null;

async function showMeritPanel(): Promise<void> {
  const panel = document.getElementById("merit-panel") as HTMLElement | null;
  const pet = document.getElementById("pet-container");
  if (!panel) return;

  // 记录打开大面板前的原窗口绝对物理坐标，用以在关闭面板时令桌宠零距离闪现回归原地，摆脱被跟着拖走的位移漂移感
  try {
    const currentPos = await getCurrentWindow().outerPosition();
    meritOrigWindowPos = { x: currentPos.x, y: currentPos.y };
  } catch (err) {
    console.error("Failed to record original window position:", err);
  }
  
  updateMeritPanelState();
  
  // 1. 隐藏原本的桌宠自身防视觉重合
  if (pet) {
    pet.style.opacity = "0";
    pet.style.pointerEvents = "none";
  }

  // 2. 显示大面板并归位
  panel.style.display = "block";
  panel.style.left = "15px";
  panel.style.top = "15px";

  // 读取原窗口位置和显示器尺寸，进行高精度防出屏与防遮挡定位
  const appWindow = getCurrentWindow();
  try {
    const currentPos = await appWindow.outerPosition();
    const currentSize = await appWindow.outerSize();
    const monitor = await currentMonitor();

    if (monitor) {
      const scaleFactor = monitor.scaleFactor;
      
      // 原窗口中心点 (逻辑像素)
      const origWidth = currentSize.width / scaleFactor;
      const origHeight = currentSize.height / scaleFactor;
      const origX = currentPos.x / scaleFactor;
      const origY = currentPos.y / scaleFactor;
      const origCenterX = origX + origWidth / 2;
      const origCenterY = origY + origHeight / 2;

      // 面板计划尺寸 (逻辑像素)
      const panelWidth = 650;
      const panelHeight = 750;

      // 屏幕工作区大小 (逻辑像素)
      const monitorSize = monitor.size;
      const workWidth = monitorSize.width / scaleFactor;
      const workHeight = monitorSize.height / scaleFactor;

      // 以原本宠物的中心做中心对称膨胀，最大程度承接用户的视觉关注点
      let nextX = origCenterX - panelWidth / 2;
      let nextY = origCenterY - panelHeight / 2;

      // 留出 16px 呼吸安全边距，进行边界碰撞纠偏
      const minGap = 16;
      if (nextX < minGap) nextX = minGap;
      if (nextY < minGap) nextY = minGap;
      if (nextX + panelWidth > workWidth - minGap) {
        nextX = workWidth - panelWidth - minGap;
      }
      if (nextY + panelHeight > workHeight - minGap) {
        nextY = workHeight - panelHeight - minGap;
      }

      // 将计算出的完美坐标热生效设定到窗口
      const physX = Math.round(nextX * scaleFactor);
      const physY = Math.round(nextY * scaleFactor);
      await appWindow.setPosition(new PhysicalPosition(physX, physY));
    }
  } catch (err) {
    console.error("Failed to position merit window:", err);
  }

  // 3. 一次性改变物理窗口尺寸为 650 x 750
  await appWindow.setSize(new LogicalSize(650, 750));

  isPetPanelOpen = true;
  isMeritPanelOpen = true;
  lastPetInteractionTime = Date.now();
}

async function hideMeritPanel(): Promise<void> {
  const panel = document.getElementById("merit-panel") as HTMLElement | null;
  const pet = document.getElementById("pet-container");
  if (!panel) return;

  panel.style.display = "none";

  // 关闭打开的侧滑抽屉
  document.getElementById("merit-history-drawer")?.classList.remove("open");
  document.getElementById("merit-achievements-drawer")?.classList.remove("open");

  // 1. 恢复显示桌宠身体
  if (pet) {
    pet.style.opacity = "1";
    pet.style.pointerEvents = "auto";
  }

  isPetPanelOpen = false;
  isMeritPanelOpen = false;

  // 恢复打开大面板前宠物的物理出生坐标点，避免因为用户在面板展示期间拖拽了面板而导致关闭时宠物本体位置发生偏移漂移
  const appWindow = getCurrentWindow();
  if (meritOrigWindowPos) {
    try {
      await appWindow.setPosition(new PhysicalPosition(meritOrigWindowPos.x, meritOrigWindowPos.y));
    } catch (err) {
      console.error("Failed to restore original window position:", err);
    }
    meritOrigWindowPos = null;
  }

  // 2. 调用 applyPetSizeScale 精准还原窗口大小及缩放位置
  await applyPetSizeScale();
}

function setupMeritPanel(engine: PetEngine): void {
  const panel = document.getElementById("merit-panel") as HTMLElement | null;
  const input = document.getElementById("merit-text-input") as HTMLInputElement | null;
  const valList = document.getElementById("merit-value-list");

  const actionBtn = document.getElementById("merit-action-btn");
  const closeBtn = document.getElementById("merit-close-btn");

  const historyBtn = document.getElementById("merit-history-btn");
  const histDrawer = document.getElementById("merit-history-drawer");
  const closeHistBtn = document.getElementById("close-history-drawer-btn");
  const clearHistBtn = document.getElementById("clear-merit-history-btn");

  const moreAchBtn = document.getElementById("merit-more-achievements-btn");
  const achDrawer = document.getElementById("merit-achievements-drawer");
  const closeAchBtn = document.getElementById("close-achievements-drawer-btn");

  const freqSlider = document.getElementById("merit-freq-slider") as HTMLInputElement | null;
  const freqDec = document.getElementById("merit-freq-dec");
  const freqInc = document.getElementById("merit-freq-inc");

  if (!panel) return;

  updateMeritPanelState();

  // 支持在面板的任何非交互性空白背景上按住鼠标左键直接拖动大窗口
  panel.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button === 0) {
      const target = e.target as HTMLElement | null;
      if (target) {
        // 避开所有的按钮、输入框、频率控制区、选项列表以及侧滑抽屉交互节点
        const isInteractive = target.closest("button, input, textarea, a, .merit-list-item, #merit-freq-slider, .freq-preset-btn, .freq-adjust-btn, .merit-action-glow-btn, .merit-close-x, .merit-side-drawer, .drawer-close-btn");
        if (!isInteractive) {
          void getCurrentWindow().startDragging();
        }
      }
    }
  });

  // 自定义飘字词汇修改
  if (input) {
    input.value = getMeritText();
    input.addEventListener("input", () => {
      const text = normalizeMeritText(input.value);
      localStorage.setItem(LS_MERIT_TEXT, text);
      lastPetInteractionTime = Date.now();
    });
    input.addEventListener("change", () => {
      input.value = getMeritText();
    });
  }

  // 渲染纵向列表并绑定事件
  if (valList) {
    const standardValues = [10, 5, 2, 1, -1, -2, -5, -10];
    valList.innerHTML = "";
    for (const v of standardValues) {
      const btn = document.createElement("button");
      btn.className = "merit-list-item";
      btn.type = "button";
      btn.dataset.val = String(v);
      btn.textContent = v > 0 ? `+${v}` : String(v);
      
      btn.addEventListener("click", () => {
        if (v < 0) {
          setMeritSign("-");
          setMeritValue(Math.abs(v));
        } else {
          setMeritSign("+");
          setMeritValue(v);
        }
        updateMeritPanelState();
        lastPetInteractionTime = Date.now();
      });
      
      valList.appendChild(btn);
    }
  }

  // 频率滑动逻辑
  const onFreqChange = (newFreq: number): void => {
    const freq = Math.max(0.3, Math.min(5.0, Math.round(newFreq * 10) / 10));
    setMeritFreq(freq);
    updateMeritPanelState();

    // 更新预设按钮激活状态
    document.querySelectorAll(".freq-preset-btn").forEach((btn) => {
      const bVal = Number(btn.getAttribute("data-val") || "0");
      if (Math.abs(bVal - freq) < 0.05) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 如果处于运行中，则热重启定时器
    if (isMeritMode) {
      clearMeritTimer();
      const intervalMs = Math.round(1000 / freq);
      meritIntervalId = setInterval(() => {
        if (!isMeritMode) return;
        triggerMeritHit(engine);
      }, intervalMs);
    }
    lastPetInteractionTime = Date.now();
  };

  if (freqSlider) {
    freqSlider.addEventListener("input", () => {
      onFreqChange(Number(freqSlider.value));
    });
  }

  if (freqDec) {
    freqDec.addEventListener("click", () => {
      const cur = getMeritFreq();
      onFreqChange(cur - 0.1);
    });
  }

  if (freqInc) {
    freqInc.addEventListener("click", () => {
      const cur = getMeritFreq();
      onFreqChange(cur + 0.1);
    });
  }

  // 快速频率预设
  document.querySelectorAll(".freq-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = Number(btn.getAttribute("data-val") || "1.0");
      onFreqChange(val);
    });
  });

  // 开始/结束敲击大操作按钮
  if (actionBtn) {
    actionBtn.addEventListener("click", () => {
      if (isMeritMode) {
        endMeritMode(engine);
      } else {
        if (input) {
          input.value = normalizeMeritText(input.value);
          localStorage.setItem(LS_MERIT_TEXT, input.value);
        }
        startMeritMode(engine);
      }
      updateMeritPanelState();
      lastPetInteractionTime = Date.now();
    });
  }

  // 关闭按钮
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      void hideMeritPanel();
    });
  }

  // 历史抽屉
  if (historyBtn && histDrawer) {
    historyBtn.addEventListener("click", () => {
      renderHistoryList();
      histDrawer.classList.toggle("open");
      achDrawer?.classList.remove("open");
      lastPetInteractionTime = Date.now();
    });
  }

  if (closeHistBtn && histDrawer) {
    closeHistBtn.addEventListener("click", () => {
      histDrawer.classList.remove("open");
      lastPetInteractionTime = Date.now();
    });
  }

  if (clearHistBtn) {
    clearHistBtn.addEventListener("click", () => {
      if (window.confirm("确定要清空最近 14 天的修行打卡记录吗？")) {
        localStorage.removeItem(LS_MERIT_HISTORY);
        renderHistoryList();
        updateMeritPanelState();
      }
      lastPetInteractionTime = Date.now();
    });
  }

  // 更多成就抽屉
  if (moreAchBtn && achDrawer) {
    moreAchBtn.addEventListener("click", () => {
      achDrawer.classList.toggle("open");
      histDrawer?.classList.remove("open");
      lastPetInteractionTime = Date.now();
    });
  }

  if (closeAchBtn && achDrawer) {
    closeAchBtn.addEventListener("click", () => {
      achDrawer.classList.remove("open");
      lastPetInteractionTime = Date.now();
    });
  }

  panel.addEventListener("mouseenter", () => {
    isPetPanelOpen = true;
    lastPetInteractionTime = Date.now();
  });

  // 点击面板外自动关闭大面板
  window.addEventListener("pointerdown", (event) => {
    if (panel.style.display === "none" || !isMeritPanelOpen) return;
    const target = event.target as Node | null;
    const hitbox = document.getElementById("pet-hitbox");
    if (target && (
      panel.contains(target) ||
      hitbox?.contains(target) ||
      histDrawer?.contains(target) ||
      achDrawer?.contains(target)
    )) return;
    void hideMeritPanel();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.style.display === "none" || !isMeritPanelOpen) return;
    void hideMeritPanel();
  });
}

function setupFocusPanel(engine: PetEngine): void {
  const panel = document.getElementById("focus-panel") as HTMLElement | null;
  if (panel) ensureFocusPanelLayout(panel);
  const input = document.getElementById("focus-minutes-input") as HTMLInputElement | null;
  const startBtn = document.getElementById("focus-start") as HTMLButtonElement | null;
  const pauseBtn = document.getElementById("focus-pause") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("focus-reset") as HTMLButtonElement | null;
  const closeBtn = document.getElementById("focus-close") as HTMLButtonElement | null;
  if (!panel || !input || !startBtn || !pauseBtn || !resetBtn || !closeBtn) return;

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
    if (isFocusMode && isFocusPaused) {
      resumeFocusMode(engine);
    } else if (isFocusMode) {
      endFocusMode(engine, false);
    } else {
      const minutes = Number(input.value) || 25;
      startFocusMode(minutes, engine);
    }
  });

  pauseBtn.addEventListener("click", () => {
    if (!isFocusMode) return;
    if (isFocusPaused) resumeFocusMode(engine);
    else pauseFocusMode(engine);
  });

  resetBtn.addEventListener("click", () => {
    resetFocusMode(engine);
  });

  closeBtn.addEventListener("click", () => {
    hideFocusPanel();
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
    hideFocusPanel();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.style.display === "none") return;
    hideFocusPanel();
  });
}

function setupManagerSettingsSync(): void {
  let lastScale = getPetSizeScale();
  let lastAlwaysOnTop = isAlwaysOnTop;
  let lastPrimaryPetId = getPrimaryPetId();
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

    const nextPrimaryPetId = getPrimaryPetId();
    const nextPetAssetsVersion = localStorage.getItem(LS_PET_ASSETS_VERSION) || "";
    const shouldReloadPrimaryPet = getCurrentWindow().label === "pet" && nextPrimaryPetId !== lastPrimaryPetId;
    const shouldReloadEditedAssets = nextPetAssetsVersion !== lastPetAssetsVersion;
    if (shouldReloadPrimaryPet || shouldReloadEditedAssets) {
      lastPrimaryPetId = nextPrimaryPetId;
      lastPetAssetsVersion = nextPetAssetsVersion;
      void loadPetAssets().then(({ spritesheetUrl, manifest }) => {
        const atlas = atlasFromManifest(manifest);
        const fullUrl = `${spritesheetUrl}${spritesheetUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
        
        const engine = (window as any).__petEngine as PetEngine | undefined;
        engine?.setAtlas(atlas);
        engine?.setSpritesheet(fullUrl);
        
        const meritEngine = (window as any).__meritPanelEngine as PetEngine | undefined;
        if (meritEngine) {
          meritEngine.setAtlas(atlas);
          meritEngine.setSpritesheet(fullUrl);
          if (meritEngine.hasState("merit")) {
            meritEngine.applyState("merit");
          } else {
            meritEngine.applyState("idle");
          }
        }
      });
    }
  }, 600);
}

async function restoreSavedSummonedPets(): Promise<void> {
  if (getCurrentWindow().label !== "pet") return;
  const savedPetIds = getSavedSummonedPetIds();
  if (savedPetIds.length === 0) return;
  const primaryPetId = getPrimaryPetId();
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
const TASK_PANEL_WINDOW_WIDTH = 344;
const TASK_PANEL_WINDOW_HEIGHT = 560;

async function setPetWindowSizePreservingAnchor(width: number, height: number): Promise<void> {
  const appWindow = getCurrentWindow();
  const [position, size, scaleFactor] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.outerSize(),
    appWindow.scaleFactor(),
  ]);
  const targetWidth = Math.round(width * scaleFactor);
  const targetHeight = Math.round(height * scaleFactor);
  const anchorX = position.x + size.width / 2 + petWindowOffsetX * scaleFactor;
  const anchorY = position.y + size.height - petWindowOffsetBottom * scaleFactor;
  await appWindow.setSize(new LogicalSize(width, height));
  await appWindow.setPosition(new PhysicalPosition(
    Math.round(anchorX - targetWidth / 2 - petWindowOffsetX * scaleFactor),
    Math.round(anchorY - targetHeight + petWindowOffsetBottom * scaleFactor),
  ));
}

async function expandTaskPanelWindow(): Promise<void> {
  const normalSize = getPetPixelSize();
  await setPetWindowSizePreservingAnchor(
    Math.max(normalSize.width, TASK_PANEL_WINDOW_WIDTH),
    Math.max(normalSize.height, TASK_PANEL_WINDOW_HEIGHT),
  );
}

async function restoreTaskPanelWindow(): Promise<void> {
  const todoPanel = document.getElementById("todo-panel") as HTMLElement | null;
  const reminderPanel = document.getElementById("reminder-panel") as HTMLElement | null;
  if (todoPanel?.style.display === "block" || reminderPanel?.style.display === "block") return;
  const normalSize = getPetPixelSize();
  await setPetWindowSizePreservingAnchor(normalSize.width, normalSize.height);
  await clampCurrentWindowToRoamBounds();
}

function hideTaskPanel(panel: HTMLElement): void {
  panel.style.display = "none";
  isPetPanelOpen = false;
  void restoreTaskPanelWindow();
}

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

async function showTaskPanel(panelId: "todo-panel" | "reminder-panel"): Promise<void> {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const engine = (window as any).__petEngine as PetEngine | undefined;
  const otherPanelId = panelId === "todo-panel" ? "reminder-panel" : "todo-panel";
  const otherPanel = document.getElementById(otherPanelId);
  if (otherPanel) otherPanel.style.display = "none";

  taskPanelJustOpened = true;
  await expandTaskPanelWindow();
  positionTaskPanel(panel);
  isPetPanelOpen = true;
  lastPetInteractionTime = Date.now();
  engine?.applyState("idle");
  requestAnimationFrame(() => { taskPanelJustOpened = false; });
}

function showTodoPanel(): void {
  void showTaskPanel("todo-panel");
}

function showReminderPanel(): void {
  void showTaskPanel("reminder-panel");
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

  panel.classList.add("task-panel");
  reminderPanel.classList.add("task-panel");
  list.classList.add("task-list");
  reminderList.classList.add("task-list");
  panel.querySelector(".todo-panel-title")!.textContent = "待办任务";
  reminderPanel.querySelector(".todo-panel-title")!.textContent = "定时提醒";

  const ensurePanelHeader = (panelRoot: HTMLElement, subtitleText: string, iconSvg: string): void => {
    const title = panelRoot.querySelector(".todo-panel-title");
    if (!title || title.closest(".task-panel-header")) return;
    const header = document.createElement("div");
    header.className = "task-panel-header";
    const copy = document.createElement("div");
    copy.className = "task-panel-copy";
    const titleRow = document.createElement("div");
    titleRow.className = "task-panel-title-row";
    const subtitle = document.createElement("div");
    const mark = document.createElement("span");
    const closeBtn = document.createElement("button");
    subtitle.className = "task-panel-subtitle";
    subtitle.textContent = subtitleText;
    mark.className = "task-panel-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = iconSvg;
    closeBtn.className = "merit-close-x task-panel-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      hideTaskPanel(panelRoot);
    });
    title.replaceWith(header);
    titleRow.append(mark, title);
    copy.append(titleRow, subtitle);
    header.append(copy, closeBtn);
    panelRoot.prepend(header);
  };

  ensurePanelHeader(
    panel,
    "记录要顺手完成的小事",
    '<svg viewBox="0 0 24 24"><path d="M9 5h6M9 3h6v4H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="m8 13 2.2 2.2L16 9.5"/></svg>',
  );
  ensurePanelHeader(
    reminderPanel,
    "到点后用气泡提醒你",
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l3 2M9 3h6M12 3v3"/></svg>',
  );

  document.addEventListener("mousedown", (e) => {
    if (taskPanelJustOpened) return;
    if (panel.style.display === "block" && !panel.contains(e.target as Node)) {
      hideTaskPanel(panel);
    }
    if (reminderPanel.style.display === "block" && !reminderPanel.contains(e.target as Node)) {
      hideTaskPanel(reminderPanel);
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
    copyBtn.type = "button";
    copyBtn.setAttribute("aria-label", "复制待办内容");
    copyBtn.title = "复制";
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.taskText).then(() => {
        showSpeech("内容已复制！", 2000);
      }).catch(() => {});
    });

    const doneBtn = document.createElement("button");
    doneBtn.className = "todo-done-btn";
    doneBtn.type = "button";
    doneBtn.textContent = "完成";
    doneBtn.addEventListener("click", () => {
      removeTodoItem(item.id, false);
      el.style.opacity = "0";
      el.style.transition = "opacity 0.2s";
      setTimeout(() => el.remove(), 200);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(doneBtn);
    el.appendChild(text);
    el.appendChild(actions);
    list.appendChild(el);
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
    cancelBtn.type = "button";
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

    el.appendChild(text);
    el.appendChild(badge);
    el.appendChild(countdown);
    el.appendChild(actions);
    reminderList.appendChild(el);
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
      void updateSpeechBubbleWindowState(false);
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
      return;
    }

    // 立即清空输入并收起面板，给用户即时反馈
    input.value = "";
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
  kind: "platform" | "wall";
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
  nextTeleportAt: number;
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
const ROAM_VISUAL_SIDE_OVERHANG = 20;
const ROAM_VISUAL_TOP_OVERHANG = 8;
const ROAM_PLATFORM_TOP_TOLERANCE = 10;
const ROAM_PLATFORM_EDGE_PADDING = 8;
const ROAM_PLATFORM_MIN_WIDTH = 84;
const ROAM_PLATFORM_FOOT_SPREAD_MIN = 18;
const ROAM_PLATFORM_FOOT_SPREAD_MAX = 36;
const ROAM_ACTIVE_TELEPORT_MIN_DELAY_MS = 12000;
const ROAM_ACTIVE_TELEPORT_MAX_DELAY_MS = 22000;
const ROAM_ACTIVE_TELEPORT_CHANCE = 0.34;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPetVisualWindowPositionToBounds(x: number, y: number, width: number, height: number, bounds: RoamBounds): { x: number; y: number } {
  const visualRect = getPetVisualRectInWindow(width, height);
  const desiredVisualLeft = x + visualRect.left;
  const desiredVisualTop = y + visualRect.top;
  const clampedVisualLeft = clamp(
    desiredVisualLeft,
    bounds.left - ROAM_VISUAL_SIDE_OVERHANG,
    bounds.right - visualRect.width + ROAM_VISUAL_SIDE_OVERHANG,
  );
  const clampedVisualTop = clamp(
    desiredVisualTop,
    bounds.top - ROAM_VISUAL_TOP_OVERHANG,
    bounds.bottom - visualRect.height,
  );
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
    && !isTeleportAnimating
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
    || isTeleportAnimating
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

  if (makeFall && moved && isPetGravityEnabled()) {
    state.grounded = false;
    state.platformId = "";
    state.vy = Math.max(state.vy, 140);
    setRoamAction(engine, state, "fall");
  }
}

function clampRoamToBounds(state: RoamState): void {
  const visualRect = getPetVisualRectInWindow(state.width, state.height);
  const halfVisualWidth = visualRect.width / 2;
  const minX = state.bounds.left + halfVisualWidth - ROAM_VISUAL_SIDE_OVERHANG;
  const maxX = state.bounds.right - halfVisualWidth + ROAM_VISUAL_SIDE_OVERHANG;
  const minY = state.bounds.top + visualRect.height - ROAM_VISUAL_TOP_OVERHANG;
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

function getRoamFootSensors(state: RoamState): { left: number; right: number } {
  const visualRect = getPetVisualRectInWindow(state.width, state.height);
  const footSpread = clamp(
    Math.round(visualRect.width * 0.18),
    ROAM_PLATFORM_FOOT_SPREAD_MIN,
    ROAM_PLATFORM_FOOT_SPREAD_MAX,
  );
  return {
    left: state.x - footSpread,
    right: state.x + footSpread,
  };
}

function randomRoamTeleportDelay(): number {
  return randomBetween(ROAM_ACTIVE_TELEPORT_MIN_DELAY_MS, ROAM_ACTIVE_TELEPORT_MAX_DELAY_MS);
}

function isStandableRoamPlatform(platform: RoamPlatform): boolean {
  return platform.kind !== "wall";
}

function getRoamPlatformSupport(state: RoamState, platform: RoamPlatform): { support: number; distance: number } | null {
  if (!isStandableRoamPlatform(platform)) return null;

  const distance = Math.abs(state.y - platform.top);
  if (distance > ROAM_PLATFORM_TOP_TOLERANCE) return null;

  const platformWidth = platform.right - platform.left;
  if (platformWidth < ROAM_PLATFORM_MIN_WIDTH) return null;

  const feet = getRoamFootSensors(state);
  const support = [
    feet.left,
    feet.right,
  ].reduce((count, footX) => (
    footX > platform.left + ROAM_PLATFORM_EDGE_PADDING && footX < platform.right - ROAM_PLATFORM_EDGE_PADDING
      ? count + 1
      : count
  ), 0);

  if (support === 0) return null;

  if (support === 1) {
    const centerMargin = Math.max(32, platformWidth * 0.12);
    if (Math.abs(state.x - (platform.left + platform.right) / 2) > centerMargin) {
      return null;
    }
  }

  return { support, distance };
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
  const nextPosition = clampPetVisualWindowPositionToBounds(position.x, position.y, size.width, size.height, bounds);
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
    if (!isStandableRoamPlatform(platform)) return false;
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
  if (!isPetGravityEnabled() && decision === "jump") {
    decision = "idle";
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
  if (!isPetGravityEnabled()) return;
  if (!state.grounded || !state.platformId || state.platformId === "__ground__") return;
  const platform = state.platforms.find((item) => item.id === state.platformId);
  if (!platform || !isStandableRoamPlatform(platform)) {
    state.grounded = false;
    state.platformId = "";
    return;
  }

  const support = getRoamPlatformSupport(state, platform);
  if (!support) {
    state.grounded = false;
    state.platformId = "";
  } else {
    state.y = Math.min(state.y, platform.top);
  }
}

function chooseTeleportTarget(state: RoamState): { x: number; y: number; grounded: boolean; platformId: string } | null {
  const visualRect = getPetVisualRectInWindow(state.width, state.height);
  const halfVisualWidth = visualRect.width / 2;
  const standablePlatforms = state.platforms.filter((platform) => {
    if (!isStandableRoamPlatform(platform)) return false;
    if (platform.right - platform.left < ROAM_PLATFORM_MIN_WIDTH) return false;
    const center = (platform.left + platform.right) / 2;
    return Math.abs(center - state.x) > 180 || Math.abs(platform.top - state.y) > 96;
  });

  const useGround = standablePlatforms.length === 0 || Math.random() < 0.28;
  if (useGround) {
    const minX = state.bounds.left + halfVisualWidth;
    const maxX = state.bounds.right - halfVisualWidth;
    const x = clamp(randomBetween(Math.min(minX, maxX), Math.max(minX, maxX)), Math.min(minX, maxX), Math.max(minX, maxX));
    return {
      x,
      y: state.bounds.bottom,
      grounded: true,
      platformId: "__ground__",
    };
  }

  const platform = standablePlatforms[Math.floor(Math.random() * standablePlatforms.length)];
  const minX = platform.left + halfVisualWidth - ROAM_VISUAL_SIDE_OVERHANG;
  const maxX = platform.right - halfVisualWidth + ROAM_VISUAL_SIDE_OVERHANG;
  const x = clamp(randomBetween(Math.min(minX, maxX), Math.max(minX, maxX)), Math.min(minX, maxX), Math.max(minX, maxX));
  return {
    x,
    y: platform.top,
    grounded: true,
    platformId: platform.id,
  };
}

async function triggerActiveTeleport(engine: PetEngine, state: RoamState): Promise<boolean> {
  if (isTeleportAnimating || isRecallAnimating || isExiting || isManualPetControlActive() || isPetMenuOpen || isPetPanelOpen || isBlockingPetPanelOpen()) {
    return false;
  }

  const target = chooseTeleportTarget(state);
  if (!target) return false;

  const container = document.getElementById("pet-container") as HTMLElement | null;
  if (!container) return false;

  const previousVisibility = container.style.visibility;
  const teleportAt = performance.now();
  isTeleportAnimating = true;
  state.nextTeleportAt = teleportAt + randomRoamTeleportDelay();
  state.nextDecisionAt = teleportAt + 650;

  try {
    await playRecallDisappearEffect();
    container.style.visibility = "hidden";

    const previousX = state.x;
    state.x = target.x;
    state.y = target.y;
    state.vx = 0;
    state.vy = 0;
    state.grounded = target.grounded;
    state.platformId = target.platformId;
    state.facing = target.x < previousX ? "left" : "right";
    state.action = "idle";
    state.lastWindowSyncAt = teleportAt;
    applyRoamFacing(state);
    clampRoamToBounds(state);
    await applyRoamWindowPosition(state);
    engine.applyState("idle");
    return true;
  } catch (err) {
    console.warn("active roam teleport failed:", err);
    return false;
  } finally {
    resetRecallDisappearEffect(container);
    container.style.visibility = previousVisibility;
    isTeleportAnimating = false;
  }
}

function findStandingPlatform(state: RoamState): RoamPlatform | null {
  let bestPlatform: RoamPlatform | null = null;
  let bestSupport = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const platform of state.platforms) {
    const support = getRoamPlatformSupport(state, platform);
    if (!support) continue;

    if (support.support > bestSupport || (support.support === bestSupport && support.distance < bestDistance)) {
      bestPlatform = platform;
      bestSupport = support.support;
      bestDistance = support.distance;
    }
  }

  return bestPlatform;
}

function refreshGroundingAfterDrag(engine: PetEngine, state: RoamState): void {
  if (!isPetGravityEnabled()) {
    state.vy = 0;
    state.grounded = true;
    state.platformId = "";
    if (state.action === "fall" || state.action === "jump") setRoamAction(engine, state, "idle");
    return;
  }

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
  const position = clampPetVisualWindowPositionToBounds(
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

  const gravityEnabled = isPetGravityEnabled();
  if (!gravityEnabled) {
    state.grounded = true;
    state.platformId = "";
    state.vy = 0;
    if (state.action === "fall" || state.action === "jump") setRoamAction(engine, state, "idle");
  }

  const activityLevel = localStorage.getItem("pet_activity_level") || "middle";
  if (!pauseRoamDecisions && activityLevel === "active" && now >= state.nextTeleportAt) {
    if (Math.random() < ROAM_ACTIVE_TELEPORT_CHANCE) {
      const teleported = await triggerActiveTeleport(engine, state);
      if (teleported) return;
    }
    state.nextTeleportAt = now + randomRoamTeleportDelay();
  }

  if (gravityEnabled && recentlyDragged && now - state.lastPlatformScanAt > 120) {
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

  if (gravityEnabled && now - state.lastPlatformScanAt > 3500) {
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

  if (gravityEnabled && !state.grounded) {
    state.vy = Math.min(1400, state.vy + ROAM_GRAVITY * dt);
  } else if (!["walk", "sprint"].includes(state.action)) {
    state.vx *= 0.85;
    if (Math.abs(state.vx) < 1) state.vx = 0;
  }

  const previousY = state.y;
  let nextX = state.x + state.vx * dt;
  let nextY = state.y + state.vy * dt;

  const visualRect = getPetVisualRectInWindow(state.width, state.height);
  const halfVisualWidth = visualRect.width / 2;
  const minX = state.bounds.left + halfVisualWidth - ROAM_VISUAL_SIDE_OVERHANG;
  const maxX = state.bounds.right - halfVisualWidth + ROAM_VISUAL_SIDE_OVERHANG;

  if (nextX <= minX) {
    nextX = minX;
    state.vx = Math.abs(state.vx) * 0.35;
    state.facing = "right";
    applyRoamFacing(state);
  } else if (nextX >= maxX) {
    nextX = maxX;
    state.vx = -Math.abs(state.vx) * 0.35;
    state.facing = "left";
    applyRoamFacing(state);
  }

  state.x = nextX;
  state.y = nextY;
  clampRoamToBounds(state);

  if (gravityEnabled) updateRoamPlatformAttachment(state);

  if (gravityEnabled && !state.grounded && state.vy >= 0) {
    for (const platform of state.platforms) {
      if (!isStandableRoamPlatform(platform)) continue;
      if (previousY <= platform.top && state.y >= platform.top && getRoamPlatformSupport(state, platform)) {
        settleRoamOnPlatform(engine, state, platform);
        break;
      }
    }
  }

  if (gravityEnabled && !state.grounded && state.y >= state.bounds.bottom) {
    state.y = state.bounds.bottom;
    state.vy = 0;
    state.grounded = true;
    state.platformId = "__ground__";
    if (state.action === "fall" || state.action === "jump") setRoamAction(engine, state, "idle");
  }

  if (gravityEnabled && !state.grounded && state.vy > 0 && state.action !== "fall") {
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
    nextTeleportAt: performance.now() + randomRoamTeleportDelay(),
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
    ? getPrimaryPetId()
    : null;
  const projectPetId = params.get("petId") || summonedPetId || primaryPetId;
  if (projectPetId === "doro") {
    return {
      spritesheetUrl: new URL("../builtin-pets/doro/spritesheet_edited.webp", import.meta.url).href,
      manifest: await fetch(new URL("../builtin-pets/doro/pet.json", import.meta.url).href).then((res) => res.json() as Promise<PetManifest>),
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

const RECALL_EFFECT_CLASSES = ["recall-puff"] as const;
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
  const duration = 560 + Math.round(Math.random() * 120);
  const startedAt = Date.now();
  container.style.setProperty("--recall-drift-x", `${Math.round((Math.random() * 2 - 1) * 10)}px`);
  container.style.setProperty("--recall-tilt", `${(Math.random() * 6 - 3).toFixed(1)}deg`);
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
    stopCurrentPetActivitiesImmediately();
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

  const positionMenu = async (): Promise<void> => {
    menu.style.visibility = "hidden";
    menu.classList.add("show");
    const menuRect = menu.getBoundingClientRect();
    const petRect = document.getElementById("pet-container")?.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const [winPos, monitor, scaleFactor] = await Promise.all([
      appWindow.outerPosition(),
      currentMonitor(),
      appWindow.scaleFactor(),
    ]);

    let rightEdgeFitsOnScreen = true;
    let leftEdgeFitsOnScreen = true;

    if (monitor && petRect) {
      const winLogicalX = winPos.x / scaleFactor;
      const monitorLogicalRight = (monitor.position.x + monitor.size.width) / scaleFactor;
      const monitorLogicalLeft = monitor.position.x / scaleFactor;

      const rightMenuScreenX = winLogicalX + petRect.right + gap + menuRect.width + margin;
      const leftMenuScreenX = winLogicalX + petRect.left - gap - menuRect.width - margin;

      rightEdgeFitsOnScreen = rightMenuScreenX <= monitorLogicalRight;
      leftEdgeFitsOnScreen = leftMenuScreenX >= monitorLogicalLeft;
    }

    const baseTop = petRect
      ? petRect.top + Math.max(8, petRect.height * 0.08)
      : margin;

    let left = petRect ? petRect.right + gap : margin;

    if (petRect) {
      const fitsWindowRight = left + menuRect.width + margin <= viewportWidth;
      const rightOk = fitsWindowRight && rightEdgeFitsOnScreen;

      if (!rightOk) {
        left = petRect.left - menuRect.width - gap;
        const fitsWindowLeft = left >= margin;
        const leftOk = fitsWindowLeft && leftEdgeFitsOnScreen;

        if (!leftOk && rightEdgeFitsOnScreen) {
          left = petRect.right + gap;
        }
      }
    }

    if (left + menuRect.width + margin > viewportWidth) {
      left = Math.max(margin, viewportWidth - menuRect.width - margin);
    }
    if (left < margin) {
      left = margin;
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
    await positionMenu();
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
    void showFocusPanel();
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

function getSpeechBubbleStyle(): string {
  const saved = localStorage.getItem(LS_SPEECH_BUBBLE_STYLE) || "1";
  return SPEECH_BUBBLE_STYLE_IDS.has(saved) ? saved : "1";
}

function applySpeechBubbleStyle(): void {
  const bubble = document.getElementById("pet-speech-bubble");
  if (!bubble) return;
  bubble.dataset.bubbleStyle = getSpeechBubbleStyle();
}

function showSpeech(text: string, durationMs: number, withSound = true): void {
  const bubble = document.getElementById("pet-speech-bubble");
  const bubbleText = bubble?.querySelector(".bubble-text") as HTMLElement | null;
  if (!bubble || !bubbleText || !text) return;

  if ((window as any).speechBubbleTimerId) clearTimeout((window as any).speechBubbleTimerId);

  applySpeechBubbleStyle();
  bubbleText.textContent = text;
  bubble.classList.add("show-bubble");
  if (withSound) playSound("bubble");

  void updateSpeechBubbleWindowState(true);

  (window as any).speechBubbleTimerId = setTimeout(() => {
    bubble.classList.remove("show-bubble");
    (window as any).speechBubbleTimerId = null;
    void updateSpeechBubbleWindowState(false);
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
  if (localStorage.getItem(LS_PET_GRAVITY_ENABLED) === null) {
    localStorage.setItem(LS_PET_GRAVITY_ENABLED, "true");
  }
  if (localStorage.getItem(LS_MERIT_TEXT) === null) {
    localStorage.setItem(LS_MERIT_TEXT, MERIT_DEFAULT_TEXT);
  }
  localStorage.setItem(LS_MERIT_ENABLED, "false");
  applySpeechBubbleStyle();
  window.addEventListener("storage", (event) => {
    if (event.key === LS_SPEECH_BUBBLE_STYLE) {
      applySpeechBubbleStyle();
      const styleNameMap: Record<string, string> = {
        "1": "暖黄双边",
        "2": "星河物语",
        "3": "云雾缭绕",
        "5": "烈焰红唇",
        "6": "森林私语",
        "7": "落日余晖",
        "8": "深海探秘",
        "9": "极光幻境"
      };
      const styleName = styleNameMap[event.newValue || "1"] || "默认";
      showSpeech(`已切换为【${styleName}】气泡皮肤`, 3000);
    }
  });

  const spriteEl = document.getElementById("pet-sprite");
  if (!spriteEl) {
    console.error("Pet sprite element not found");
    return;
  }

  const { spritesheetUrl, manifest } = await loadPetAssets();
  const engine = new PetEngine(spriteEl, atlasFromManifest(manifest), spritesheetUrl);
  (window as any).__petEngine = engine;
  
  const meritVisualEl = document.getElementById("merit-panel-pet-visual");
  if (meritVisualEl) {
    const meritEngine = new PetEngine(meritVisualEl, atlasFromManifest(manifest), spritesheetUrl);
    (window as any).__meritPanelEngine = meritEngine;
    if (meritEngine.hasState("merit")) {
      meritEngine.applyState("merit");
    } else {
      meritEngine.applyState("idle");
    }
  }

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
  const stopActivitiesOnWindowExit = () => {
    stopCurrentPetActivitiesImmediately();
    engine.destroy();
    const meritEngine = (window as any).__meritPanelEngine as PetEngine | undefined;
    meritEngine?.destroy();
  };
  window.addEventListener("pagehide", stopActivitiesOnWindowExit);
  window.addEventListener("beforeunload", stopActivitiesOnWindowExit);

  setTimeout(() => checkGitHubStatus(), 3000);
  setInterval(() => checkGitHubStatus(), 5 * 60 * 1000);
  console.log("LingoPet engine initialized");
}

// ── File Drop -> Recycle Bin ──

function setupFileDrop(): void {
  const container = document.getElementById("pet-container");
  if (!container) return;

  const handleDroppedPaths = async (paths: string[]): Promise<void> => {
    const validPaths = paths.filter(Boolean);
    if (validPaths.length === 0) return;

    try {
      await invoke("move_to_trash", { paths: validPaths });
    } catch (err) {
      console.error("move_to_trash failed:", err);
      showSpeech("文件没能送进回收站，请稍后再试。", 3000);
      return;
    }

    container.classList.remove("anim-swallow");
    void container.offsetWidth;
    container.classList.add("anim-swallow");
    setTimeout(() => container.classList.remove("anim-swallow"), 500);

    playSound("crunch");
    showSpeech(validPaths.length > 1 ? `已送走 ${validPaths.length} 个文件。` : "文件已送进回收站。", 3000);
  };

  void getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      container.classList.add("drag-over");
      return;
    }
    if (event.payload.type === "leave") {
      container.classList.remove("drag-over");
      return;
    }

    container.classList.remove("drag-over");
    void handleDroppedPaths(event.payload.paths);
  }).catch((err) => {
    console.warn("tauri drag-drop listener failed:", err);
  });

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

    await handleDroppedPaths(paths);
  });
}

main();
