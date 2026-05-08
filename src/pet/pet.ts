import "./pet.css";
import { getCurrentWindow, cursorPosition } from "@tauri-apps/api/window";
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
}

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

    this.applyState("idle");
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
    this.currentFrame = 0;
    this.showFrame(0);
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
      this.currentFrame = (this.currentFrame + 1) % anim.frames;
      this.showFrame(this.currentFrame);
      const delay = anim.frameDurations[this.currentFrame];
      this.timerHandle = window.setTimeout(advance, delay);
    };
    const firstDelay = anim.frameDurations[0];
    this.timerHandle = window.setTimeout(advance, firstDelay);
  }

  private stop(): void {
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  setSpritesheet(url: string): void {
    this.spriteEl.style.backgroundImage = `url("${url}")`;
    this.applyState("idle");
  }

  destroy(): void {
    this.stop();
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

// ── Drag & Physics (State Machine) ──

let isMouseDown = false;
let hasStartedDragging = false;
let dragThreshold = 5;
let mouseDownX = 0;
let mouseDownY = 0;

// ── Bio-Clock State ──
let isExiting = false;
let lastActivityTime = Date.now();

// ── Always-on-Top State (persisted) ──
let isAlwaysOnTop = localStorage.getItem("pet-always-on-top") !== "false";

function forceEndDrag(engine: PetEngine, container: HTMLElement): void {
  if (hasStartedDragging) {
    engine.applyState("idle");
    container.classList.remove("is-lifting");
    container.classList.add("is-dropping");
    setTimeout(() => {
      container.classList.remove("is-dropping");
    }, 200);
  }
  isMouseDown = false;
  hasStartedDragging = false;
  lastActivityTime = Date.now();
}

async function setupDrag(engine: PetEngine): Promise<void> {
  const hitbox = document.getElementById("pet-hitbox");
  const container = document.getElementById("pet-container");
  if (!hitbox || !container) return;

  const appWindow = getCurrentWindow();

  // mousedown - 潜伏阶段
  hitbox.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isExiting) return;

    isMouseDown = true;
    hasStartedDragging = false;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    lastActivityTime = Date.now();

    container.classList.remove("is-dropping");
    container.classList.add("is-lifting");
  });

  // mousemove - 拖拽判定 + 系统中断兜底
  window.addEventListener("mousemove", async (e) => {
    // 兜底检测：系统吞噬 mouseup 后的状态复位
    if (isMouseDown && e.buttons === 0) {
      forceEndDrag(engine, container);
      return;
    }

    if (!isMouseDown || hasStartedDragging || isExiting) return;

    const dx = e.clientX - mouseDownX;
    const dy = e.clientY - mouseDownY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > dragThreshold) {
      hasStartedDragging = true;
      // 切换到奔跑动画
      engine.applyState("running");
      // 交出拖拽权
      await appWindow.startDragging();
    }
  });

  // mouseup - 最终交互判定
  window.addEventListener("mouseup", (e) => {
    if (!isMouseDown) return;

    if (hasStartedDragging) {
      forceEndDrag(engine, container);
    } else {
      container.classList.remove("is-lifting");
      spawnParticles(e.clientX, e.clientY);
    }

    isMouseDown = false;
    hasStartedDragging = false;
    lastActivityTime = Date.now();
  });
}

// ── Pet Loading ──

async function loadSpritesheetUrl(): Promise<string> {
  try {
    const pets = await invoke<PetManifest[]>("list_pets");
    if (pets.length > 0) {
      const pet = pets[0];
      const petDir = await invoke<string>("get_pet_dir", { petId: pet.id });
      const spritesheetPath = `${petDir}/${pet.spritesheetPath}`;
      const url = convertFileSrc(spritesheetPath);
      console.log(`Loading pet: ${pet.displayName} from ${url}`);
      return url;
    }
  } catch (e) {
    console.warn("No imported pets found, using fallback:", e);
  }

  // Fallback: local test spritesheet
  return new URL("./spritesheet.webp", import.meta.url).href;
}

// ── Context Menu (Custom DOM) ──

async function openImportDialog(engine: PetEngine): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      filters: [{ name: "宠物包", extensions: ["zip"] }],
    });
    if (!file) return;

    const manifest = await invoke<PetManifest>("import_pet_zip", { zipPath: file });
    console.log(`Imported: ${manifest.displayName}`);

    const petDir = await invoke<string>("get_pet_dir", { petId: manifest.id });
    const url = convertFileSrc(`${petDir}/${manifest.spritesheetPath}`);
    engine.setSpritesheet(url);
  } catch (e) {
    console.error("Import failed:", e);
  }
}

async function setupContextMenu(engine: PetEngine): Promise<void> {
  const { Menu } = await import("@tauri-apps/api/menu");
  const appWindow = getCurrentWindow();
  const hitbox = document.getElementById("pet-hitbox");
  if (!hitbox) return;

  // Apply persisted always-on-top state on startup
  await appWindow.setAlwaysOnTop(isAlwaysOnTop);

  hitbox.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (isExiting) return;

    engine.applyState("idle");
    lastActivityTime = Date.now();

    // Eye icon: open (◉) when pinned, closed (◎) when unpinned
    const topLabel = isAlwaysOnTop ? "◉ 取消置顶" : "◎ 开启置顶";

    const menu = await Menu.new({
      items: [
        { id: "import", text: "导入宠物 (.zip)", action: () => openImportDialog(engine) },
        { item: "Separator" },
        { id: "idle", text: "待机", action: () => engine.applyState("idle") },
        { id: "waving", text: "打招呼", action: () => engine.applyState("waving") },
        { id: "jumping", text: "跳跃", action: () => engine.applyState("jumping") },
        { id: "running", text: "奔跑", action: () => engine.applyState("running") },
        { id: "failed", text: "失败", action: () => engine.applyState("failed") },
        { id: "waiting", text: "等待", action: () => engine.applyState("waiting") },
        { id: "review", text: "思考", action: () => engine.applyState("review") },
        { item: "Separator" },
        { id: "toggle-top", text: topLabel, action: async () => {
          isAlwaysOnTop = !isAlwaysOnTop;
          localStorage.setItem("pet-always-on-top", String(isAlwaysOnTop));
          await appWindow.setAlwaysOnTop(isAlwaysOnTop);
        }},
        { item: "Separator" },
        { id: "quit", text: "退出", action: () => {
          isExiting = true;
          engine.applyState("failed");
          setTimeout(() => exit(0), 3000);
        }},
      ],
    });

    await menu.popup();
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
    if (isExiting) return;
    const centerX = window.innerWidth / 2;
    spriteEl.style.transform = e.clientX < centerX ? "scaleX(-1)" : "scaleX(1)";
  });
}

// ── Bio-Clock Idle Mechanism ──

function setupBioClock(engine: PetEngine): void {
  let lastCursorX = -1;
  let lastCursorY = -1;
  let lastNightHour = -1;

  // Poll global cursor position via Tauri API
  setInterval(async () => {
    try {
      const pos = await cursorPosition();
      if (pos.x !== lastCursorX || pos.y !== lastCursorY) {
        lastCursorX = pos.x;
        lastCursorY = pos.y;
        lastActivityTime = Date.now();
      }
    } catch {
      // cursor_position may not be available, ignore
    }

    if (isExiting || isMouseDown || hasStartedDragging) return;

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
        if (!isExiting && engine.currentState === "review") {
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
    if (isExiting) return;
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

function showSpeech(text: string, durationMs: number): void {
  const bubble = document.getElementById("pet-speech-bubble");
  const bubbleText = bubble?.querySelector(".bubble-text") as HTMLElement | null;
  if (!bubble || !bubbleText || !text) return;

  bubbleText.textContent = text;
  bubble.classList.add("show-bubble");

  setTimeout(() => {
    bubble.classList.remove("show-bubble");
  }, durationMs);
}

// ── Init ──

async function main(): Promise<void> {
  const spriteEl = document.getElementById("pet-sprite");
  if (!spriteEl) {
    console.error("Pet sprite element not found");
    return;
  }

  const spritesheetUrl = await loadSpritesheetUrl();
  const engine = new PetEngine(spriteEl, CODEX_ATLAS, spritesheetUrl);
  (window as any).__petEngine = engine;

  // Boot ceremony: wave then idle, with speech bubble
  engine.applyState("waving");
  showSpeech(checkSpecialDayAndTime(), 5000);
  setTimeout(() => {
    if (!isExiting) engine.applyState("idle");
  }, 5000);

  setupDrag(engine);
  setupContextMenu(engine);
  setupEyeTracking();
  setupBioClock(engine);
  setupWakeUp(engine);
  console.log("VibePet engine initialized");
}

main();
