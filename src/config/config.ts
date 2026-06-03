import "./style.css";
import style1Ornaments from "../assets/ui/speech-bubble-style-1-ornaments.png";
import style2Ornaments from "../assets/ui/speech-bubble-style-2-ornaments.png";
import style3Ornaments from "../assets/ui/speech-bubble-style-3-ornaments.png";
import style5Ornaments from "../assets/ui/speech-bubble-style-5-ornaments.png";
import style6Ornaments from "../assets/ui/speech-bubble-style-6-ornaments.png";
import style7Ornaments from "../assets/ui/speech-bubble-style-7-ornaments.png";
import style8Ornaments from "../assets/ui/speech-bubble-style-8-ornaments.png";
import style9Ornaments from "../assets/ui/speech-bubble-style-9-ornaments.png";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

// ==========================================
// 创意工坊 & 雪碧图编辑器 新增类型与全局常量
// ==========================================
interface EditorAction {
  name: string;
  key?: ModeActionKey;
  frameDurations?: number[];
  frames: (HTMLCanvasElement | null)[];
  stripSource?: HTMLCanvasElement;
  stripFrameCount?: number;
  stripOffsets?: { x: number; y: number }[];
  pendingFramePngSave?: boolean;
}

interface WorkshopItem {
  petId: string;
  actionType: string;
  title: string;
  author: string;
  promptUsed: string;
  framesCount: number;
  frameDuration: number;
  imageUrl: string;
}

type ModeActionKey = "focus" | "music" | "merit";

interface ModeActionPreset {
  label: string;
  frames: number;
  frameDurations: number[];
}

interface FrameAnimation {
  row: number;
  frames: number;
  frameDurations: number[];
}

const WORKSHOP_SHARE_API = "https://api.1024588.xyz/api/share";
const EMPTY_PETS_IMAGE = new URL("./empty-pets.png", import.meta.url).href;

const LS_PET_ASSETS_VERSION = "pet_assets_version";

const ATLAS_COLS = 8;
const ATLAS_CELL_WIDTH = 192;
const ATLAS_CELL_HEIGHT = 208;

const DEFAULT_ACTION_NAMES = [
  "待机", "向右跑", "向左跑", "打招呼", "跳跃", "哭泣", "等待", "工作", "审阅"
];

const MODE_ACTION_PRESETS: Record<ModeActionKey, ModeActionPreset> = {
  focus: {
    label: "专注模式",
    frames: 4,
    frameDurations: [300, 300, 360, 300]
  },
  music: {
    label: "音乐律动",
    frames: 8,
    frameDurations: [140, 140, 140, 140, 140, 140, 180, 240]
  },
  merit: {
    label: "功德模式",
    frames: 4,
    frameDurations: [150, 150, 150, 300]
  }
};

const DEFAULT_PREVIEW_ANIMATIONS: FrameAnimation[] = [
  { row: 0, frames: 6, frameDurations: [280, 110, 110, 140, 140, 320] },
  { row: 1, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { row: 2, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { row: 3, frames: 4, frameDurations: [140, 140, 140, 280] },
  { row: 4, frames: 5, frameDurations: [140, 140, 140, 140, 280] },
  { row: 5, frames: 8, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
  { row: 6, frames: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
  { row: 7, frames: 6, frameDurations: [120, 120, 120, 120, 120, 220] },
  { row: 8, frames: 6, frameDurations: [150, 150, 150, 150, 150, 280] },
];


const API_BASE = "https://codexpet.xyz";
const PAGE_SIZE = 30;
const LS_PET_SIZE_SCALE = "pet_size_scale";
const LS_API_ENDPOINT = "pet_api_endpoint";
const LS_API_KEY = "pet_api_key";
const LS_API_MODEL = "pet_api_model";
const LS_CHAT_MODE = "pet_chat_mode";
const LS_PERSONA_MODE = "pet_persona_mode";
const LS_CUSTOM_PERSONA = "pet_custom_persona_text";
const LS_MUSIC_RHYTHM_SYNC_MODE = "pet_music_rhythm_sync_mode";
const LS_ALLOW_MULTIPLE_PETS = "pet_allow_multiple_instances";
const LS_PRIMARY_PET_ID = "pet_primary_project_id";
const LS_SUMMONED_PET_IDS = "pet_summoned_pet_ids";
const LS_FAVORITE_PET_IDS = "pet_favorite_pet_ids";
const LS_CUSTOM_TAGS = "pet_custom_tags";
const LS_PET_WINDOW_STATE_VERSION = "pet_window_state_version";
const LS_PET_VOLUME = "pet-volume";
const LS_SPEECH_BUBBLE_STYLE = "pet_speech_bubble_style";
const LS_PET_GRAVITY_ENABLED = "pet_gravity_enabled";
const BUILTIN_DORO_PET: ProjectPet = {
  id: "doro",
  displayName: "Doro",
  description: "内置默认桌宠",
  spritesheetPath: "spritesheet_edited.webp",
  kind: "creature",
  version: "v1.0.0",
  dir: "内置资源",
  spritesheetFile: "",
  builtin: true,
  animations: {
    focus: {
      row: 11,
      frames: 4,
      frameDurations: [300, 300, 300, 300],
    },
    merit: {
      row: 9,
      frames: 4,
      frameDurations: [150, 150, 150, 300],
    },
    music: {
      row: 10,
      frames: 8,
      frameDurations: [140, 140, 140, 140, 140, 140, 140, 140],
    },
  },
};
const BUILTIN_PROJECT_PETS = [BUILTIN_DORO_PET];

interface MarketPet {
  slug: string;
  display_name?: string;
  description?: string;
  author_name?: string;
  version?: string;
  download_count?: number;
  downloadUrl?: string;
  spritesheetUrl?: string;
  kind?: string;
}

interface ProjectPet {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  kind?: string;
  version?: string;
  dir: string;
  spritesheetFile: string;
  builtin?: boolean;
  animations?: any;
}

interface SummonedPetWindow {
  label: string;
  petId: string;
  primary?: boolean;
}

type ViewName = "mine" | "recall" | "market" | "settings" | "editor" | "workshop";
type SortName = "hot" | "latest" | "downloads";

type EditorPreviewBackground = "checker" | "paper" | "gray" | "ink" | "mint" | "sky";
const LS_EDITOR_PREVIEW_BACKGROUND = "pet_editor_preview_background";

const els = {
  title: document.getElementById("view-title") as HTMLHeadingElement,
  subtitle: document.getElementById("view-subtitle") as HTMLParagraphElement,
  refresh: document.getElementById("refresh-btn") as HTMLButtonElement,
  navItems: [...document.querySelectorAll<HTMLButtonElement>(".nav-item")],
  views: {
    mine: document.getElementById("mine-view") as HTMLElement,
    recall: document.getElementById("recall-view") as HTMLElement,
    market: document.getElementById("market-view") as HTMLElement,
    settings: document.getElementById("settings-view") as HTMLElement,
    workshop: document.getElementById("workshop-view") as HTMLElement,
    editor: document.getElementById("editor-view") as HTMLElement,
  },
  marketSearch: document.getElementById("search-input") as HTMLInputElement,
  mineSearch: document.getElementById("mine-search-input") as HTMLInputElement,
  sortButtons: [...document.querySelectorAll<HTMLButtonElement>(".sort")],
  marketStatus: document.getElementById("market-status") as HTMLParagraphElement,
  marketGrid: document.getElementById("market-grid") as HTMLDivElement,
  marketPagination: document.getElementById("market-pagination") as HTMLDivElement,
  mineStatus: document.getElementById("mine-status") as HTMLParagraphElement,
  myPetsList: document.getElementById("my-pets-list") as HTMLDivElement,
  minePagination: document.getElementById("mine-pagination") as HTMLDivElement,
  mineTagsList: document.getElementById("mine-tags-list") as HTMLDivElement,
  addTagBtn: document.getElementById("add-tag-btn") as HTMLButtonElement,
  deleteTagBtn: document.getElementById("delete-tag-btn") as HTMLButtonElement,
  summonGroupBtn: document.getElementById("summon-group-btn") as HTMLButtonElement,
  importLocalPet: document.getElementById("import-local-pet") as HTMLButtonElement,
  activePetsStatus: document.getElementById("active-pets-status") as HTMLParagraphElement,
  activePetsList: document.getElementById("active-pets-list") as HTMLDivElement,
  refreshActivePets: document.getElementById("refresh-active-pets") as HTMLButtonElement,
  recallSelectedPets: document.getElementById("recall-selected-pets") as HTMLButtonElement,
  petsPath: document.getElementById("pets-path") as HTMLParagraphElement | null,
  settingsPetsPath: document.getElementById("settings-pets-path") as HTMLParagraphElement,
  openPetsDir: document.getElementById("open-pets-dir") as HTMLButtonElement | null,
  settingsOpenPetsDir: document.getElementById("settings-open-pets-dir") as HTMLButtonElement,
  autostartToggle: document.getElementById("autostart-toggle") as HTMLInputElement,
  alwaysTopToggle: document.getElementById("always-top-toggle") as HTMLInputElement,
  gravityModeToggle: document.getElementById("gravity-mode-toggle") as HTMLInputElement,
  petInstanceModeRadios: [...document.querySelectorAll<HTMLInputElement>('input[name="pet-instance-mode"]')],
  petActivityLevelRadios: [...document.querySelectorAll<HTMLInputElement>('input[name="pet-activity-level"]')],
  musicRhythmSyncRadios: [...document.querySelectorAll<HTMLInputElement>('input[name="music-rhythm-sync"]')],
  sizePresets: [...document.querySelectorAll<HTMLButtonElement>(".size-presets button")],
  sizeSlider: document.getElementById("manager-size-slider") as HTMLInputElement,
  sizeInput: document.getElementById("manager-size-input") as HTMLInputElement,
  sizeText: document.getElementById("manager-size-text") as HTMLSpanElement,
  volumeSlider: document.getElementById("manager-volume-slider") as HTMLInputElement,
  volumeInput: document.getElementById("manager-volume-input") as HTMLInputElement,
  volumeText: document.getElementById("manager-volume-text") as HTMLSpanElement,
  chatMode: document.getElementById("chat-mode-select") as HTMLSelectElement,
  personaField: document.getElementById("persona-setting-field") as HTMLLabelElement,
  persona: document.getElementById("persona-select") as HTMLSelectElement,
  customPersonaField: document.getElementById("custom-persona-field") as HTMLLabelElement,
  customPersona: document.getElementById("custom-persona-input") as HTMLTextAreaElement,
  apiConfigFields: document.getElementById("api-config-fields") as HTMLDivElement,
  apiEndpoint: document.getElementById("api-endpoint-input") as HTMLInputElement,
  apiKey: document.getElementById("api-key-input") as HTMLInputElement,
  apiModel: document.getElementById("api-model-input") as HTMLInputElement,
  apiModelSelect: document.getElementById("api-model-select") as HTMLSelectElement,
  fetchModels: document.getElementById("fetch-models-btn") as HTMLButtonElement,
  toggleApiKeyVisibility: document.getElementById("toggle-api-key-visibility") as HTMLButtonElement,
  testApi: document.getElementById("test-api-btn") as HTMLButtonElement,
  apiConfigStatus: document.getElementById("api-config-status") as HTMLParagraphElement,
  onlinePetCount: document.getElementById("online-pet-count") as HTMLElement,
  onlinePetAvatars: document.getElementById("online-pet-avatars") as HTMLDivElement,
  onlinePetAction: document.getElementById("online-pet-action") as HTMLButtonElement,
  speechBubbleStyleRadios: [...document.querySelectorAll<HTMLInputElement>('input[name="speech-bubble-style"]')],

  // 创意工坊
  workshopGrid: document.getElementById("workshop-grid") as HTMLDivElement,
  workshopSearch: document.getElementById("workshop-search-input") as HTMLInputElement,
  workshopActionFilter: document.getElementById("workshop-action-filter") as HTMLSelectElement,
  workshopStatus: document.getElementById("workshop-status") as HTMLParagraphElement,

  // 雪碧图编辑器
  editorView: document.getElementById("editor-view") as HTMLElement,
  editorTopbarActions: document.getElementById("editor-topbar-actions") as HTMLDivElement,
  editorPetName: document.getElementById("editor-pet-name") as HTMLParagraphElement,
  editorStatus: document.getElementById("editor-status") as HTMLParagraphElement,
  editorFrameTitle: document.getElementById("editor-frame-title") as HTMLHeadingElement,
  editorFrameCanvas: document.getElementById("editor-frame-canvas") as HTMLCanvasElement,
  editorGrid: document.getElementById("editor-grid") as HTMLDivElement,
  editorBack: document.getElementById("editor-back-btn") as HTMLButtonElement,
  editorSave: document.getElementById("editor-save-btn") as HTMLButtonElement,
  editorUpload: document.getElementById("editor-upload-input") as HTMLInputElement,
  editorReplace: document.getElementById("editor-replace-btn") as HTMLButtonElement,
  editorEraser: document.getElementById("editor-eraser-btn") as HTMLButtonElement,
  editorEraserSize: document.getElementById("editor-eraser-size") as HTMLInputElement,
  editorEraserSizeValue: document.getElementById("editor-eraser-size-value") as HTMLSpanElement,
  editorEraserUndo: document.getElementById("editor-eraser-undo-btn") as HTMLButtonElement,
  editorEraserCursor: document.getElementById("editor-eraser-cursor") as HTMLDivElement,
  editorZoomSlider: document.getElementById("editor-zoom-slider") as HTMLInputElement,
  editorZoomInput: document.getElementById("editor-zoom-input") as HTMLInputElement,
  editorPreviewBackgroundRadios: [...document.querySelectorAll<HTMLInputElement>('input[name="editor-preview-background"]')],
  editorClear: document.getElementById("editor-clear-btn") as HTMLButtonElement,
  editorCopy: document.getElementById("editor-copy-btn") as HTMLButtonElement,
  editorPaste: document.getElementById("editor-paste-btn") as HTMLButtonElement,
  editorMoveUndo: document.getElementById("editor-move-undo-btn") as HTMLButtonElement,
  editorNudgeButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-frame-nudge]")],
  editorModePresets: [...document.querySelectorAll<HTMLButtonElement>(".mode-action-preset")],
  editorAlignAction: document.getElementById("editor-align-action-btn") as HTMLButtonElement,
  actionStripUpload: document.getElementById("action-strip-upload-input") as HTMLInputElement,
  actionStripFrameCount: document.getElementById("action-strip-frame-count") as HTMLInputElement,
  actionStripImport: document.getElementById("action-strip-import-btn") as HTMLButtonElement,
  actionStripShare: document.getElementById("action-strip-share-btn") as HTMLButtonElement,
  promptCopy: document.getElementById("prompt-copy-btn") as HTMLButtonElement,
  imagePromptOutput: document.getElementById("image-prompt-output") as HTMLTextAreaElement,

};

const state = {
  view: "mine" as ViewName,
  sort: "hot" as SortName,
  marketPage: 1,
  marketTotal: 0,
  marketFilterKey: "",
  minePage: 1,
  currentMineTag: "all" as string,
  currentWorkshopTag: "all" as string, // 新增的创意工坊当前筛选标签
  marketPets: [] as MarketPet[],
  projectPets: [] as ProjectPet[],
  activePetWindows: [] as SummonedPetWindow[],
  selectedRecallLabels: new Set<string>(),
  downloading: new Set<string>(),

  editorPet: null as ProjectPet | null,
  editorActions: [] as EditorAction[],
  editorSelectedRow: 0,
  editorSelectedCol: 0,
  editorClipboard: null as HTMLCanvasElement | null,
  editorPreviewMode: "frame" as "frame" | "action",
  editorPreviewFrame: 0,
  editorPreviewTimer: null as number | null,
  editorSelectionType: "cell" as "cell" | "action",
  editorEraserEnabled: false,
  editorErasing: false,
  editorErasePointerId: null as number | null,
  editorEraseLastPoint: null as { x: number; y: number } | null,
  editorEraseBrushSize: 14,
  editorEraserUndoFrame: null as HTMLCanvasElement | null,
  editorEraserUndoRow: 0,
  editorEraserUndoCol: 0,
  editorMoveUndoFrame: null as HTMLCanvasElement | null,
  editorMoveUndoRow: 0,
  editorMoveUndoCol: 0,
  editorMoveUndoStripOffset: null as { x: number; y: number } | null,
  editorMoving: false,
  editorMovePointerId: null as number | null,
  editorMoveOrigin: null as { x: number; y: number } | null,
  editorMoveSourceFrame: null as HTMLCanvasElement | null,
  editorMoveSourceOffset: null as { x: number; y: number } | null,
  editorMoveChanged: false,
  editorDirty: false,
  editorZoomScale: 1.0,
  editorPreviewBackground: (localStorage.getItem(LS_EDITOR_PREVIEW_BACKGROUND) as EditorPreviewBackground) || "checker",

  // 创意工坊
  workshopItems: [] as WorkshopItem[],
  workshopSearchQuery: "",
  workshopFilterType: "all",

};

let marketRequestSeq = 0;
let marketSearchTimer: number | null = null;

function clearMarketSearchTimer(): void {
  if (marketSearchTimer !== null) {
    window.clearTimeout(marketSearchTimer);
    marketSearchTimer = null;
  }
}

function getMarketFilterKey(): string {
  return `${state.sort}::${els.marketSearch.value.trim().toLowerCase()}`;
}

function getMarketTotalCount(): number {
  return state.marketTotal || state.marketPets.length;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function saveApiKey(key: string): Promise<void> {
  if (!isTauriRuntime()) {
    if (key) localStorage.setItem(LS_API_KEY, key);
    else localStorage.removeItem(LS_API_KEY);
    return;
  }
  if (key) {
    await invoke("set_api_key", { key });
    localStorage.removeItem(LS_API_KEY);
  } else {
    await invoke("delete_api_key");
  }
}

async function getApiKey(): Promise<string> {
  if (!isTauriRuntime()) {
    return localStorage.getItem(LS_API_KEY) || "";
  }
  return await invoke<string | null>("get_api_key") || "";
}

interface ActiveMessage {
  id: string;
  type: "success" | "error" | "info";
  text: string;
  el: HTMLDivElement;
  timer: number;
}
let activeMessages: ActiveMessage[] = [];

function destroyMessage(id: string): void {
  const index = activeMessages.findIndex(m => m.id === id);
  if (index === -1) return;
  const msg = activeMessages[index];
  msg.el.classList.remove("show");
  msg.el.addEventListener("transitionend", () => {
    msg.el.remove();
  }, { once: true });

  activeMessages.splice(index, 1);
  repositionMessages();
}

function repositionMessages(): void {
  activeMessages.forEach((msg, i) => {
    const top = 20 + i * 55;
    msg.el.style.top = `${top}px`;
    msg.el.style.transform = `translateX(-50%)`;
  });
}

function showMessage(text: string, type: "success" | "error" | "info" = "info"): void {
  const lastMsg = activeMessages[activeMessages.length - 1];
  if (lastMsg && lastMsg.type === type && (lastMsg.text === text || (type === "info" && text.includes("位移")))) {
    lastMsg.text = text;
    const textEl = lastMsg.el.querySelector(".vibe-message-text");
    if (textEl) textEl.textContent = text;
    clearTimeout(lastMsg.timer);
    lastMsg.timer = window.setTimeout(() => {
      destroyMessage(lastMsg.id);
    }, 3000);
    return;
  }

  const id = Math.random().toString(36).substring(2, 9);
  const el = document.createElement("div");
  el.className = `vibe-message-container vibe-message-${type}`;

  const iconEl = document.createElement("span");
  iconEl.className = "vibe-message-icon";
  if (type === "success") {
    iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === "error") {
    iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else {
    iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  const textEl = document.createElement("span");
  textEl.className = "vibe-message-text";
  textEl.textContent = text;

  el.appendChild(iconEl);
  el.appendChild(textEl);
  document.body.appendChild(el);

  void el.offsetWidth;
  el.classList.add("show");

  const timer = window.setTimeout(() => {
    destroyMessage(id);
  }, 3000);

  activeMessages.push({ id, type, text, el, timer });
  repositionMessages();
}

function setStatus(el: HTMLElement, message = "", isError = false): void {
  if (el) {
    el.textContent = message;
    el.classList.toggle("error", isError);
  }

  if ((el === els.editorStatus || el === els.workshopStatus) && message.trim()) {
    // 屏蔽进入创意工坊、搜索或分类过滤等被动产生的同步及统计提示气泡，杜绝弹窗堆叠
    if (el === els.workshopStatus && (
      message.includes("正在同步") ||
      message.startsWith("共 ") ||
      message.startsWith("已展示 ") ||
      message.includes("未找到")
    )) {
      return;
    }
    // 屏蔽宠物编辑页面初始加载图集、切帧统计及普通单元格帧保存替换等被动/频闪气泡，杜绝弹窗堆叠
    if (el === els.editorStatus && (
      message.includes("正在加载") ||
      message.startsWith("已切分") ||
      message.startsWith("已替换第")
    )) {
      return;
    }
    let type: "success" | "error" | "info" = "info";
    if (isError || message.includes("失败") || message.includes("错误") || message.includes("无法") || message.includes("不支持") || message.includes("已熔断")) {
      type = "error";
    } else if (message.includes("已复制") || message.includes("已粘贴") || message.includes("粘贴") || message.includes("已替换") || message.includes("保存成功") || message.includes("套用成功") || message.includes("成功") || message.includes("已开启") || message.includes("已解锁")) {
      type = "success";
    }
    showMessage(message, type);
  }
}

function applyEditorCssZoom(scale: number): void {
  state.editorZoomScale = scale;
  if (els.editorFrameCanvas) {
    els.editorFrameCanvas.style.width = `${Math.round(288 * scale)}px`;
    els.editorFrameCanvas.style.height = `${Math.round(312 * scale)}px`;
  }
}

function updateEditorZoomControls(percent: number): void {
  const next = Math.min(150, Math.max(50, Math.round(percent)));
  state.editorZoomScale = next / 100;
  if (els.editorZoomSlider) els.editorZoomSlider.value = String(next);
  if (els.editorZoomInput) els.editorZoomInput.value = String(next);
  applyEditorCssZoom(state.editorZoomScale);
}

function applyEditorPreviewBackground(background: EditorPreviewBackground): void {
  state.editorPreviewBackground = background;
  localStorage.setItem(LS_EDITOR_PREVIEW_BACKGROUND, background);
  if (els.editorFrameCanvas) {
    els.editorFrameCanvas.dataset.previewBg = background;
  }
}

function setApiConfigStatus(message = "", isError = false): void {
  els.apiConfigStatus.textContent = message;
  els.apiConfigStatus.classList.toggle("error", isError);
}

function normalizeApiEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, "");
  if (!endpoint) return "";
  return endpoint.endsWith("/chat/completions") ? endpoint : `${endpoint}/v1/chat/completions`;
}

function updateApiConfigVisibility(): void {
  const isAwaken = els.chatMode.value === "awaken";
  els.apiConfigFields.hidden = !isAwaken;
}

function updatePersonaVisibility(): void {
  const isAwaken = els.chatMode.value === "awaken";
  const isCustomPersona = els.persona.value === "custom";
  els.personaField.hidden = !isAwaken;
  els.persona.disabled = !isAwaken;
  els.customPersonaField.hidden = !isAwaken || !isCustomPersona;
  els.customPersona.disabled = !isAwaken || !isCustomPersona;
}

function modelsEndpointFromChatEndpoint(value: string): string {
  const endpoint = normalizeApiEndpoint(value);
  if (!endpoint) return "";
  return endpoint.replace(/\/chat\/completions$/, "/models");
}

function modelIdsFromResponse(data: unknown): string[] {
  const items = (data as { data?: unknown }).data;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

async function fetchModelList(): Promise<void> {
  const endpoint = modelsEndpointFromChatEndpoint(els.apiEndpoint.value);
  const key = els.apiKey.value.trim() || await getApiKey();
  if (!endpoint || !key) {
    setApiConfigStatus("请先填写大模型地址和 API Key。", true);
    return;
  }

  const original = els.fetchModels.textContent || "自动获取";
  els.fetchModels.disabled = true;
  els.fetchModels.textContent = "获取中...";
  try {
    const resp = await fetch(endpoint, {
      headers: {
        "Authorization": `Bearer ${key}`,
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const models = modelIdsFromResponse(await resp.json());
    els.apiModelSelect.replaceChildren();
    for (const id of models) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      els.apiModelSelect.append(option);
    }

    if (models.length === 0) {
      els.apiModelSelect.hidden = true;
      setApiConfigStatus("未获取到模型列表", true);
      return;
    }

    if (!models.includes(els.apiModel.value.trim())) {
      els.apiModel.value = models[0];
      localStorage.setItem(LS_API_MODEL, models[0]);
    }
    els.apiModelSelect.hidden = false;
    els.apiModelSelect.value = els.apiModel.value.trim();
    setApiConfigStatus(`已获取 ${models.length} 个模型，可在模型名称中选择。`);
  } catch (err) {
    els.apiModelSelect.replaceChildren();
    els.apiModelSelect.hidden = true;
    setApiConfigStatus(`未获取到模型列表：${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    els.fetchModels.disabled = false;
    els.fetchModels.textContent = original;
  }
}

async function testApiConfig(): Promise<void> {
  const endpoint = normalizeApiEndpoint(els.apiEndpoint.value);
  const key = els.apiKey.value.trim() || await getApiKey();
  const model = els.apiModel.value.trim() || "gpt-3.5-turbo";
  if (!endpoint || !key || !model) {
    setApiConfigStatus("请先填写大模型地址、API Key 和模型名称。", true);
    return;
  }

  const original = els.testApi.textContent || "测试";
  els.testApi.disabled = true;
  els.testApi.textContent = "测试中...";
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    els.apiEndpoint.value = endpoint;
    els.apiModel.value = model;
    localStorage.setItem(LS_API_ENDPOINT, endpoint);
    localStorage.setItem(LS_API_MODEL, model);
    await saveApiKey(key);
    setApiConfigStatus("连接成功，配置已保存。");
  } catch (err) {
    setApiConfigStatus(`测试失败：${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    els.testApi.disabled = false;
    els.testApi.textContent = original;
  }
}

function petTitle(pet: MarketPet | ProjectPet): string {
  if ("slug" in pet) return pet.display_name || pet.slug;
  return pet.displayName || pet.id;
}

function marketDownloadUrl(pet: MarketPet): string {
  return pet.downloadUrl || `${API_BASE}/api/pets/${pet.slug}/download`;
}

function marketSpriteUrl(pet: MarketPet): string {
  return pet.spritesheetUrl || `${API_BASE}/api/pets/${pet.slug}/spritesheet`;
}

function isDownloaded(slug: string): boolean {
  return state.projectPets.some((pet) => pet.id === slug);
}

function confirmDiscardEditorChanges(): boolean {
  if (state.view !== "editor" || !state.editorDirty) return true;
  return window.confirm("当前编辑内容尚未保存，是否放弃本次修改？");
}

function setView(view: ViewName): void {
  if (view !== "editor" && !confirmDiscardEditorChanges()) return;
  state.view = view;
  for (const item of els.navItems) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  for (const [name, element] of Object.entries(els.views)) {
    element.classList.toggle("active", name === view);
  }

  const copy = {
    mine: ["我的桌宠", "管理本地宠物并召唤多个桌面实例。"],
    editor: ["编辑桌宠", "自定义宠物动作。打造宠物专属技能。"],
    recall: ["宠物召回", "查看当前存在的宠物，并支持单独或批量召回。"],
    market: ["宠物市场", "下载新角色并保存到项目 pets 文件夹。"],
    workshop: ["创意工坊", "下载并一键套用社区精选的功德、专注及律动扩展动作。"],
    settings: ["设置", "配置开机自启动、置顶、尺寸和对话模式。"],
  }[view];
  els.title.textContent = copy[0];
  els.subtitle.textContent = copy[1];

  if (els.refresh) {
    els.refresh.style.display = view === "mine" ? "" : "none";
  }
  if (els.editorTopbarActions) {
    els.editorTopbarActions.style.display = view === "editor" ? "flex" : "none";
  }

  if (view === "mine") void loadProjectPets();
  if (view === "recall") void loadActivePets();
  if (view === "workshop") void fetchWorkshopItems();
  if (view === "settings") void loadSettings();
}

function createSprite(url: string, title: string): HTMLDivElement {
  const sprite = document.createElement("div");
  sprite.className = "sprite-preview";
  sprite.style.backgroundImage = `url("${url}")`;
  sprite.setAttribute("role", "img");
  sprite.setAttribute("aria-label", title);
  return sprite;
}

function projectPetSpriteUrl(pet: ProjectPet): string {
  return pet.builtin ? new URL("../builtin-pets/doro/spritesheet_edited.webp", import.meta.url).href : convertFileSrc(pet.spritesheetFile);
}

function pageItems<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

function renderPagination(root: HTMLElement, total: number, page: number, onPage: (page: number) => void): void {
  root.replaceChildren();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return;

  const goToPage = (value: number): void => {
    const nextPage = Math.min(pages, Math.max(1, Math.round(value)));
    if (nextPage !== page) onPage(nextPage);
  };

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "上一页";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => goToPage(page - 1));

  const info = document.createElement("span");
  info.textContent = `/ ${pages}`;

  const pageInput = document.createElement("input");
  pageInput.className = "pagination-jump";
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.max = String(pages);
  pageInput.value = String(page);
  pageInput.setAttribute("aria-label", "跳转页码");
  pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") goToPage(Number(pageInput.value));
  });
  pageInput.addEventListener("change", () => goToPage(Number(pageInput.value)));

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "下一页";
  next.disabled = page >= pages;
  next.addEventListener("click", () => goToPage(page + 1));

  root.append(prev, pageInput, info, next);
}


function filteredProjectPets(): ProjectPet[] {
  const query = els.mineSearch.value.trim().toLowerCase();
  const favoriteIds = new Set(getFavoritePetIds());

  // 1. 根据当前选择的 Tag 进行首层过滤
  let pets = state.projectPets;
  if (state.currentMineTag === "favorite") {
    pets = pets.filter((pet) => favoriteIds.has(pet.id));
  } else if (state.currentMineTag !== "all") {
    const tags = getCustomTags();
    const tagPetIds = tags[state.currentMineTag] || [];
    pets = pets.filter((pet) => tagPetIds.includes(pet.id));
  }

  // 2. 根据搜索 query 过滤
  if (query) {
    pets = pets.filter((pet) => pet.displayName.toLowerCase().includes(query) || pet.id.toLowerCase().includes(query));
  }

  // 3. 保持原数组自然顺序，不进行收藏置顶排序
  return pets;
}

function mineTagPetCount(tagName: string): number {
  if (tagName === "all") return state.projectPets.length;
  if (tagName === "favorite") {
    const favoriteIds = new Set(getFavoritePetIds());
    return state.projectPets.filter((pet) => favoriteIds.has(pet.id)).length;
  }
  const ids = new Set(getCustomTags()[tagName] || []);
  return state.projectPets.filter((pet) => ids.has(pet.id)).length;
}

function appendActiveTagCount(tab: HTMLButtonElement, tagName: string): void {
  if (state.currentMineTag !== tagName || tagName === "all") return;
  const total = mineTagPetCount(tagName);
  const count = document.createElement("span");
  count.className = "tag-tab-count";
  count.textContent = String(total);
  count.setAttribute("aria-label", `${total} 只桌宠`);
  tab.append(count);
}

function renderMineEmptyState(message: string, container: HTMLElement = els.myPetsList): void {
  const empty = document.createElement("div");
  empty.className = "mine-empty-state";

  const image = document.createElement("img");
  image.className = "mine-empty-image";
  image.src = EMPTY_PETS_IMAGE;
  image.alt = "";
  image.loading = "lazy";

  const text = document.createElement("p");
  text.className = "mine-empty-text";
  text.textContent = message;

  empty.append(image, text);
  container.append(empty);
}

function renderListRow(options: {
  title: string;
  subtitle: string;
  spriteUrl: string;
  actions: HTMLElement[];
  titleExtra?: HTMLElement; // 新增的可选参数
  metaExtra?: HTMLElement;
  customPreview?: HTMLElement; // 新增的自定义预览框（例如高清创意工坊动图）
}): HTMLElement {
  const row = document.createElement("article");
  row.className = "pet-row";

  const preview = document.createElement("div");
  preview.className = "pet-preview";

  if (options.customPreview) {
    preview.append(options.customPreview);
    // 重定义以适配精致可爱的 56x60px 缩微动图动作框样式，无缝保持原样
    preview.style.width = "56px";
    preview.style.height = "60px";
    preview.style.border = "none";
    preview.style.background = "none";
    preview.style.overflow = "hidden"; // 强力防溢出双保险
  } else {
    preview.append(createSprite(options.spriteUrl, options.title));
  }

  const info = document.createElement("div");
  info.className = "pet-info";

  // 创建一个标题行的 Flex 包装容器，用以容纳标题和后边的图标/小标签
  const titleWrapper = document.createElement("div");
  titleWrapper.className = "pet-title-wrapper";

  const title = document.createElement("h3");
  title.textContent = options.title;
  titleWrapper.append(title);

  if (options.titleExtra) {
    titleWrapper.append(options.titleExtra);
  }

  const subtitle = document.createElement("p");
  subtitle.className = "meta";
  subtitle.textContent = options.subtitle;

  info.append(titleWrapper, subtitle);
  if (options.metaExtra) {
    info.append(options.metaExtra);
  }

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(...options.actions);

  row.append(preview, info, actions);
  return row;
}

function createPersonalActionBadges(pet: ProjectPet): HTMLElement {
  const badges = document.createElement("div");
  badges.className = "pet-personal-actions";
  badges.setAttribute("aria-label", "个性化动作状态");

  const actionBadges: Array<{ key: ModeActionKey; label: string }> = [
    { key: "merit", label: "功德模式" },
    { key: "focus", label: "专注模式" },
    { key: "music", label: "律动模式" },
  ];
  const animations = pet.animations || {};

  actionBadges.forEach(({ key, label }) => {
    const active = Boolean(animations[key]);
    const badge = document.createElement("span");
    badge.className = `pet-action-status pet-action-status-${key}${active ? " active" : ""}`;
    badge.textContent = label;
    badge.title = active ? `${label}：已配置个性化动作` : `${label}：暂无个性化动作`;
    badge.setAttribute("aria-label", badge.title);
    badges.append(badge);
  });

  return badges;
}

function preserveScroll(fn: () => void): void {
  const el = document.querySelector(".content");
  const top = el ? el.scrollTop : 0;
  fn();
  if (el && top > 0) {
    requestAnimationFrame(() => { el.scrollTop = top; });
  }
}

function renderMarket(totalPets: number = state.marketPets.length): void {
  preserveScroll(() => {
    els.marketGrid.replaceChildren();

    if (state.marketPets.length === 0) {
      setStatus(els.marketStatus, "没有找到匹配的宠物。");
      els.marketPagination.replaceChildren();
      return;
    }

    setStatus(els.marketStatus, `共 ${totalPets} 个宠物。`);

    const fragment = document.createDocumentFragment();
    for (const pet of state.marketPets) {
      const button = document.createElement("button");
      button.type = "button";
      const downloaded = isDownloaded(pet.slug);
      const downloading = state.downloading.has(pet.slug);
      button.className = downloaded ? "summon-button" : "download-button";
      button.textContent = downloaded ? "召唤" : downloading ? "下载中..." : "下载";
      button.disabled = downloading;
      button.addEventListener("click", () => {
        if (downloaded) {
          void summonPet(pet.slug, button, els.marketStatus);
          return;
        }
        void downloadPet(pet);
      });

      fragment.append(renderListRow({
        title: petTitle(pet),
        subtitle: `${pet.version || "v1.0.0"} · 下载 ${pet.download_count || 0}`,
        spriteUrl: marketSpriteUrl(pet),
        actions: [button],
      }));
    }
    els.marketGrid.append(fragment);
    renderPagination(els.marketPagination, totalPets, state.marketPage, (page) => {
      void fetchMarketPets(page);
    });
  });
}

function renderMyPets(): void {
  preserveScroll(() => {
    const pets = filteredProjectPets();
    const pages = Math.max(1, Math.ceil(pets.length / PAGE_SIZE));
    state.minePage = Math.min(state.minePage, pages);
    els.myPetsList.replaceChildren();

    const selectedTagCount = mineTagPetCount(state.currentMineTag);
    const selectedFilterName = state.currentMineTag === "favorite" ? "已收藏" : state.currentMineTag;
    const hasSelectedFilter = state.currentMineTag !== "all";
    if (pets.length === 0) {
      setStatus(
        els.mineStatus,
        hasSelectedFilter ? `「${selectedFilterName}」共 ${selectedTagCount} 只桌宠，当前没有匹配结果。` : "没有找到本地桌宠。"
      );
      renderMineEmptyState("小桌宠翻遍了标签，还没找到匹配的伙伴。");
      els.minePagination.replaceChildren();
      return;
    }
    setStatus(
      els.mineStatus,
      hasSelectedFilter ? `「${selectedFilterName}」共 ${selectedTagCount} 只桌宠。` : `本地已有 ${state.projectPets.length} 个桌宠。`
    );

    const favoriteIds = new Set(getFavoritePetIds());
    const fragment = document.createDocumentFragment();
    for (const pet of pageItems(pets, state.minePage)) {
      const isFavorite = favoriteIds.has(pet.id);

      // 1. 创建绝对定位的分组勾选微型弹层（原本就存在的 dropdown，保持结构一致）
      const dropdown = document.createElement("div");
      dropdown.className = "pet-tags-dropdown";
      dropdown.addEventListener("click", (e) => e.stopPropagation());

      // 2. 构造左侧的 titleExtra 包装节点
      const titleExtra = document.createElement("div");
      titleExtra.className = "pet-title-extra";

      // 2.1 星星收藏图标化 (SVG 矢量图)
      const favIcon = document.createElement("span");
      favIcon.className = "pet-favorite-icon" + (isFavorite ? " active" : "");
      favIcon.title = isFavorite ? "取消收藏" : "加入收藏";
      favIcon.innerHTML = `
      <svg class="star-svg" viewBox="0 0 24 24" width="16" height="16">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    `;
      favIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavoritePet(pet.id);
        renderMyPets();
      });
      titleExtra.append(favIcon);

      // 2.2 标签（分组）小字列表与加号后置
      const tagsWrapper = document.createElement("div");
      tagsWrapper.className = "pet-tags-wrapper";

      const petTags = getPetTags(pet.id);
      petTags.forEach((tag) => {
        const tagBadge = document.createElement("span");
        tagBadge.className = "pet-tag-badge";
        tagBadge.textContent = tag;

        // 点击标签可以直接呼出多选分组下拉框，方便快速变更
        tagBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          document.querySelectorAll(".pet-tags-dropdown.show").forEach((el) => {
            if (el !== dropdown) el.classList.remove("show");
          });
          renderTagsDropdownList(pet.id, dropdown);
          dropdown.classList.toggle("show");
        });
        tagsWrapper.append(tagBadge);
      });

      // 2.3 添加一个小字后置“+”号气泡
      const addTagBtn = document.createElement("span");
      addTagBtn.className = "pet-tag-add";
      addTagBtn.textContent = "+";
      addTagBtn.title = "管理分组标签";
      addTagBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".pet-tags-dropdown.show").forEach((el) => {
          if (el !== dropdown) el.classList.remove("show");
        });
        renderTagsDropdownList(pet.id, dropdown);
        dropdown.classList.toggle("show");
      });
      tagsWrapper.append(addTagBtn, dropdown); // 将 dropdown 加入 tagsWrapper 内部以获得就近定位上下文
      titleExtra.append(tagsWrapper);

      // 3. 右侧核心操作按钮（只保留：召唤、编辑、删除）
      const summon = document.createElement("button");
      summon.className = "summon-button";
      summon.type = "button";
      summon.textContent = "召唤";
      summon.addEventListener("click", () => void summonPet(pet.id, summon));

      const edit = document.createElement("button");
      edit.className = "secondary-button";
      edit.type = "button";
      edit.textContent = "编辑";
      edit.disabled = !!pet.builtin;
      edit.addEventListener("click", () => void openSpriteEditor(pet));

      // 3.1 删除按钮升级：二阶段倒计时防误触
      const remove = document.createElement("button");
      remove.className = "danger-button";
      remove.type = "button";
      remove.textContent = "删除";
      remove.disabled = !!pet.builtin;

      let confirmTimer: number | null = null;
      let isConfirming = false;

      remove.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (pet.builtin) return;

        if (!isConfirming) {
          // 进入待确认状态
          isConfirming = true;
          remove.textContent = "确认删除？";
          remove.classList.add("confirming");

          // 3秒后自动重置为普通状态
          confirmTimer = window.setTimeout(() => {
            isConfirming = false;
            remove.textContent = "删除";
            remove.classList.remove("confirming");
          }, 3000);
        } else {
          // 确认删除！
          if (confirmTimer) {
            clearTimeout(confirmTimer);
            confirmTimer = null;
          }
          isConfirming = false;
          remove.textContent = "正在删除...";
          remove.disabled = true;
          await deletePet(pet);
        }
      });

      // 4. 调用 renderListRow 生成包含左侧 titleExtra 的行
      const rowEl = renderListRow({
        title: pet.displayName,
        subtitle: `${pet.id} · ${pet.version || "v1.0.0"}${pet.builtin ? " · 内置" : ""}`,
        spriteUrl: projectPetSpriteUrl(pet),
        actions: [summon, edit, remove],
        titleExtra,
        metaExtra: createPersonalActionBadges(pet),
      });

      fragment.append(rowEl);
    }
    els.myPetsList.append(fragment);
    renderPagination(els.minePagination, pets.length, state.minePage, (page) => {
      state.minePage = page;
      renderMyPets();
    });
  });
}

function allowMultiplePets(): boolean {
  return localStorage.getItem(LS_ALLOW_MULTIPLE_PETS) !== "false";
}

function petNameById(petId: string): string {
  return state.projectPets.find((pet) => pet.id === petId)?.displayName || petId;
}

function currentPrimaryPetId(): string {
  const saved = localStorage.getItem(LS_PRIMARY_PET_ID);
  return saved && saved !== "ikun-pet" ? saved : BUILTIN_DORO_PET.id;
}

function rememberPrimaryPet(petId: string): void {
  localStorage.setItem(LS_PRIMARY_PET_ID, petId);
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

function getFavoritePetIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_FAVORITE_PET_IDS) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function setFavoritePetIds(petIds: string[]): void {
  localStorage.setItem(LS_FAVORITE_PET_IDS, JSON.stringify([...new Set(petIds.filter(Boolean))]));
}

function toggleFavoritePet(petId: string): void {
  const petIds = getFavoritePetIds();
  setFavoritePetIds(petIds.includes(petId) ? petIds.filter((id) => id !== petId) : [...petIds, petId]);
}

function getCustomTags(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_CUSTOM_TAGS) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, string[]> = {};
      for (const [tag, ids] of Object.entries(parsed)) {
        if (Array.isArray(ids)) {
          result[tag] = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

function saveCustomTags(tags: Record<string, string[]>): void {
  localStorage.setItem(LS_CUSTOM_TAGS, JSON.stringify(tags));
}

function getPetTags(petId: string): string[] {
  const tags = getCustomTags();
  const result: string[] = [];
  for (const [tag, ids] of Object.entries(tags)) {
    if (ids.includes(petId)) {
      result.push(tag);
    }
  }
  return result;
}

function addPetToTag(petId: string, tagName: string): void {
  const tags = getCustomTags();
  if (!tags[tagName]) {
    tags[tagName] = [];
  }
  if (!tags[tagName].includes(petId)) {
    tags[tagName].push(petId);
  }
  saveCustomTags(tags);
}

function removePetFromTag(petId: string, tagName: string): void {
  const tags = getCustomTags();
  if (tags[tagName]) {
    tags[tagName] = tags[tagName].filter((id) => id !== petId);
    saveCustomTags(tags);
  }
}

function deleteTag(tagName: string): void {
  const tags = getCustomTags();
  delete tags[tagName];
  saveCustomTags(tags);
}

function updateInlineTags(tagsWrapper: HTMLElement, petId: string, dropdown: HTMLDivElement): void {
  // 1. 移除所有现有的标签气泡，防止重复
  const badges = tagsWrapper.querySelectorAll(".pet-tag-badge");
  badges.forEach((badge) => badge.remove());

  // 2. 重新获取这只桌宠当前的最新标签数据并渲染
  const petTags = getPetTags(petId);
  const addTagBtn = tagsWrapper.querySelector(".pet-tag-add");

  if (addTagBtn) {
    petTags.forEach((tag) => {
      const tagBadge = document.createElement("span");
      tagBadge.className = "pet-tag-badge";
      tagBadge.textContent = tag;

      // 点击这个小字标签，同样允许一键呼出/关闭弹层，极佳的直觉交互
      tagBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".pet-tags-dropdown.show").forEach((el) => {
          if (el !== dropdown) el.classList.remove("show");
        });
        renderTagsDropdownList(petId, dropdown);
        dropdown.classList.toggle("show");
      });

      // 优雅插入在“+”号按钮之前，保持标签在前、+号在后的漂亮版面
      tagsWrapper.insertBefore(tagBadge, addTagBtn);
    });
  }
}

function renderTagsDropdownList(petId: string, dropdown: HTMLDivElement): void {
  dropdown.replaceChildren();

  const title = document.createElement("div");
  title.className = "tags-dropdown-title";
  title.textContent = "选择所属分组";

  const list = document.createElement("div");
  list.className = "tags-dropdown-list";

  const tags = getCustomTags();
  const petTags = getPetTags(petId);

  const tagNames = Object.keys(tags);
  if (tagNames.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "6px 8px";
    empty.style.color = "rgba(0,0,0,0.35)";
    empty.style.fontSize = "12px";
    empty.textContent = "暂无分组，请新建";
    list.append(empty);
  } else {
    for (const tagName of tagNames) {
      const item = document.createElement("label");
      item.className = "tags-dropdown-item";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = petTags.includes(tagName);
      check.addEventListener("change", () => {
        if (check.checked) {
          addPetToTag(petId, tagName);
        } else {
          removePetFromTag(petId, tagName);
        }

        // 原地快速更新标签气泡，免去全局重绘带来的弹窗卡闭和跳动
        const tagsWrapper = dropdown.parentElement;
        if (tagsWrapper) {
          updateInlineTags(tagsWrapper, petId, dropdown);
        }

        if (state.currentMineTag === tagName) {
          renderMyPets();
        } else {
          // 在其他视图下也刷新分组栏里计数的宠物个数
          renderMineTagsBar();
        }
      });

      const span = document.createElement("span");
      span.textContent = tagName;

      item.append(check, span);
      list.append(item);
    }
  }

  const footer = document.createElement("div");
  footer.className = "tags-dropdown-footer";

  const addLink = document.createElement("a");
  addLink.className = "tags-dropdown-add-link";
  addLink.textContent = "+ 新建分组";
  addLink.addEventListener("click", () => {
    const name = window.prompt("请输入新分组（标签）名称：")?.trim();
    if (name) {
      const tagsObj = getCustomTags();
      if (tagsObj[name]) {
        window.alert("该分组名称已存在！");
        return;
      }
      addPetToTag(petId, name);
      renderTagsDropdownList(petId, dropdown);
      renderMineTagsBar();
      // 如果当前不是 all 视图，跳转到新标签视图让用户看见变化
      state.currentMineTag = name;
      state.minePage = 1;
      renderMineTagsBar();
      renderMyPets();
    }
  });

  footer.append(addLink);
  dropdown.append(title, list, footer);
}

function renderMineTagsBar(): void {
  els.mineTagsList.replaceChildren();

  const allTab = document.createElement("button");
  allTab.className = `tag-tab${state.currentMineTag === "all" ? " active" : ""}`;
  allTab.type = "button";
  allTab.textContent = "全部";
  allTab.addEventListener("click", () => {
    state.currentMineTag = "all";
    state.minePage = 1;
    renderMineTagsBar();
    renderMyPets();
  });

  const favTab = document.createElement("button");
  favTab.className = `tag-tab${state.currentMineTag === "favorite" ? " active" : ""}`;
  favTab.type = "button";
  const favIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  favIcon.setAttribute("viewBox", "0 0 24 24");
  favIcon.setAttribute("aria-hidden", "true");
  favIcon.innerHTML = '<path d="M12 3.8 14.5 9l5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4L9.5 9 12 3.8Z"></path>';
  const favLabel = document.createElement("span");
  favLabel.textContent = "已收藏";
  favTab.append(favIcon, favLabel);
  appendActiveTagCount(favTab, "favorite");
  favTab.addEventListener("click", () => {
    state.currentMineTag = "favorite";
    state.minePage = 1;
    renderMineTagsBar();
    renderMyPets();
  });

  els.mineTagsList.append(allTab, favTab);

  const tagsObj = getCustomTags();
  for (const tagName of Object.keys(tagsObj)) {
    const tab = document.createElement("button");
    tab.className = `tag-tab${state.currentMineTag === tagName ? " active" : ""}`;
    tab.type = "button";
    tab.textContent = tagName;
    appendActiveTagCount(tab, tagName);
    tab.addEventListener("click", () => {
      state.currentMineTag = tagName;
      state.minePage = 1;
      renderMineTagsBar();
      renderMyPets();
    });
    els.mineTagsList.append(tab);
  }

  const isCustomTag = state.currentMineTag !== "all" && state.currentMineTag !== "favorite";
  if (isCustomTag) {
    els.deleteTagBtn.classList.remove("hidden");
  } else {
    els.deleteTagBtn.classList.add("hidden");
  }

  const currentFilteredPets = filteredProjectPets();
  const showSummonAll = state.currentMineTag !== "all" && currentFilteredPets.length > 0;
  if (showSummonAll) {
    els.summonGroupBtn.classList.remove("hidden");
    updateSummonGroupButton("一键召唤当前分组", String(currentFilteredPets.length));
  } else {
    els.summonGroupBtn.classList.add("hidden");
  }
}

function updateSummonGroupButton(label: string, badge: string, stateName = "ready"): void {
  const badgeElement = els.summonGroupBtn.querySelector<HTMLElement>(".tag-action-count");
  els.summonGroupBtn.setAttribute("aria-label", label);
  els.summonGroupBtn.title = label;
  els.summonGroupBtn.dataset.state = stateName;
  if (badgeElement) badgeElement.textContent = badge;
}

function openDeleteTagDialog(tagName: string): void {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";

  const dialog = document.createElement("section");
  dialog.className = "confirm-dialog delete-tag-dialog";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "delete-tag-dialog-title");
  dialog.setAttribute("aria-describedby", "delete-tag-dialog-description");

  const icon = document.createElement("span");
  icon.className = "confirm-dialog-icon";
  icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"></path><path d="M12 17h.01"></path><path d="M12 3 2.8 20h18.4L12 3Z"></path></svg>';

  const copy = document.createElement("div");
  copy.className = "confirm-dialog-copy";

  const title = document.createElement("h3");
  title.id = "delete-tag-dialog-title";
  title.textContent = `删除分组「${tagName}」？`;

  const description = document.createElement("p");
  description.id = "delete-tag-dialog-description";
  description.textContent = "仅删除此分组标签，分组中的桌宠和资源文件都会保留。";
  copy.append(title, description);

  const actions = document.createElement("div");
  actions.className = "confirm-dialog-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button confirm-cancel-button";
  cancelButton.textContent = "取消";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "danger-button confirm-danger-button";
  confirmButton.textContent = "确认删除";
  actions.append(cancelButton, confirmButton);

  const closeDialog = (restoreDeleteButton = true): void => {
    document.removeEventListener("keydown", handleKeydown);
    overlay.remove();
    if (restoreDeleteButton) {
      els.deleteTagBtn.focus();
    } else {
      els.mineTagsList.querySelector<HTMLButtonElement>(".tag-tab.active")?.focus();
    }
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === cancelButton) {
      event.preventDefault();
      confirmButton.focus();
    } else if (!event.shiftKey && document.activeElement === confirmButton) {
      event.preventDefault();
      cancelButton.focus();
    }
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeDialog();
  });
  cancelButton.addEventListener("click", () => closeDialog());
  confirmButton.addEventListener("click", () => {
    deleteTag(tagName);
    state.currentMineTag = "all";
    state.minePage = 1;
    renderMineTagsBar();
    renderMyPets();
    closeDialog(false);
  });

  dialog.append(icon, copy, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  document.addEventListener("keydown", handleKeydown);
  cancelButton.focus();
}

function cleanupFavoritePetIds(): void {
  const existingIds = new Set(state.projectPets.map((pet) => pet.id));
  setFavoritePetIds(getFavoritePetIds().filter((id) => existingIds.has(id)));
}

function addSavedSummonedPetId(petId: string): void {
  setSavedSummonedPetIds([...getSavedSummonedPetIds(), petId]);
}

function removeOneSavedSummonedPetId(petId: string): void {
  const petIds = getSavedSummonedPetIds();
  const index = petIds.indexOf(petId);
  if (index >= 0) petIds.splice(index, 1);
  setSavedSummonedPetIds(petIds);
}

function normalizePrimaryPetId(): void {
  const current = currentPrimaryPetId();
  if (!state.projectPets.some((pet) => pet.id === current)) {
    rememberPrimaryPet(BUILTIN_DORO_PET.id);
  }
}

function renderActivePets(): void {
  preserveScroll(() => {
    els.activePetsList.replaceChildren();
    renderOnlinePetCard();

    if (state.activePetWindows.length === 0) {
      setStatus(els.activePetsStatus, "当前没有可召回的桌宠。");
      els.recallSelectedPets.disabled = true;
      renderMineEmptyState("桌面上静悄悄的，没有可召回的桌宠。", els.activePetsList);
      return;
    }

    setStatus(els.activePetsStatus, `当前存在 ${state.activePetWindows.length} 个宠物。`);
    const canRecallAny = state.activePetWindows.length > 1;
    els.recallSelectedPets.disabled = !canRecallAny || state.selectedRecallLabels.size === 0;

    const fragment = document.createDocumentFragment();

    for (const win of state.activePetWindows) {
      const pet = state.projectPets.find((p) => p.id === win.petId);
      const row = document.createElement("article");
      row.className = "pet-row active-row";

      // 复选框
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedRecallLabels.has(win.label);
      checkbox.disabled = !canRecallAny;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selectedRecallLabels.add(win.label);
        } else {
          state.selectedRecallLabels.delete(win.label);
        }
        renderActivePets();
      });
      row.append(checkbox);

      // 预览图
      const preview = document.createElement("div");
      preview.className = "pet-preview";
      const spriteUrl = pet ? projectPetSpriteUrl(pet) : "";
      preview.append(createSprite(spriteUrl, pet?.displayName || win.petId));

      // 宠物信息
      const info = document.createElement("div");
      info.className = "pet-info";
      const title = document.createElement("h3");
      title.textContent = pet?.displayName || win.petId;
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = win.primary ? "主宠物窗口" : win.label;
      info.append(title, meta);

      // 召回按钮
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const btn = document.createElement("button");
      btn.className = "danger-button";
      btn.type = "button";
      btn.textContent = "召回";
      btn.disabled = !canRecallAny;
      btn.title = canRecallAny ? "召回这个宠物" : "至少保留一个桌宠";
      btn.addEventListener("click", () => void recallPet(win.label));
      actions.append(btn);

      row.append(preview, info, actions);
      fragment.append(row);
    }

    els.activePetsList.append(fragment);
  });
}

function renderOnlinePetCard(): void {
  const count = state.activePetWindows.length;
  els.onlinePetCount.textContent = String(count);
  els.onlinePetAvatars.replaceChildren();

  if (count === 0) {
    els.onlinePetCount.textContent = "0";
    els.onlinePetAction.textContent = "去召唤一只";
    return;
  }

  els.onlinePetAction.textContent = "查看 / 召回";
  for (const item of state.activePetWindows.slice(0, 3)) {
    const pet = state.projectPets.find((p) => p.id === item.petId);
    const avatar = document.createElement("div");
    avatar.className = "online-pet-avatar";
    avatar.title = petNameById(item.petId);
    if (pet) {
      avatar.append(createSprite(projectPetSpriteUrl(pet), pet.displayName));
    } else {
      avatar.textContent = "?";
    }
    els.onlinePetAvatars.append(avatar);
  }

  const remaining = count - 3;
  if (remaining > 0) {
    const more = document.createElement("span");
    more.className = "online-pet-more";
    more.textContent = `+${remaining}`;
    els.onlinePetAvatars.append(more);
  }
}

async function fetchMarketPets(page = 1): Promise<void> {
  const requestSeq = ++marketRequestSeq;
  const filterKey = getMarketFilterKey();
  setStatus(els.marketStatus, "正在加载宠物市场...");
  els.marketGrid.replaceChildren();
  state.marketPage = page;
  try {
    const url = new URL("/api/pets", API_BASE);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("sort", state.sort);
    url.searchParams.set("locale", "zh");
    const query = els.marketSearch.value.trim();
    if (query) url.searchParams.set("q", query);

    const data = await fetch(url).then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    });
    if (requestSeq !== marketRequestSeq) return;
    state.marketPets = Array.isArray(data.pets) ? data.pets : [];
    const reportedTotal = Number(data.pagination?.totalItems);
    const knownPageTotal = (page - 1) * PAGE_SIZE + state.marketPets.length;
    if (Number.isFinite(reportedTotal) && reportedTotal > 0) {
      state.marketTotal = reportedTotal;
      state.marketFilterKey = filterKey;
    } else if (state.marketFilterKey !== filterKey) {
      state.marketTotal = knownPageTotal;
      state.marketFilterKey = filterKey;
    } else {
      state.marketTotal = Math.max(state.marketTotal, knownPageTotal);
    }
    renderMarket(getMarketTotalCount());
  } catch (err) {
    if (requestSeq !== marketRequestSeq) return;
    console.error(err);
    setStatus(els.marketStatus, "宠物市场加载失败，请检查网络后刷新。", true);
  }
}

async function loadProjectPets(): Promise<void> {
  try {
    const pets = await invoke<ProjectPet[]>("list_project_pets");
    const builtinIds = new Set(BUILTIN_PROJECT_PETS.map((pet) => pet.id));
    state.projectPets = [
      ...BUILTIN_PROJECT_PETS,
      ...pets.filter((pet) => !builtinIds.has(pet.id)),
    ];
    normalizePrimaryPetId();
    cleanupFavoritePetIds();
    renderMyPets();
    renderMineTagsBar();
    renderMarket(getMarketTotalCount());
    await loadActivePets();
  } catch (err) {
    console.error(err);
    setStatus(els.mineStatus, `读取本地宠物失败：${err}`, true);
  }
}

async function loadActivePets(): Promise<void> {
  try {
    const [summoned, primaryVisible] = await Promise.all([
      invoke<SummonedPetWindow[]>("list_summoned_pet_windows"),
      invoke<boolean>("is_primary_pet_window_visible"),
    ]);
    const primary = primaryVisible
      ? [{ label: "pet", petId: currentPrimaryPetId(), primary: true }]
      : [];
    state.activePetWindows = [...primary, ...summoned];
    for (const label of Array.from(state.selectedRecallLabels)) {
      if (!state.activePetWindows.some((item) => item.label === label)) {
        state.selectedRecallLabels.delete(label);
      }
    }
    renderActivePets();
  } catch (err) {
    console.error(err);
    setStatus(els.activePetsStatus, `读取当前桌宠失败：${err}`, true);
  }
}

async function recallPet(label: string): Promise<void> {
  try {
    const recalled = state.activePetWindows.find((item) => item.label === label);
    if (!recalled) return;
    if (label === "pet") {
      await invoke("hide_primary_pet_window");
    } else if (recalled) {
      removeOneSavedSummonedPetId(recalled.petId);
      await invoke("close_summoned_pet_window", { label });
    }
    state.selectedRecallLabels.delete(label);
    await loadActivePets();
  } catch (err) {
    setStatus(els.activePetsStatus, `召回失败：${err}`, true);
  }
}

async function recallSelectedPets(): Promise<void> {
  const labels = Array.from(state.selectedRecallLabels);
  if (labels.length === 0) return;
  let remaining = state.activePetWindows.length;
  for (const label of labels) {
    if (remaining <= 1) break;
    await recallPet(label);
    remaining -= 1;
  }
}

async function importLocalPet(): Promise<void> {
  try {
    const file = await open({
      multiple: false,
      filters: [{ name: "桌宠包", extensions: ["zip"] }],
    });
    if (!file || Array.isArray(file)) return;
    await invoke<ProjectPet>("import_pet_zip_to_project", { zipPath: file });
    await loadProjectPets();
    setStatus(els.mineStatus, "本地桌宠导入成功。");
  } catch (err) {
    console.error(err);
    setStatus(els.mineStatus, `导入失败：${err}`, true);
  }
}

async function loadPetsPath(): Promise<void> {
  try {
    const dir = await invoke<string>("get_project_pets_dir");
    if (els.petsPath) els.petsPath.textContent = dir;
    els.settingsPetsPath.textContent = dir;
  } catch (err) {
    if (els.petsPath) els.petsPath.textContent = String(err);
    els.settingsPetsPath.textContent = String(err);
  }
}

async function downloadPet(pet: MarketPet): Promise<void> {
  state.downloading.add(pet.slug);
  renderMarket();
  try {
    await invoke<ProjectPet>("download_pet_to_project", {
      petId: pet.slug,
      downloadUrl: marketDownloadUrl(pet),
    });
    await loadProjectPets();
  } catch (err) {
    console.error(err);
    setStatus(els.marketStatus, `下载失败：${err}`, true);
  } finally {
    state.downloading.delete(pet.slug);
    renderMarket();
  }
}

async function summonPet(petId: string, button: HTMLButtonElement, statusEl: HTMLElement = els.mineStatus): Promise<void> {
  const original = button.textContent || "召唤";
  button.disabled = true;
  button.textContent = "召唤中...";
  try {
    if (!isTauriRuntime()) {
      throw new Error("请在灵动宠物桌面应用的管理面板中召唤桌宠。");
    }
    if (!allowMultiplePets()) {
      await invoke("close_all_summoned_pet_windows");
      setSavedSummonedPetIds([]);
      rememberPrimaryPet(petId);
      await invoke("show_primary_pet_window");
      button.textContent = "已切换";
      setStatus(statusEl, `已切换为「${petNameById(petId)}」。`);
      window.setTimeout(() => void loadActivePets(), 300);
      window.setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 900);
      return;
    }
    await invoke<string>("summon_pet_window", { petId });
    addSavedSummonedPetId(petId);
    button.textContent = "已召唤";
    setStatus(statusEl, "已召唤一个新的桌宠实例。");
    window.setTimeout(() => void loadActivePets(), 300);
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 900);
  } catch (err) {
    console.error(err);
    button.textContent = "失败";
    setStatus(statusEl, `召唤失败：${err instanceof Error ? err.message : String(err)}`, true);
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  }
}

async function deletePet(pet: ProjectPet): Promise<void> {
  if (pet.builtin) return;
  try {
    await invoke("delete_project_pet", { petId: pet.id });
    await loadProjectPets();
    renderMyPets();
  } catch (err) {
    setStatus(els.mineStatus, `删除失败：${err}`, true);
  }
}

function getPetSizeScale(): number {
  const saved = Number(localStorage.getItem(LS_PET_SIZE_SCALE) || "0.6");
  return Number.isFinite(saved) ? Math.min(1.4, Math.max(0.35, saved)) : 0.6;
}

const BASE_PET_WIDTH = 192;
const BASE_PET_HEIGHT = 208;
const SPEECH_SPACE_HEIGHT = 48;
const SIZE_PRESET_NAMES: Record<number, string> = {
  35: "迷你",
  60: "小巧",
  85: "标准",
  110: "醒目",
  140: "超大"
};

function updateSizeControls(percent: number): void {
  const current = Number(els.sizeSlider.value) || 60;
  const next = Math.min(140, Math.max(35, Math.round(Number.isFinite(percent) ? percent : current)));
  const scale = next / 100;
  const width = Math.round(BASE_PET_WIDTH * scale);
  const height = Math.round(BASE_PET_HEIGHT * scale + SPEECH_SPACE_HEIGHT);
  localStorage.setItem(LS_PET_SIZE_SCALE, String(scale));
  els.sizeSlider.value = String(next);
  els.sizeInput.value = String(width);
  els.sizeText.textContent = `${SIZE_PRESET_NAMES[next] ? `${SIZE_PRESET_NAMES[next]} · ` : ""}${width} x ${height} px`;
  for (const button of els.sizePresets) {
    button.classList.toggle("active", Number(button.dataset.sizePercent) === next);
  }
}

function getPetVolumePercent(): number {
  const saved = Number(localStorage.getItem(LS_PET_VOLUME) || "60");
  return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 60;
}

function updateVolumeControls(percent: number): void {
  const next = Math.min(100, Math.max(0, Math.round(percent)));
  localStorage.setItem(LS_PET_VOLUME, String(next));
  els.volumeSlider.value = String(next);
  els.volumeInput.value = String(next);
  els.volumeText.textContent = `${next}%`;
}

function updateBubbleStyleControls(value: string): void {
  localStorage.setItem(LS_SPEECH_BUBBLE_STYLE, value);
  for (const radio of els.speechBubbleStyleRadios) {
    const isChecked = radio.value === value;
    radio.checked = isChecked;
    const card = radio.closest(".bubble-style-card");
    if (card) {
      card.classList.toggle("active", isChecked);
    }
  }
}

async function loadSettings(): Promise<void> {
  els.autostartToggle.checked = await isEnabled().catch(() => false);
  els.alwaysTopToggle.checked = localStorage.getItem("pet-always-on-top") !== "false";
  els.gravityModeToggle.checked = localStorage.getItem(LS_PET_GRAVITY_ENABLED) !== "false";
  const isMultiple = allowMultiplePets();
  for (const radio of els.petInstanceModeRadios) {
    radio.checked = (radio.value === "party" && isMultiple) || (radio.value === "single" && !isMultiple);
  }
  const activityLevel = localStorage.getItem("pet_activity_level") || "middle";
  for (const radio of els.petActivityLevelRadios) {
    radio.checked = radio.value === activityLevel;
  }
  const musicRhythmSync = localStorage.getItem(LS_MUSIC_RHYTHM_SYNC_MODE) || "independent";
  for (const radio of els.musicRhythmSyncRadios) {
    radio.checked = radio.value === musicRhythmSync;
  }
  updateSizeControls(Math.round(getPetSizeScale() * 100));
  updateVolumeControls(getPetVolumePercent());
  els.chatMode.value = localStorage.getItem(LS_CHAT_MODE) || "basic";
  els.persona.value = localStorage.getItem(LS_PERSONA_MODE) || "tsundere";
  updateBubbleStyleControls(localStorage.getItem(LS_SPEECH_BUBBLE_STYLE) || "1");
  els.customPersona.value = localStorage.getItem(LS_CUSTOM_PERSONA) || "";
  els.apiEndpoint.value = localStorage.getItem(LS_API_ENDPOINT) || "";
  els.apiModel.value = localStorage.getItem(LS_API_MODEL) || "gpt-3.5-turbo";
  els.apiKey.value = await getApiKey().catch(() => "");
  updateApiConfigVisibility();
  updatePersonaVisibility();
  const editorPreviewBackground = (localStorage.getItem(LS_EDITOR_PREVIEW_BACKGROUND) as EditorPreviewBackground) || "checker";
  for (const radio of els.editorPreviewBackgroundRadios) {
    radio.checked = radio.value === editorPreviewBackground;
  }
  applyEditorPreviewBackground(editorPreviewBackground);
  void loadPetsPath();
}

els.navItems.forEach((item) => {
  item.addEventListener("click", () => setView((item.dataset.view || "mine") as ViewName));
});
els.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    clearMarketSearchTimer();
    state.sort = (button.dataset.sort || "hot") as SortName;
    state.marketPage = 1;
    for (const item of els.sortButtons) item.classList.toggle("active", item === button);
    void fetchMarketPets(1);
  });
});
els.marketSearch.addEventListener("input", () => {
  state.marketPage = 1;
  clearMarketSearchTimer();
  marketSearchTimer = window.setTimeout(() => {
    marketSearchTimer = null;
    void fetchMarketPets(1);
  }, 250);
});
els.mineSearch.addEventListener("input", () => {
  state.minePage = 1;
  renderMyPets();
});
els.refresh.addEventListener("click", () => {
  if (state.view === "market") void fetchMarketPets();
  if (state.view === "mine") void loadProjectPets();
  if (state.view === "settings") void loadSettings();
});
els.openPetsDir?.addEventListener("click", () => void invoke("open_pet_folder", { petId: null }));
els.settingsOpenPetsDir.addEventListener("click", () => void invoke("open_pet_folder", { petId: null }));
els.addTagBtn.addEventListener("click", () => {
  const name = window.prompt("请输入新建分组（标签）的名称：")?.trim();
  if (name) {
    const tags = getCustomTags();
    if (tags[name]) {
      window.alert("该分组名称已存在！");
      return;
    }
    tags[name] = [];
    saveCustomTags(tags);
    state.currentMineTag = name;
    state.minePage = 1;
    renderMineTagsBar();
    renderMyPets();
  }
});

els.deleteTagBtn.addEventListener("click", () => {
  if (state.currentMineTag === "all" || state.currentMineTag === "favorite") return;
  openDeleteTagDialog(state.currentMineTag);
});

els.summonGroupBtn.addEventListener("click", async () => {
  const currentFilteredPets = filteredProjectPets();
  if (currentFilteredPets.length === 0) return;

  const originalCount = String(currentFilteredPets.length);
  els.summonGroupBtn.disabled = true;
  updateSummonGroupButton("正在召唤当前分组", "…", "working");

  try {
    if (!isTauriRuntime()) {
      throw new Error("请在灵动宠物桌面应用的管理面板中召唤桌宠。");
    }

    if (!allowMultiplePets()) {
      const confirmSwitch = window.confirm(
        `一键群召需要开启「派对模式（多宠共存）」。\n是否为您立即开启派对模式并一键召唤当前分组下的所有桌宠？`
      );
      if (confirmSwitch) {
        localStorage.setItem(LS_ALLOW_MULTIPLE_PETS, "true");
        els.petInstanceModeRadios.forEach((radio) => {
          if (radio.value === "party") radio.checked = true;
        });
      } else {
        const firstPet = currentFilteredPets[0];
        await invoke("close_all_summoned_pet_windows");
        setSavedSummonedPetIds([]);
        rememberPrimaryPet(firstPet.id);
        await invoke("show_primary_pet_window");
        setStatus(els.mineStatus, `派对模式未开启，已为您单宠召唤「${firstPet.displayName}」。`);
        window.setTimeout(() => void loadActivePets(), 300);
        updateSummonGroupButton("召唤完成", "✓", "success");
        window.setTimeout(() => {
          updateSummonGroupButton("一键召唤当前分组", originalCount);
          els.summonGroupBtn.disabled = false;
        }, 1200);
        return;
      }
    }

    for (let i = 0; i < currentFilteredPets.length; i++) {
      const pet = currentFilteredPets[i];
      await invoke("summon_pet_window", { petId: pet.id });
      addSavedSummonedPetId(pet.id);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    setStatus(els.mineStatus, `成功召唤了「${state.currentMineTag}」分组下的全部 ${currentFilteredPets.length} 只桌宠。`);
    window.setTimeout(() => void loadActivePets(), 300);
    updateSummonGroupButton("召唤完成", "✓", "success");

  } catch (err) {
    console.error(err);
    setStatus(els.mineStatus, `一键群召失败：${err instanceof Error ? err.message : String(err)}`, true);
    updateSummonGroupButton("召唤失败", "!", "error");
  } finally {
    window.setTimeout(() => {
      updateSummonGroupButton("一键召唤当前分组", originalCount);
      els.summonGroupBtn.disabled = false;
    }, 1500);
  }
});

// 绑定全局点击事件，点击空白处自动隐藏下拉弹窗
document.addEventListener("click", () => {
  document.querySelectorAll(".pet-tags-dropdown.show").forEach((el) => {
    el.classList.remove("show");
  });
});

els.importLocalPet.addEventListener("click", () => void importLocalPet());
els.refreshActivePets.addEventListener("click", () => void loadActivePets());
els.recallSelectedPets.addEventListener("click", () => void recallSelectedPets());
els.onlinePetAction.addEventListener("click", () => setView(state.activePetWindows.length > 0 ? "recall" : "mine"));
els.autostartToggle.addEventListener("change", async () => {
  if (els.autostartToggle.checked) await enable();
  else await disable();
});
els.alwaysTopToggle.addEventListener("change", () => {
  localStorage.setItem("pet-always-on-top", String(els.alwaysTopToggle.checked));
});
els.gravityModeToggle.addEventListener("change", () => {
  localStorage.setItem(LS_PET_GRAVITY_ENABLED, String(els.gravityModeToggle.checked));
});
els.petInstanceModeRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    if (!radio.checked) return;
    const isMultiple = radio.value === "party";
    localStorage.setItem(LS_ALLOW_MULTIPLE_PETS, String(isMultiple));
    if (!isMultiple) {
      await invoke("close_all_summoned_pet_windows").catch(console.error);
      setSavedSummonedPetIds([]);
      await invoke("show_primary_pet_window").catch(console.error);
    }
    await loadActivePets();
  });
});
els.petActivityLevelRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    localStorage.setItem("pet_activity_level", radio.value);
  });
});
els.musicRhythmSyncRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    localStorage.setItem(LS_MUSIC_RHYTHM_SYNC_MODE, radio.value);
  });
});
if (els.editorZoomSlider) {
  els.editorZoomSlider.addEventListener("input", () => {
    updateEditorZoomControls(Number(els.editorZoomSlider.value));
  });
}
if (els.editorZoomInput) {
  const applyEditorZoomInput = (): void => {
    updateEditorZoomControls(Number(els.editorZoomInput.value));
  };
  els.editorZoomInput.addEventListener("blur", applyEditorZoomInput);
  els.editorZoomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      applyEditorZoomInput();
      els.editorZoomInput.blur();
    }
  });
}
els.editorPreviewBackgroundRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    applyEditorPreviewBackground(radio.value as EditorPreviewBackground);
  });
});
els.sizePresets.forEach((button) => {
  button.addEventListener("click", () => {
    const percent = Number(button.dataset.sizePercent);
    if (Number.isFinite(percent)) {
      updateSizeControls(percent);
    }
  });
});
els.sizeSlider.addEventListener("input", () => updateSizeControls(Number(els.sizeSlider.value)));
const applySizeInput = (): void => updateSizeControls((Number(els.sizeInput.value) / BASE_PET_WIDTH) * 100);
els.sizeInput.addEventListener("blur", applySizeInput);
els.sizeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    applySizeInput();
    els.sizeInput.blur();
  }
});
els.volumeSlider.addEventListener("input", () => updateVolumeControls(Number(els.volumeSlider.value)));
els.volumeInput.addEventListener("input", () => updateVolumeControls(Number(els.volumeInput.value)));
window.addEventListener("storage", (event) => {
  if (event.key === LS_PET_VOLUME) updateVolumeControls(getPetVolumePercent());
  if (event.key === LS_PET_WINDOW_STATE_VERSION) void loadActivePets();
});
els.chatMode.addEventListener("change", () => {
  localStorage.setItem(LS_CHAT_MODE, els.chatMode.value);
  updateApiConfigVisibility();
  updatePersonaVisibility();
});
els.persona.addEventListener("change", () => {
  localStorage.setItem(LS_PERSONA_MODE, els.persona.value);
  updatePersonaVisibility();
});
els.customPersona.addEventListener("input", () => localStorage.setItem(LS_CUSTOM_PERSONA, els.customPersona.value.trim()));
els.speechBubbleStyleRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      updateBubbleStyleControls(radio.value);
    }
  });
});
els.apiEndpoint.addEventListener("change", () => {
  const endpoint = normalizeApiEndpoint(els.apiEndpoint.value);
  els.apiEndpoint.value = endpoint;
  if (endpoint) localStorage.setItem(LS_API_ENDPOINT, endpoint);
  else localStorage.removeItem(LS_API_ENDPOINT);
  setApiConfigStatus(endpoint ? "大模型地址已保存。" : "大模型地址已清空。");
});
els.apiModel.addEventListener("change", () => {
  const model = els.apiModel.value.trim() || "gpt-3.5-turbo";
  els.apiModel.value = model;
  if (!els.apiModelSelect.hidden) els.apiModelSelect.value = model;
  localStorage.setItem(LS_API_MODEL, model);
  setApiConfigStatus("模型名称已保存。");
});
els.apiModelSelect.addEventListener("change", () => {
  const model = els.apiModelSelect.value.trim();
  if (!model) return;
  els.apiModel.value = model;
  localStorage.setItem(LS_API_MODEL, model);
  setApiConfigStatus("模型名称已保存。");
});
els.apiKey.addEventListener("change", () => {
  const key = els.apiKey.value.trim();
  void saveApiKey(key)
    .then(() => setApiConfigStatus(key ? "API Key 已保存到系统凭据。" : "API Key 已清空。"))
    .catch((err) => setApiConfigStatus(`API Key 保存失败：${err}`, true));
});
els.fetchModels.addEventListener("click", () => void fetchModelList());
els.testApi.addEventListener("click", () => void testApiConfig());
els.toggleApiKeyVisibility.addEventListener("click", () => {
  const shouldShow = els.apiKey.type === "password";
  els.apiKey.type = shouldShow ? "text" : "password";
  els.toggleApiKeyVisibility.classList.toggle("is-visible", shouldShow);
  els.toggleApiKeyVisibility.setAttribute("aria-pressed", String(shouldShow));
  els.toggleApiKeyVisibility.setAttribute("aria-label", shouldShow ? "隐藏密钥" : "显示密钥");
});


// ==========================================
// 雪碧图编辑器与创意工坊事件监听绑定
// ==========================================
els.editorBack.addEventListener("click", () => setView("mine"));
els.editorSave.addEventListener("click", () => void saveSpriteEditor());

els.editorReplace.addEventListener("click", () => {
  els.editorUpload.click();
});

els.editorUpload.addEventListener("change", () => {
  const file = els.editorUpload.files?.[0];
  if (file) {
    void replaceSelectedEditorFrame(file).then(() => {
      els.editorUpload.value = "";
    });
  }
});

els.editorClear.addEventListener("click", () => {
  const frame = z();
  if (!frame) return;
  recordEditorEraserUndo(frame);
  saveCanvasFrame(null);
  renderSpriteEditorGrid();
  drawSelectedEditorFrame();
  setStatus(els.editorStatus, "已清空当前帧。");
});

els.editorCopy.addEventListener("click", () => copySelectedEditorFrame());
els.editorPaste.addEventListener("click", () => pasteSelectedEditorFrame());
els.editorMoveUndo.addEventListener("click", () => undoFrameNudge());

els.editorNudgeButtons.forEach((btn) => {
  const nudge = btn.dataset.frameNudge;
  if (nudge) {
    const [dx, dy] = nudge.split(",").map(Number);
    btn.addEventListener("click", () => nudgeFrameOffset(dx, dy));
  }
});

els.editorModePresets.forEach((btn) => {
  const mode = btn.dataset.actionKey as ModeActionKey;
  if (mode) {
    btn.addEventListener("click", () => selectEditorModeAction(mode));
  }
});

els.editorAlignAction.addEventListener("click", () => void optimizeActionFramesAlignment());

els.actionStripImport.addEventListener("click", () => {
  els.actionStripUpload.click();
});

els.actionStripUpload.addEventListener("change", () => {
  const file = els.actionStripUpload.files?.[0];
  if (file) {
    void importActionStripImage(file).then(() => {
      els.actionStripUpload.value = "";
    });
  }
});

els.promptCopy.addEventListener("click", () => void copyTextToClipboard(els.imagePromptOutput.value).then(() => {
  setStatus(els.editorStatus, "已成功复制 AI 描述词到剪贴板！");
}));

els.editorEraser.addEventListener("click", () => {
  state.editorEraserEnabled = !state.editorEraserEnabled;
  updateEditorEraserUi();
});

els.editorEraserSize.addEventListener("input", () => {
  state.editorEraseBrushSize = Number(els.editorEraserSize.value);
  updateEditorEraserUi();
});

els.editorEraserUndo.addEventListener("click", () => undoEditorEraser());

// 帧编辑 Canvas 手绘擦除与拖拽移动鼠标/触摸事件
els.editorFrameCanvas.addEventListener("pointerdown", (event) => {
  const frame = z();
  if (!frame) return;

  if (state.editorEraserEnabled) {
    event.preventDefault();
    els.editorFrameCanvas.setPointerCapture(event.pointerId);
    state.editorErasing = true;
    state.editorErasePointerId = event.pointerId;
    recordEditorEraserUndo(frame);
    const coords = getCanvasCoordinates(event);
    state.editorEraseLastPoint = coords;
    performCanvasEraserDraw(null, coords);
  } else if (state.editorPreviewMode === "frame") {
    event.preventDefault();
    els.editorFrameCanvas.setPointerCapture(event.pointerId);
    state.editorMoving = true;
    state.editorMovePointerId = event.pointerId;
    state.editorMoveOrigin = { x: event.clientX, y: event.clientY };
    state.editorMoveSourceFrame = P(frame);

    const action = state.editorActions[state.editorSelectedRow];
    const offset = action?.stripOffsets?.[state.editorSelectedCol];
    state.editorMoveSourceOffset = offset ? { ...offset } : { x: 0, y: 0 };
    state.editorMoveChanged = false;
    updateEditorMoveControls();
  }
});

els.editorFrameCanvas.addEventListener("pointermove", (event) => {
  if (state.editorEraserEnabled) {
    updateEraserCursorPosition(event);
    if (state.editorErasing && state.editorErasePointerId === event.pointerId) {
      event.preventDefault();
      const coords = getCanvasCoordinates(event);
      performCanvasEraserDraw(state.editorEraseLastPoint, coords);
      state.editorEraseLastPoint = coords;
    }
  } else if (state.editorMoving && state.editorMovePointerId === event.pointerId && state.editorMoveOrigin && state.editorMoveSourceFrame && state.editorMoveSourceOffset) {
    event.preventDefault();
    const dx = Math.round((event.clientX - state.editorMoveOrigin.x) * ATLAS_CELL_WIDTH / els.editorFrameCanvas.getBoundingClientRect().width);
    const dy = Math.round((event.clientY - state.editorMoveOrigin.y) * ATLAS_CELL_HEIGHT / els.editorFrameCanvas.getBoundingClientRect().height);

    if (dx !== 0 || dy !== 0) {
      const action = state.editorActions[state.editorSelectedRow];
      if (action) {
        if (isStripImageFrameValid(action, state.editorSelectedCol)) {
          action.stripOffsets![state.editorSelectedCol].x = state.editorMoveSourceOffset.x + dx;
          action.stripOffsets![state.editorSelectedCol].y = state.editorMoveSourceOffset.y + dy;
          action.frames[state.editorSelectedCol] = getStripImageFrame(action, state.editorSelectedCol);
        } else {
          action.frames[state.editorSelectedCol] = moveFrameOffset(state.editorMoveSourceFrame, dx, dy);
        }
        state.editorMoveChanged = true;
        const viewCtx = els.editorFrameCanvas.getContext("2d");
        viewCtx?.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
        const currentFrame = action.frames[state.editorSelectedCol];
        if (currentFrame) viewCtx?.drawImage(currentFrame, 0, 0);
      }
    }
  }
});

const finishInteraction = (event: PointerEvent) => {
  if (state.editorEraserEnabled) {
    if (state.editorErasing && state.editorErasePointerId === event.pointerId) {
      els.editorFrameCanvas.releasePointerCapture(event.pointerId);
      finishEditorCanvasErasing();
    }
  } else if (state.editorMoving && state.editorMovePointerId === event.pointerId) {
    els.editorFrameCanvas.releasePointerCapture(event.pointerId);
    finishEditorCanvasDragging();
  }
};

els.editorFrameCanvas.addEventListener("pointerup", finishInteraction);
els.editorFrameCanvas.addEventListener("pointercancel", finishInteraction);

//pointerleave 中的 event 设为未使用
els.editorFrameCanvas.addEventListener("pointerleave", () => {
  if (state.editorEraserEnabled) hideEraserCursor();
});

// 创意工坊搜索与过滤事件
els.workshopSearch.addEventListener("input", () => {
  state.workshopSearchQuery = els.workshopSearch.value;
  renderWorkshop();
});

els.workshopActionFilter.addEventListener("change", () => {
  state.workshopFilterType = els.workshopActionFilter.value;
  renderWorkshop();
});

document.addEventListener("click", (event) => {
  const tab = (event.target as HTMLElement).closest("#workshop-tags-list .tag-tab");
  if (tab) {
    const parent = document.getElementById("workshop-tags-list");
    if (parent) {
      const tabs = parent.querySelectorAll(".tag-tab");
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentWorkshopTag = tab.getAttribute("data-tag") || "all";
      renderWorkshop();
    }
  }
});

// 分享按钮点击
els.actionStripShare.addEventListener("click", () => void shareCurrentActionToCommunity());

window.addEventListener("keydown", (event) => {
  if (state.view !== "editor") return;
  const isEditingText = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
  if (isEditingText) return;

  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelectedEditorFrame();
    } else if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (state.editorEraserUndoFrame) {
        undoEditorEraser();
      } else if (state.editorMoveUndoFrame) {
        undoFrameNudge();
      }
    }
  } else if (event.key === "Escape" || event.key === "Backspace") {
    event.preventDefault();
    const frame = z();
    if (frame) {
      recordEditorEraserUndo(frame);
      saveCanvasFrame(null);
      renderSpriteEditorGrid();
      drawSelectedEditorFrame();
      setStatus(els.editorStatus, "已清空当前选中的单元格内容。");
    }
  }
});

window.addEventListener("paste", (event) => void At(event));

void loadPetsPath();
void loadProjectPets();
void fetchMarketPets();
void loadSettings();
void loadActivePets();

// 动态设置气泡卡片背景，彻底修复 Tauri 打包生产环境下 CSS 相对路径丢失的问题
function initBubblePreviewImages(): void {
  const ornamentsMap: Record<string, string> = {
    "1": style1Ornaments,
    "2": style2Ornaments,
    "3": style3Ornaments,
    "5": style5Ornaments,
    "6": style6Ornaments,
    "7": style7Ornaments,
    "8": style8Ornaments,
    "9": style9Ornaments
  };

  Object.entries(ornamentsMap).forEach(([styleId, imgSrc]) => {
    const card = document.querySelector(`.bubble-style-card[data-style="${styleId}"]`);
    const preview = card?.querySelector(".bubble-style-preview") as HTMLElement | null;
    if (preview) {
      preview.style.backgroundImage = `url("${imgSrc}")`;
    }
  });
}

initBubblePreviewImages();


// ==========================================
// 雪碧图编辑器 & 创意工坊核心扩展功能实现 (TS 完美版)
// ==========================================

function z(): HTMLCanvasElement | null {
  return state.editorActions[state.editorSelectedRow]?.frames[state.editorSelectedCol] || null;
}

function P(canvas: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (!canvas) return null;
  const copy = createEmptyFrameCanvas();
  copy.getContext("2d")?.drawImage(canvas, 0, 0);
  return copy;
}

function updateEditorEraserUi(): void {
  els.editorEraser.classList.toggle("active", state.editorEraserEnabled);
  els.editorEraser.setAttribute("aria-pressed", String(state.editorEraserEnabled));
  els.editorFrameCanvas.classList.toggle("eraser-active", state.editorEraserEnabled);
  els.editorEraserSize.value = String(state.editorEraseBrushSize);
  els.editorEraserSizeValue.textContent = String(state.editorEraseBrushSize);
  els.editorEraserUndo.disabled = !state.editorEraserUndoFrame;
  updateEraserCursorSize();
  if (!state.editorEraserEnabled) hideEraserCursor();
  updateEditorMoveControls();
}

function getEraseCursorSizeInPixels(): number {
  const rect = els.editorFrameCanvas.getBoundingClientRect();
  return Math.max(4, state.editorEraseBrushSize * 2 * rect.width / ATLAS_CELL_WIDTH);
}

function updateEraserCursorSize(): void {
  const size = getEraseCursorSizeInPixels();
  els.editorEraserCursor.style.width = `${size}px`;
  els.editorEraserCursor.style.height = `${size}px`;
}

function updateEraserCursorPosition(event: PointerEvent): void {
  if (!state.editorEraserEnabled) {
    hideEraserCursor();
    return;
  }
  const rect = els.editorFrameCanvas.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    hideEraserCursor();
    return;
  }
  const parentRect = els.editorFrameCanvas.parentElement?.getBoundingClientRect();
  if (parentRect) {
    updateEraserCursorSize();
    els.editorEraserCursor.style.left = `${event.clientX - parentRect.left}px`;
    els.editorEraserCursor.style.top = `${event.clientY - parentRect.top}px`;
    els.editorEraserCursor.classList.add("show");
  }
}

function hideEraserCursor(): void {
  els.editorEraserCursor.classList.remove("show");
}

function clearEditorUndoStates(): void {
  state.editorEraserUndoFrame = null;
  state.editorEraserUndoRow = 0;
  state.editorEraserUndoCol = 0;
  updateEditorEraserUi();
}

function updateEditorMoveControls(): void {
  const allowed = state.editorPreviewMode === "frame" && !!z() && !state.editorEraserEnabled;
  els.editorFrameCanvas.classList.toggle("move-active", allowed);
  els.editorFrameCanvas.classList.toggle("move-dragging", state.editorMoving);
  for (const btn of els.editorNudgeButtons) btn.disabled = !allowed;
  els.editorMoveUndo.disabled = !(state.editorMoveUndoFrame && state.editorMoveUndoRow === state.editorSelectedRow && state.editorMoveUndoCol === state.editorSelectedCol);
}

function clearEditorMoveUndoStates(): void {
  state.editorMoveUndoFrame = null;
  state.editorMoveUndoRow = 0;
  state.editorMoveUndoCol = 0;
  state.editorMoveUndoStripOffset = null;
  updateEditorMoveControls();
}

function recordEditorMoveUndo(frame: HTMLCanvasElement): void {
  clearEditorUndoStates();
  const action = state.editorActions[state.editorSelectedRow];
  state.editorMoveUndoFrame = P(frame);
  state.editorMoveUndoRow = state.editorSelectedRow;
  state.editorMoveUndoCol = state.editorSelectedCol;
  const curOffset = action?.stripOffsets?.[state.editorSelectedCol];
  state.editorMoveUndoStripOffset = curOffset ? { ...curOffset } : null;
  updateEditorMoveControls();
}

function nudgeFrameOffset(dx: number, dy: number): void {
  const frame = z();
  if (!frame) {
    setStatus(els.editorStatus, "当前帧为空，无法移动。", true);
    return;
  }
  recordEditorMoveUndo(frame);
  if (at(dx, dy, frame)) {
    renderSpriteEditorGrid();
    drawSelectedEditorFrame();
    setStatus(els.editorStatus, `已移动当前帧：${dx === -1 ? "左" : dx === 1 ? "右" : dy === -1 ? "上" : "下"}移 1 像素。`);
  }
}

function undoFrameNudge(): void {
  if (!state.editorMoveUndoFrame || state.editorMoveUndoRow !== state.editorSelectedRow || state.editorMoveUndoCol !== state.editorSelectedCol) return;
  const action = state.editorActions[state.editorSelectedRow];
  if (action) {
    if (isStripImageFrameValid(action, state.editorSelectedCol) && state.editorMoveUndoStripOffset) {
      action.stripOffsets![state.editorSelectedCol] = { ...state.editorMoveUndoStripOffset };
      action.frames[state.editorSelectedCol] = getStripImageFrame(action, state.editorSelectedCol);
    } else {
      action.frames[state.editorSelectedCol] = P(state.editorMoveUndoFrame);
    }
    state.editorMoveUndoFrame = null;
    state.editorMoveUndoStripOffset = null;
    if (action.key && action.key in MODE_ACTION_PRESETS) {
      action.pendingFramePngSave = true;
    }
    state.editorDirty = true;
    renderSpriteEditorGrid();
    drawSelectedEditorFrame();
    setStatus(els.editorStatus, "已撤销当前帧位移。");
  }
}

function finishEditorCanvasDragging(saveMessage = true): void {
  if (!state.editorMoving) return;
  state.editorMoving = false;
  state.editorMovePointerId = null;
  state.editorMoveOrigin = null;
  state.editorMoveSourceFrame = null;
  state.editorMoveSourceOffset = null;
  const changed = state.editorMoveChanged;
  state.editorMoveChanged = false;
  updateEditorMoveControls();
  if (changed) {
    renderSpriteEditorGrid();
    drawSelectedEditorFrame();
    if (saveMessage) setStatus(els.editorStatus, "已拖动调整当前帧位置，保存后生效。");
  }
}

function recordEditorEraserUndo(frame: HTMLCanvasElement): void {
  clearEditorMoveUndoStates();
  state.editorEraserUndoFrame = P(frame);
  state.editorEraserUndoRow = state.editorSelectedRow;
  state.editorEraserUndoCol = state.editorSelectedCol;
  updateEditorEraserUi();
}

function undoEditorEraser(): void {
  if (!state.editorEraserUndoFrame) return;
  state.editorSelectedRow = state.editorEraserUndoRow;
  state.editorSelectedCol = state.editorEraserUndoCol;
  const action = state.editorActions[state.editorSelectedRow];
  if (action) {
    action.frames[state.editorSelectedCol] = P(state.editorEraserUndoFrame);
    state.editorEraserUndoFrame = null;
    state.editorDirty = true;
    updateActionPromptPreview();
    renderSpriteEditorGrid();
    drawSelectedEditorFrame();
    updateEditorEraserUi();
    setStatus(els.editorStatus, "已撤销上次擦除。");
  }
}

function getCanvasCoordinates(event: PointerEvent): { x: number; y: number } {
  const rect = els.editorFrameCanvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * ATLAS_CELL_WIDTH / rect.width);
  const y = Math.floor((event.clientY - rect.top) * ATLAS_CELL_HEIGHT / rect.height);
  return {
    x: Math.min(ATLAS_CELL_WIDTH - 1, Math.max(0, x)),
    y: Math.min(ATLAS_CELL_HEIGHT - 1, Math.max(0, y)),
  };
}

function performCanvasEraserDraw(last: { x: number; y: number } | null, cur: { x: number; y: number }): boolean {
  const frame = z();
  if (!frame) return false;
  const ctx = frame.getContext("2d");
  if (!ctx) return false;

  const r = state.editorEraseBrushSize;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = r * 2;
  ctx.beginPath();
  if (last) {
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(cur.x, cur.y);
    ctx.stroke();
  } else {
    ctx.arc(cur.x, cur.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  state.editorDirty = true;
  const viewCtx = els.editorFrameCanvas.getContext("2d");
  viewCtx?.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
  viewCtx?.drawImage(frame, 0, 0);
  return true;
}

function finishEditorCanvasErasing(saveMessage = true): void {
  if (!state.editorErasing) return;
  state.editorErasing = false;
  state.editorErasePointerId = null;
  state.editorEraseLastPoint = null;
  const frame = z();
  if (frame && !frameHasContent(frame)) {
    saveCanvasFrame(null);
    const viewCtx = els.editorFrameCanvas.getContext("2d");
    viewCtx?.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
  }
  renderSpriteEditorGrid();
  if (saveMessage) setStatus(els.editorStatus, "已擦除当前帧，保存后生效。");
}

function saveCanvasFrame(canvas: HTMLCanvasElement | null): void {
  const action = state.editorActions[state.editorSelectedRow];
  if (action) {
    clearStripImageSource(action);
    action.frames[state.editorSelectedCol] = P(canvas);
    if (action.key && action.key in MODE_ACTION_PRESETS) {
      action.pendingFramePngSave = true;
    }
    state.editorDirty = true;
  }
}

function copySelectedEditorFrame(): void {
  const frame = z();
  if (!frame || !frameHasContent(frame)) {
    setStatus(els.editorStatus, "当前帧为空，无法复制。", true);
    return;
  }
  state.editorClipboard = P(frame);
  els.editorPaste.disabled = false;

  try {
    frame.toBlob((blob) => {
      if (blob) {
        navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob
          })
        ]).then(() => {
          setStatus(els.editorStatus, `已复制第 ${state.editorSelectedRow + 1} 行第 ${state.editorSelectedCol + 1} 帧到系统剪贴板。`);
        }).catch((err) => {
          console.error("写入系统剪贴板失败:", err);
          setStatus(els.editorStatus, `已复制第 ${state.editorSelectedRow + 1} 行第 ${state.editorSelectedCol + 1} 帧到应用剪贴板，但写入系统剪贴板受限：${err}`, true);
        });
      }
    }, "image/png");
  } catch (err) {
    console.error("复制到系统剪贴板异常:", err);
    setStatus(els.editorStatus, `已复制第 ${state.editorSelectedRow + 1} 行第 ${state.editorSelectedCol + 1} 帧到应用剪贴板。`);
  }
}

function pasteSelectedEditorFrame(): void {
  if (!state.editorClipboard) return;
  const frame = z();
  if (frame) recordEditorEraserUndo(frame);
  saveCanvasFrame(state.editorClipboard);
  drawSelectedEditorFrame();
  renderSpriteEditorGrid();
  setStatus(els.editorStatus, `已粘贴帧图片到当前帧。`);
}

async function replaceSelectedEditorFrame(file: File): Promise<void> {
  try {
    const cropped = cropAndAutoCenterImage(await loadImageFile(file));
    const canvas = createEmptyFrameCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);

    const scale = Math.min(ATLAS_CELL_WIDTH / cropped.width, ATLAS_CELL_HEIGHT / cropped.height);
    const w = Math.max(1, Math.round(cropped.width * scale));
    const h = Math.max(1, Math.round(cropped.height * scale));
    const dx = Math.round((ATLAS_CELL_WIDTH - w) / 2);
    const dy = Math.round((ATLAS_CELL_HEIGHT - h) / 2);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cropped, dx, dy, w, h);

    const frame = z();
    if (frame) recordEditorEraserUndo(frame);
    saveCanvasFrame(canvas);
    renderSpriteEditorGrid();
    drawSelectedEditorFrame();
    setStatus(els.editorStatus, `已替换第 ${state.editorSelectedRow + 1} 行第 ${state.editorSelectedCol + 1} 帧。`);
  } catch (err) {
    setStatus(els.editorStatus, `替换帧图失败：${err}`, true);
  }
}

async function importActionStripImage(file: File): Promise<void> {
  const action = state.editorActions[state.editorSelectedRow];
  if (!action) {
    setStatus(els.editorStatus, "请先选择要导入的动作。", true);
    return;
  }
  let framesCount = 8;
  if (action.key && action.key in MODE_ACTION_PRESETS) {
    framesCount = MODE_ACTION_PRESETS[action.key as ModeActionKey].frames;
  }
  const customFramesCount = Number(els.actionStripFrameCount.value);
  if (Number.isInteger(customFramesCount) && customFramesCount >= 1 && customFramesCount <= ATLAS_COLS) {
    framesCount = customFramesCount;
  }
  const originalText = els.actionStripImport.textContent || `导入横版 ${framesCount} 帧图`;
  els.actionStripImport.disabled = true;
  els.actionStripImport.textContent = "导入中...";
  try {
    const rawImage = await loadImageFile(file);

    const imgWidth = rawImage.naturalWidth;
    const imgHeight = rawImage.naturalHeight;

    const singleW = imgWidth / framesCount;
    const canvas = document.createElement("canvas");
    canvas.width = framesCount * ATLAS_CELL_WIDTH;
    canvas.height = ATLAS_CELL_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理导入图片。");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (let i = 0; i < framesCount; i++) {
      const sx = i * singleW;
      const sy = 0;

      const scale = Math.min(ATLAS_CELL_WIDTH / singleW, ATLAS_CELL_HEIGHT / imgHeight);
      const drawW = singleW * scale;
      const drawH = imgHeight * scale;
      const dx = i * ATLAS_CELL_WIDTH + (ATLAS_CELL_WIDTH - drawW) / 2;
      const dy = (ATLAS_CELL_HEIGHT - drawH) / 2;

      ctx.drawImage(
        rawImage,
        sx, sy, singleW, imgHeight,
        dx, dy, drawW, drawH
      );
    }

    action.stripSource = canvas;
    action.stripFrameCount = framesCount;
    action.stripOffsets = Array.from({ length: framesCount }, () => ({ x: 0, y: 0 }));
    action.pendingFramePngSave = true;

    const frames = getStripFrames(action);
    clearEditorUndoStates();
    clearEditorMoveUndoStates();
    for (let i = 0; i < frames.length; i++) {
      action.frames[i] = frames[i];
    }
    for (let i = frames.length; i < ATLAS_COLS; i++) {
      action.frames[i] = null;
    }
    state.editorSelectedCol = 0;
    state.editorDirty = true;
    renderSpriteEditorGrid();
    drawSelectedEditorFrame();
    setStatus(els.editorStatus, `已导入横版图到「${action.name}」的 ${frames.length} 个取景窗口。可逐帧拖动调整，保存时再生成最终 WebP 与分帧 PNG。`);
  } catch (err) {
    setStatus(els.editorStatus, `导入动作图失败：${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    els.actionStripImport.disabled = false;
    els.actionStripImport.textContent = originalText;
  }
}

function selectEditorModeAction(key: ModeActionKey): void {
  ensureDefaultModeActions();
  const row = state.editorActions.findIndex((action) => action.key === key);
  if (row < 0) return;
  const action = state.editorActions[row];
  state.editorSelectedRow = row;
  state.editorSelectedCol = 0;
  state.editorSelectionType = "action";
  state.editorPreviewMode = "action";
  updateActionPromptPreview();
  renderSpriteEditorGrid();
  playSelectedEditorAction();
  setStatus(els.editorStatus, `已选择「${action.name}」。`);
}

function actionHasContent(action: EditorAction): boolean {
  return action.frames.some((frame) => frameHasContent(frame));
}

function savableEditorActions(): EditorAction[] {
  return state.editorActions.filter((action, index) => index < DEFAULT_ACTION_NAMES.length || actionHasContent(action));
}

function editorAnimationsManifest(actions: EditorAction[]): Record<string, FrameAnimation> {
  const animations: Record<string, FrameAnimation> = {};
  actions.forEach((action, row) => {
    if (!action.key) return;
    const frames = Math.min(ATLAS_COLS, Math.max(1, action.frames.reduce((acc, fr, idx) => frameHasContent(fr) ? idx + 1 : acc, 0)));
    animations[action.key] = {
      row,
      frames,
      frameDurations: Array.from({ length: frames }, (_, idx) => action.frameDurations?.[idx] ?? action.frameDurations?.[action.frameDurations.length - 1] ?? 120)
    };
  });
  return animations;
}

async function saveSpriteEditor(): Promise<void> {
  if (!state.editorPet) return;
  const actions = savableEditorActions();
  const rows = Math.max(1, actions.length);
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_COLS * ATLAS_CELL_WIDTH;
  atlas.height = rows * ATLAS_CELL_HEIGHT;
  const ctx = atlas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, atlas.width, atlas.height);
  actions.forEach((action, row) => {
    action.frames.forEach((frame, col) => {
      if (frameHasContent(frame)) ctx.drawImage(frame!, col * ATLAS_CELL_WIDTH, row * ATLAS_CELL_HEIGHT);
    });
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    atlas.toBlob((result) => result ? resolve(result) : reject(new Error("WebP 导出失败")), "image/webp", 0.96);
  });
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  const original = els.editorSave.textContent || "保存 WebP";
  els.editorSave.disabled = true;
  els.editorSave.textContent = "保存中...";
  try {
    const pet = await invoke<ProjectPet>("save_project_pet_spritesheet", {
      petId: state.editorPet.id,
      bytes,
      animations: editorAnimationsManifest(actions),
    });
    localStorage.setItem(LS_PET_ASSETS_VERSION, String(Date.now()));
    state.editorPet = pet;
    state.editorDirty = false;
    const index = state.projectPets.findIndex((item) => item.id === pet.id);
    if (index >= 0) state.projectPets[index] = pet;
    let pngStatus = "";
    for (const action of actions) {
      if (!action.pendingFramePngSave || !action.key || !(action.key in MODE_ACTION_PRESETS)) continue;
      const count = MODE_ACTION_PRESETS[action.key as ModeActionKey].frames;
      const frames = action.frames.slice(0, count);
      if (!frames.every((frame) => frameHasContent(frame)) || !frames[0]) continue;
      try {
        const savedImages = await saveGeneratedActionImages(frames.map((frame) => frame!.toDataURL("image/png")));
        action.pendingFramePngSave = false;
        if (savedImages.length) pngStatus = `，并保存最终分帧 PNG（${savedImages.length} 张）`;
      } catch (err) {
        pngStatus = `，但分帧 PNG 保存失败：${err instanceof Error ? err.message : String(err)}`;
      }
    }
    setStatus(els.editorStatus, `已保存为 ${pet.spritesheetPath}${pngStatus}。`);
  } catch (err) {
    setStatus(els.editorStatus, `保存失败：${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    els.editorSave.disabled = false;
    els.editorSave.textContent = original;
  }
}

async function saveGeneratedActionImages(images: string[]): Promise<string[]> {
  if (!isTauriRuntime() || !state.editorPet) return [];
  return await invoke<string[]>("save_project_pet_generated_images", {
    petId: state.editorPet.id,
    images: images.map((img) => ({ base64: dataUrlBase64(img) })),
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    if (src.startsWith("http://") || src.startsWith("https://")) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

async function loadImageFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlBase64(dataUrl: string): string {
  return dataUrl.split(",", 2)[1] || "";
}

function frameHasContent(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas) return false;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 12) return true;
  }
  return false;
}

function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

async function loadSpritesheetImage(pet: ProjectPet): Promise<HTMLImageElement> {
  if (!isTauriRuntime()) {
    return loadImageElement(projectPetSpriteUrl(pet));
  }
  const bytes = await invoke<number[]>("read_project_pet_spritesheet", { petId: pet.id });
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/webp" });
  const url = URL.createObjectURL(blob);
  try {
    return await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadProjectPetSpritesheetImage(pet: ProjectPet): Promise<HTMLImageElement> {
  return loadSpritesheetImage(pet);
}

function createEmptyFrameCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_CELL_WIDTH;
  canvas.height = ATLAS_CELL_HEIGHT;
  return canvas;
}

// 遍历动画配置，寻找行号对应的 Key 避开 TS 严格类型推导问题
function getPetAnimationKeyByRow(pet: ProjectPet, row: number): string | undefined {
  const anims = pet.animations as any;
  if (!anims) return undefined;
  for (const key of Object.keys(anims)) {
    if (anims[key] && anims[key].row === row) {
      return key;
    }
  }
  return undefined;
}

// 遍历动画配置，寻找行号对应的帧率列表
function getPetAnimationFrameDurationsByRow(pet: ProjectPet, row: number): number[] | undefined {
  const anims = pet.animations as any;
  if (!anims) return undefined;
  for (const key of Object.keys(anims)) {
    if (anims[key] && anims[key].row === row) {
      return anims[key].frameDurations;
    }
  }
  return undefined;
}

function createEmptyActionPreset(key: ModeActionKey): EditorAction {
  const preset = MODE_ACTION_PRESETS[key];
  return {
    name: preset.label,
    key,
    frameDurations: [...preset.frameDurations],
    frames: Array.from({ length: ATLAS_COLS }, () => null),
  };
}

function ensureDefaultModeActions(): void {
  for (const key of Object.keys(MODE_ACTION_PRESETS) as ModeActionKey[]) {
    if (!state.editorActions.some((act) => act.key === key)) {
      state.editorActions.push(createEmptyActionPreset(key));
    }
  }
}

function currentActionPrompt(): string {
  const action = state.editorActions[state.editorSelectedRow];
  if (!action) return "模式动作提示词";
  if (action.key === "merit") {
    return [
      `请根据我提供的参考图，生成一张用于桌宠功德模式的横版 4 帧 PNG。`,
      `角色要求：保持参考图中的角色形象不变，不要改变角色比例、发型、服装、颜色、描边和整体气质。`,
      `动作要求：生成 4 张连续动作帧，表现角色“坐立敲木鱼”的完整动作。`,
      `角色保持坐姿，身体朝向基本一致，动作自然连贯，敲木鱼的手始终是同一只手。`,
      `4帧分别为：`,
      `第1帧：角色安静坐好，单手准备敲木鱼，木鱼放在身前。`,
      `第2帧：角色举起木槌，准备下敲。`,
      `第3帧：木槌敲到木鱼，表现“咚”的动作感，可以有轻微震动线。`,
      `第4帧：木槌回弹，角色恢复到准备姿势，方便循环播放。`,
      `图片格式硬性要求：最终只输出一张横版 768x208 px PNG，由左至右严格排列 4 个 192x208 px 帧格，不留外边框、不留帧间距、不叠放。`,
      `一致性硬性要求：先复制参考图中的角色比例和占位作为四帧统一模板；四帧角色整体包围盒宽高必须相同，头顶高度、身体中心 x 坐标、脚底基线 y 坐标必须完全一致。`,
      `一致性硬性要求：四帧角色不得忽大忽小、不得左右漂移、不得上下跳动、不得改变镜头缩放或留白；木鱼在四帧中的大小和落点也必须固定。`,
      `动作变化限制：仅允许手臂、木槌及必要的轻微表情/敲击反馈发生变化，身体主体、发型、服装轮廓和脚底位置必须保持静止。`,
      `画面要求：每帧背景透明，每个 192x208 帧格内人物边距与参考图一致，角色不得越出自己的帧格。`,
      `不要添加复杂背景，不要添加文字，不要添加多余元素。木鱼和木槌要清晰可见。`,
      `保持像素风、粗描边、简单明暗、可爱表情。`,
      `输出复核：必须是一张横版 4 帧动作图，且是同一角色的连续动画帧，而不是四个大小或位置不同的独立插图。`
    ].join("\n\n");
  }
  if (action.key === "focus") {
    return [
      `请根据我提供的参考图，生成一张用于桌宠专注模式的横版 4 帧 PNG。角色保持坐姿或稳定姿势，头顶高度、身体中心 x 坐标和脚底基线 y 坐标在四帧中完全一致。采用简洁明暗、粗描边和专注的像素表情。不要添加复杂背景或文字。`,
      `4 帧动作描述：`,
      `第 1 帧 (静止准备)： 角色全神贯注地看着前方的 [道具，例如：一本书/一个空白屏幕/一盏灯]，双手合十或安静地放在腿上。`,
      `第 2 帧 (極小幅动作)： 角色保持静止，仅进行一个極小幅度的动作，例如一个缓慢的眨眼，或者轻微调整 [道具] 的位置。`,
      `第 3 帧 (极静状态 & 效果)： 角色完全静止，眼神极度专注。此时，在角色 [位置，例如：头顶/道具上] 出现一个简洁的像素 [效果，例如：一个代表“洞察”的小亮光/一个微小的“专注”光环]。`,
      `第 4 帧 (恢复 & 循环)： 效果消失，角色恢复到第 1 帧的静止专注姿势，准备平滑循环。`,
      `角色要求：保持参考图中的角色形象不变，不要改变角色比例、发型、服装、颜色、描边和整体气质。`,
      `图片格式硬性要求：最终只输出一张横版 768x208 px PNG，由左至右严格排列 4 个 192x208 px 帧格，不留外边框、不留帧间距、不叠放。`,
      `一致性硬性要求：先复制参考图中的角色比例和占位作为四帧统一模板；四帧角色整体包围盒宽高必须相同，头顶高度、身体中心 x 坐标、脚底基线 y 坐标必须完全一致。`,
      `一致性硬性要求：四帧角色不得忽大忽小、不得左右漂移、不得上下跳动、不得改变镜头缩放或留白。`,
      `画面要求：每帧背景透明，每个 192x208 帧格内人物边距与参考图一致，角色不得越出自己的帧格。`,
      `不要添加复杂背景，不要添加文字，不要添加多余元素。`,
      `保持像素风、粗描边、简单明暗、可爱表情。`,
      `输出复核：必须是一张横版 4 帧动作图，且是同一角色的连续动画帧，而不是四个大小或位置不同的独立插图。`
    ].join("\n\n");
  }
  if (action.key === "music") {
    return [
      `请根据我提供的参考图，生成一张用于桌宠音乐律动模式的横版 8 帧 PNG。`,
      `角色要求：保持参考图中的角色形象不变，不要改变角色比例、发型、服装、颜色、描边和整体气质。`,
      `动作要求：生成 8 张可以循环播放的轻快律动动作帧，表现角色跟随音乐舞动（街舞动作）。动作应可爱、有节奏感，但幅度克制，避免人物位置跳动。`,
      `8 帧动作要连贯，参考下面的要求生成：`,
      `帧1（静止）：standing, micro-side profile, relaxed arms, natural expression.`,
      `帧2（迈步）：side stepping, body weight shift, bent punching arm, preparation pose.`,
      `帧3（侧踢）：side kicking pose, arms extended, dynamic extension, mid-air freeze prep.`,
      `帧4（旋转）：spinning in mid-air, compact body, flowing cape, speed line effects.`,
      `帧5（倒立）：full inverted position, handstand freeze, legs spread in-air, dynamic balance, power move climax.`,
      `帧6（落地）：landing pose, smiling face, fists raised, downward momentum capture.`,
      `帧7（欢呼）：dual arms raised, celebrating, joyful expression, body tilting back.`,
      `帧8（收尾）：arm returning to side, settled expression, minor visual sparkle effect.`,
      `画面要求：每帧背景透明，每个 192x208 帧格内人物边距与参考图一致，角色不得越出自己的帧格。`,
      `保持像素风、粗描边、简单明暗、可爱表情。`,
      `总尺寸：1536x208 px`,
      `每帧尺寸：192x208 px`,
      `8 帧从左到右排列，无间距、无外边框。`,
      `每个角色及音符/特效必须完整位于自己的 192x208 格子内，不能越界。`
    ].join("\n\n");
  }
  return [
    `请基于参考图中的桌宠形象，生成「${action.name}」动作帧。`,
    `要求：透明背景，单帧尺寸 192x208 px，保持原角色发型、服装、颜色、描边 and 像素风一致。`,
    `一致性要求：所有动画帧使用同一角色包围盒大小、同一身体中心位置和同一脚底基线，仅动作肢体发生变化，不得改变角色比例、缩放或画面留白。`,
    `不要生成文字、UI、背景、阴影、地面、光效或额外角色。`,
    `如果是功德模式，请表现为敲木鱼；如果是专注模式，请表现为认真工作/专注；如果是音乐律动，请表现为跟随节奏轻微摆动。`,
    `输出应适合放入桌宠 spritesheet 的连续动作帧。`
  ].join("\n\n");
}

function updateActionPromptPreview(): void {
  els.imagePromptOutput.value = currentActionPrompt();
}

function stopEditorActionPreview(): void {
  if (state.editorPreviewTimer !== null) {
    window.clearTimeout(state.editorPreviewTimer);
    state.editorPreviewTimer = null;
  }
}

function drawSelectedEditorFrame(): void {
  stopEditorActionPreview();
  state.editorPreviewMode = "frame";
  const frame = state.editorActions[state.editorSelectedRow]?.frames[state.editorSelectedCol];
  const ctx = els.editorFrameCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
    if (frameHasContent(frame)) ctx.drawImage(frame!, 0, 0);
  }
  const action = state.editorActions[state.editorSelectedRow];
  els.editorFrameTitle.textContent = action ? `帧编辑：${action.name} · 第 ${state.editorSelectedCol + 1} 帧` : "帧编辑";
  els.editorPaste.disabled = !state.editorClipboard;
  updateEditorEraserUi();
}

function playSelectedEditorAction(frameIndex = 0): void {
  stopEditorActionPreview();
  state.editorPreviewMode = "action";
  const action = state.editorActions[state.editorSelectedRow];
  if (!action) {
    const ctx = els.editorFrameCanvas.getContext("2d");
    ctx?.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
    return;
  }
  const validIndices = action.frames.map((fr, idx) => frameHasContent(fr) ? idx : -1).filter((idx) => idx >= 0);
  els.editorPaste.disabled = !state.editorClipboard;
  updateEditorEraserUi();

  if (validIndices.length === 0) {
    const ctx = els.editorFrameCanvas.getContext("2d");
    ctx?.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
    return;
  }

  const activeIdx = frameIndex % validIndices.length;
  state.editorPreviewFrame = activeIdx;
  state.editorSelectedCol = validIndices[activeIdx];
  const ctx = els.editorFrameCanvas.getContext("2d");
  ctx?.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
  const frame = action.frames[state.editorSelectedCol];
  if (frameHasContent(frame)) ctx?.drawImage(frame!, 0, 0);

  const duration = action.frameDurations?.[state.editorSelectedCol] || 120;
  state.editorPreviewTimer = window.setTimeout(() => {
    playSelectedEditorAction(activeIdx + 1);
  }, duration);
}

function normalizeEditorSelection(): void {
  state.editorSelectedRow = Math.min(Math.max(0, state.editorSelectedRow), Math.max(0, state.editorActions.length - 1));
  state.editorSelectedCol = Math.min(Math.max(0, state.editorSelectedCol), ATLAS_COLS - 1);
}

// 抠图透明背景、包围盒及优化对齐等高级 Canvas 图像处理
function removeOuterBackgroundColor(imageData: ImageData): void {
  const data = imageData.data;
  const bgColors = getBorderColors(imageData);
  if (bgColors.length === 0) return;

  const visited = new Uint8Array(imageData.width * imageData.height);
  const queue: number[] = [];

  const check = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
    const idx = y * imageData.width + x;
    if (!visited[idx] && isMatchingBgColor(imageData, idx * 4, bgColors)) {
      visited[idx] = 1;
      queue.push(idx);
    }
  };

  for (let x = 0; x < imageData.width; x++) {
    check(x, 0);
    check(x, imageData.height - 1);
  }
  for (let y = 1; y < imageData.height - 1; y++) {
    check(0, y);
    check(imageData.width - 1, y);
  }

  for (let q = 0; q < queue.length; q++) {
    const idx = queue[q];
    const x = idx % imageData.width;
    const y = Math.floor(idx / imageData.width);
    data[idx * 4 + 3] = 0;
    check(x + 1, y);
    check(x - 1, y);
    check(x, y + 1);
    check(x, y - 1);
  }
}

function getBorderColors(imageData: ImageData): [number, number, number][] {
  const counts = new Map<string, { r: number; g: number; b: number; count: number }>();
  const add = (x: number, y: number) => {
    const color = getPixelColor(imageData, x, y);
    if (!color) return;
    const [r, g, b, a] = color;
    if (a < 16) return;
    const key = `${Math.round(r / 8)},${Math.round(g / 8)},${Math.round(b / 8)}`;
    const cur = counts.get(key);
    if (cur) {
      cur.r += r; cur.g += g; cur.b += b; cur.count++;
    } else {
      counts.set(key, { r, g, b, count: 1 });
    }
  };

  for (let x = 0; x < imageData.width; x++) {
    add(x, 0);
    add(x, imageData.height - 1);
  }
  for (let y = 1; y < imageData.height - 1; y++) {
    add(0, y);
    add(imageData.width - 1, y);
  }

  const totalBorderPixels = imageData.width * 2 + imageData.height * 2 - 4;
  const threshold = Math.max(4, Math.round(totalBorderPixels * 0.025));

  return [...counts.values()]
    .filter((c) => c.count >= threshold)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((c) => [Math.round(c.r / c.count), Math.round(c.g / c.count), Math.round(c.b / c.count)]);
}

// 修复 RGB 对比类型隐式 any
function isMatchingBgColor(imageData: ImageData, offset: number, bgColors: [number, number, number][]): boolean {
  const data = imageData.data;
  if (data[offset + 3] < 16) return true;
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return bgColors.some(([br, bg, bb]) => Math.hypot(r - br, g - bg, b - bb) <= 30);
}

function getPixelColor(imageData: ImageData, x: number, y: number): [number, number, number, number] | null {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return null;
  const offset = (y * imageData.width + x) * 4;
  return [imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2], imageData.data[offset + 3]];
}

function getBoundingBox(imageData: ImageData): { left: number; top: number; right: number; bottom: number } | null {
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const idx = (y * imageData.width + x) * 4;
      if (imageData.data[idx + 3] >= 12) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return maxX >= minX && maxY >= minY ? { left: minX, top: minY, right: maxX, bottom: maxY } : null;
}

function cropAndAutoCenterImage(image: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = image.width;
  tempCanvas.height = image.height;
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!tempCtx) return tempCanvas;
  tempCtx.drawImage(image, 0, 0);

  const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  removeOuterBackgroundColor(imgData);
  tempCtx.putImageData(imgData, 0, 0);

  const bounds = getBoundingBox(imgData);
  if (!bounds) return tempCanvas;

  const cropped = document.createElement("canvas");
  cropped.width = bounds.right - bounds.left + 1;
  cropped.height = bounds.bottom - bounds.top + 1;
  const croppedCtx = cropped.getContext("2d");
  croppedCtx?.drawImage(tempCanvas, bounds.left, bounds.top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped;
}

function getPixelFeatureList(imageData: ImageData): { x: number; y: number; r: number; g: number; b: number }[] {
  const list: { x: number; y: number; r: number; g: number; b: number }[] = [];
  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      if ((x + y) % 2 !== 0) continue;
      const idx = (y * imageData.width + x) * 4;
      if (imageData.data[idx + 3] < 48) continue;
      list.push({ x, y, r: imageData.data[idx], g: imageData.data[idx + 1], b: imageData.data[idx + 2] });
    }
  }
  return list;
}

function calculateOptimalOffset(templateFeatures: { x: number; y: number; r: number; g: number; b: number }[], targetData: ImageData): { dx: number; dy: number } {
  const bounds = getBoundingBox(targetData);
  if (!templateFeatures.length || !bounds) return { dx: 0, dy: 0 };

  let best = { dx: 0, dy: 0, score: -Infinity };

  for (let dy = -24; dy <= 24; dy++) {
    if (bounds.top + dy < 0 || bounds.bottom + dy >= ATLAS_CELL_HEIGHT) continue;
    for (let dx = -24; dx <= 24; dx++) {
      if (bounds.left + dx < 0 || bounds.right + dx >= ATLAS_CELL_WIDTH) continue;

      let score = -(Math.abs(dx) + Math.abs(dy)) * 0.05;
      for (const feat of templateFeatures) {
        const tx = feat.x - dx;
        const ty = feat.y - dy;
        if (tx < 0 || ty < 0 || tx >= targetData.width || ty >= targetData.height) {
          score -= 8; continue;
        }
        const offset = (ty * targetData.width + tx) * 4;
        if (targetData.data[offset + 3] < 48) {
          score -= 8; continue;
        }
        const diff = Math.abs(feat.r - targetData.data[offset]) +
          Math.abs(feat.g - targetData.data[offset + 1]) +
          Math.abs(feat.b - targetData.data[offset + 2]);
        score += diff <= 18 ? 14 : diff <= 54 ? 7 : diff <= 96 ? 2 : -2;
      }

      if (score > best.score) {
        best = { dx, dy, score };
      }
    }
  }

  return { dx: best.dx, dy: best.dy };
}

function moveFrameOffset(frame: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement {
  if (dx === 0 && dy === 0) return P(frame)!;
  const canvas = createEmptyFrameCanvas();
  canvas.getContext("2d")?.drawImage(frame, dx, dy);
  return canvas;
}

function isStripImageFrameValid(action: EditorAction, col: number): boolean {
  return !!action.stripSource && !!action.stripOffsets && col >= 0 && col < (action.stripFrameCount || 0);
}

// 修正 isStripImageFrameValid 使用
function getStripImageFrame(action: EditorAction, col: number): HTMLCanvasElement | null {
  if (!isStripImageFrameValid(action, col)) return null;
  const canvas = createEmptyFrameCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const offset = action.stripOffsets![col];
  ctx.drawImage(action.stripSource!, offset.x - col * ATLAS_CELL_WIDTH, offset.y);
  return canvas;
}

function getStripFrames(action: EditorAction): HTMLCanvasElement[] {
  if (!action.stripSource || !action.stripFrameCount || !action.stripOffsets) return [];
  return Array.from({ length: action.stripFrameCount }, (_, idx) => getStripImageFrame(action, idx) || createEmptyFrameCanvas());
}

function clearStripImageSource(action: EditorAction): void {
  action.stripSource = undefined;
  action.stripFrameCount = undefined;
  action.stripOffsets = undefined;
}

async function optimizeActionFramesAlignment(): Promise<void> {
  const action = state.editorActions[state.editorSelectedRow];
  if (!action) {
    setStatus(els.editorStatus, "请先选择需要优化的动作。", true);
    return;
  }
  const validIndices = action.frames.map((fr, idx) => frameHasContent(fr) ? idx : -1).filter((idx) => idx >= 0);
  if (validIndices.length < 2) {
    setStatus(els.editorStatus, "当前动作至少需要两张有效帧才能优化对齐。", true);
    return;
  }

  const templateFrame = action.frames[validIndices[0]];
  const templateCtx = templateFrame?.getContext("2d", { willReadFrequently: true });
  const templateData = templateCtx?.getImageData(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
  if (!templateData) return;

  const templateFeatures = getPixelFeatureList(templateData);
  const alignedList: string[] = [];

  for (const idx of validIndices.slice(1)) {
    const frame = action.frames[idx];
    const frameCtx = frame?.getContext("2d", { willReadFrequently: true });
    const frameData = frameCtx?.getImageData(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
    if (!frame || !frameData) continue;

    const offset = calculateOptimalOffset(templateFeatures, frameData);
    if (offset.dx === 0 && offset.dy === 0) continue;

    if (isStripImageFrameValid(action, idx)) {
      action.stripOffsets![idx].x += offset.dx;
      action.stripOffsets![idx].y += offset.dy;
      action.frames[idx] = getStripImageFrame(action, idx);
    } else {
      action.frames[idx] = moveFrameOffset(frame, offset.dx, offset.dy);
    }
    alignedList.push(`第${idx + 1}帧(${offset.dx >= 0 ? "+" : ""}${offset.dx}, ${offset.dy >= 0 ? "+" : ""}${offset.dy})`);
  }

  if (alignedList.length === 0) {
    setStatus(els.editorStatus, `「${action.name}」关键像素已对齐，无需调整。`);
    return;
  }

  clearEditorUndoStates();
  clearEditorMoveUndoStates();
  if (action.key && action.key in MODE_ACTION_PRESETS) {
    action.pendingFramePngSave = true;
  }
  state.editorDirty = true;
  renderSpriteEditorGrid();
  playSelectedEditorAction();
  setStatus(els.editorStatus, `已优化「${action.name}」对齐：${alignedList.join("、")}。保存时将生成最终分帧 PNG。`);
}

async function At(event: ClipboardEvent): Promise<void> {
  if (state.view !== "editor") return;
  const item = [...(event.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (!file) {
    const isEditingText = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (!isEditingText && state.editorClipboard) {
      event.preventDefault();
      pasteSelectedEditorFrame();
    }
    return;
  }
  event.preventDefault();

  if (state.editorSelectionType === "action") {
    await importActionStripImage(file);
  } else {
    await replaceSelectedEditorFrame(file);
    setStatus(els.editorStatus, "已从剪贴板粘贴图片到当前帧。");
  }
}

function at(dx: number, dy: number, frame: HTMLCanvasElement): boolean {
  const action = state.editorActions[state.editorSelectedRow];
  if (!action || !frame || (dx === 0 && dy === 0)) return false;
  if (isStripImageFrameValid(action, state.editorSelectedCol)) {
    const offset = action.stripOffsets![state.editorSelectedCol];
    offset.x += dx;
    offset.y += dy;
    action.frames[state.editorSelectedCol] = getStripImageFrame(action, state.editorSelectedCol);
  } else {
    action.frames[state.editorSelectedCol] = moveFrameOffset(frame, dx, dy);
  }
  if (action.key && action.key in MODE_ACTION_PRESETS) {
    action.pendingFramePngSave = true;
  }
  state.editorDirty = true;
  V(action.frames[state.editorSelectedCol]);
  return true;
}

function V(canvas: HTMLCanvasElement | null): void {
  const ctx = els.editorFrameCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
    if (canvas) ctx.drawImage(canvas, 0, 0);
  }
}
let activePreviewIntervals: number[] = [];

// 2. 创意工坊核心动作列表渲染
function renderWorkshop(): void {
  activePreviewIntervals.forEach(clearInterval);
  activePreviewIntervals = [];
  els.workshopGrid.replaceChildren();

  const query = state.workshopSearchQuery.trim().toLowerCase();
  const filterType = state.workshopFilterType;

  // 根据搜索词和模式筛选动作
  let filtered = state.workshopItems.filter((item) => {
    const matchSearch =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.author && item.author.toLowerCase().includes(query));
    const matchFilter = filterType === "all" || item.actionType === filterType;
    return matchSearch && matchFilter;
  });

  // 如果筛选了“仅展示已下载桌宠的扩展包”（升级为大小写无关的强健安全过滤匹配）
  if (state.currentWorkshopTag === "downloaded") {
    const downloadedPetIds = new Set(state.projectPets.map((p) => p.id.toLowerCase()));
    filtered = filtered.filter((item) => {
      if (!item.petId) return false;
      return downloadedPetIds.has(item.petId.toLowerCase());
    });
  }

  if (filtered.length === 0) {
    els.workshopGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: rgba(120, 100, 80, 0.4); font-size: 14px;">未找到匹配的社区动作，刷新或清除条件重试</div>`;
    setStatus(els.workshopStatus, "未找到匹配的社区动作。");
    return;
  }

  // 动态更新筛选计数值！支持在切换选项卡时立即呈现精确的当前可用条数与差异化高特征提示！
  if (state.currentWorkshopTag === "downloaded") {
    setStatus(els.workshopStatus, `已展示 ${filtered.length} 个已下载桌宠的动作扩展包。`);
  } else {
    setStatus(els.workshopStatus, `共 ${filtered.length} 个动作扩展包。`);
  }

  const fragment = document.createDocumentFragment();

  for (const item of filtered) {
    // 动作帧预览图盒子 (左侧，56x60 等比例精致缩减显示，完美对齐 72px 列并防止任何溢出与重叠)
    const previewContainer = document.createElement("div");
    previewContainer.className = "workshop-sprite-preview";
    previewContainer.style.width = "56px";
    previewContainer.style.height = "60px";
    previewContainer.style.borderRadius = "6px";
    previewContainer.style.overflow = "hidden";

    // 使用精细背景子属性单独赋值，彻底避免 background 简写重置并失效为 auto auto 的渲染 Bug
    previewContainer.style.backgroundImage = `url("${item.imageUrl}")`;
    previewContainer.style.backgroundRepeat = "no-repeat";
    previewContainer.style.backgroundPosition = "0px 0px";
    previewContainer.style.backgroundSize = `${item.framesCount * 56}px 60px`;
    previewContainer.style.border = "1px solid rgba(180,160,140,0.15)";
    previewContainer.style.imageRendering = "pixelated";
    previewContainer.style.transition = "none";
    previewContainer.style.animation = "none";

    // 使用 JS 定时器进行极其平滑的原地帧图逐帧播放，防滑行 Bug
    let currentFrame = 0;
    const interval = window.setInterval(() => {
      currentFrame = (currentFrame + 1) % item.framesCount;
      previewContainer.style.backgroundPositionX = `${-currentFrame * 56}px`;
    }, item.frameDuration || 120);
    activePreviewIntervals.push(interval);

    // 模式徽章 (titleExtra)
    const badgeSpan = document.createElement("span");
    badgeSpan.className = "pet-tag-badge";
    if (item.actionType === "focus") {
      badgeSpan.textContent = "专注";
      badgeSpan.style.background = "rgba(59, 130, 246, 0.12)";
      badgeSpan.style.color = "#1e40af";
      badgeSpan.style.borderColor = "rgba(59, 130, 246, 0.25)";
    } else if (item.actionType === "music") {
      badgeSpan.textContent = "律动";
      badgeSpan.style.background = "rgba(16, 185, 129, 0.12)";
      badgeSpan.style.color = "#065f46";
      badgeSpan.style.borderColor = "rgba(16, 185, 129, 0.25)";
    } else if (item.actionType === "merit") {
      badgeSpan.textContent = "功德";
      badgeSpan.style.background = "rgba(139, 92, 246, 0.12)";
      badgeSpan.style.color = "#5b21b6";
      badgeSpan.style.borderColor = "rgba(139, 92, 246, 0.25)";
    }

    const titleExtra = document.createElement("div");
    titleExtra.className = "pet-title-extra";
    titleExtra.append(badgeSpan);

    // 右侧一键套用按钮
    const applyBtn = document.createElement("button");
    applyBtn.className = "summon-button";
    applyBtn.type = "button";
    applyBtn.textContent = "一键套用";
    applyBtn.addEventListener("click", () => void choosePetToApply(item));

    // 调用 renderListRow 生成卡片行
    const rowEl = renderListRow({
      title: item.title,
      subtitle: `作者：${item.author || "匿名大佬"} · 共 ${item.framesCount} 帧 · 帧率 ${item.frameDuration}ms`,
      spriteUrl: item.imageUrl,
      actions: [applyBtn],
      titleExtra,
      customPreview: previewContainer,
    });

    // 动态在 info 区域附加 AI Prompt 容器
    const infoContainer = rowEl.querySelector(".pet-info");
    if (infoContainer) {
      const promptDiv = document.createElement("div");
      promptDiv.style.fontSize = "12px";
      promptDiv.style.color = "rgba(129, 118, 103, 0.65)";
      promptDiv.style.marginTop = "6px";
      promptDiv.style.cursor = "pointer";
      promptDiv.style.textOverflow = "ellipsis";
      promptDiv.style.whiteSpace = "nowrap";
      promptDiv.style.overflow = "hidden";
      promptDiv.style.maxWidth = "350px";
      promptDiv.title = "点击复制该动作的 AI Prompt 描述词";
      promptDiv.textContent = `Prompt: ${item.promptUsed || "暂无描述"}`;
      promptDiv.addEventListener("click", () => {
        void copyTextToClipboard(item.promptUsed || "").then(() => {
          setStatus(els.workshopStatus, "已成功复制动作 Prompt 提示词到剪贴板！");
        });
      });
      infoContainer.append(promptDiv);
    }

    fragment.append(rowEl);
  }

  els.workshopGrid.append(fragment);
}

// 获取动作与宠物的同名匹配度分值 (智能算法)
function getMatchScore(itemTitle: string, pet: ProjectPet): number {
  const titleLower = itemTitle.toLowerCase();
  const petNameLower = pet.displayName.toLowerCase();
  const petIdLower = pet.id.toLowerCase();

  if (titleLower.includes(petNameLower) || petNameLower.includes(titleLower)) return 100;
  if (titleLower.includes(petIdLower) || petIdLower.includes(titleLower)) return 90;

  // 切词局部匹配
  const words = petNameLower.split(/[\s\-_\(\)]+/).filter((w) => w.length > 1);
  for (const word of words) {
    if (titleLower.includes(word)) return 50;
  }
  return 0;
}

async function choosePetToApply(item: WorkshopItem): Promise<void> {
  if (state.projectPets.length === 0 && state.marketPets.length === 0) {
    window.alert("本地宠物及市场列表为空，请先检查网络或导入宠物。");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "workshop-apply-overlay";

  const modal = document.createElement("div");
  modal.className = "workshop-apply-dialog";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "workshop-apply-title");

  let previewTimers: number[] = [];
  const stopPreviewAnimations = (): void => {
    previewTimers.forEach((timer) => window.clearTimeout(timer));
    previewTimers = [];
  };
  const closeModal = (): void => {
    stopPreviewAnimations();
    document.removeEventListener("keydown", handleDialogKeydown);
    overlay.remove();
  };
  const handleDialogKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeModal();
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });

  const header = document.createElement("header");
  header.className = "workshop-apply-header";

  const eyebrow = document.createElement("p");
  eyebrow.className = "workshop-apply-eyebrow";
  eyebrow.textContent = "套用社区动作";

  const title = document.createElement("h3");
  title.id = "workshop-apply-title";
  title.textContent = item.title;

  const description = document.createElement("p");
  description.className = "workshop-apply-description";
  description.textContent = "选择套用目标。若原配桌宠尚未下载，可先下载后直接应用。";

  header.append(eyebrow, title, description);

  let localPets = state.projectPets.filter((p) => !p.builtin);
  let exactLocalMatch = localPets.find((p) => p.id === item.petId);

  let showVirtualItem = !exactLocalMatch;
  let marketPet: MarketPet | null = null;

  if (showVirtualItem) {
    marketPet = state.marketPets.find(p => p.slug.toLowerCase() === item.petId.toLowerCase()) || null;
    if (!marketPet) {
      fetch(new URL("/api/pets", API_BASE))
        .then(resp => {
          if (resp.ok) return resp.json();
          throw new Error("API error");
        })
        .then(data => {
          if (data && Array.isArray(data.pets)) {
            state.marketPets = data.pets;
            const found = state.marketPets.find(p => p.slug.toLowerCase() === item.petId.toLowerCase());
            if (found) {
              marketPet = found;
              renderList(searchInput.value.trim().toLowerCase());
            }
          }
        })
        .catch(e => {
          console.warn("创意工坊获取市场列表用于推荐下载时受阻：", e);
        });
    }
    if (!marketPet) {
      marketPet = {
        slug: item.petId,
        display_name: item.petId,
        downloadUrl: `${API_BASE}/api/download/${item.petId}`,
        spritesheetUrl: item.imageUrl
      };
    }
  }

  let petsWithScores = localPets.map((pet) => ({
    pet,
    score: getMatchScore(item.title, pet) + (pet.id === item.petId ? 1000 : 0),
  }));
  petsWithScores.sort((a, b) => b.score - a.score);

  let recommendedPet = exactLocalMatch || (petsWithScores[0]?.score > 0 ? petsWithScores[0].pet : null);
  let hasMatchingPet = !!recommendedPet;
  let selectedPet: ProjectPet | null = recommendedPet;

  const searchField = document.createElement("label");
  searchField.className = "workshop-apply-search";
  const searchLabel = document.createElement("span");
  searchLabel.textContent = "搜索本地桌宠";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "输入名称查找可套用的桌宠";
  searchField.append(searchLabel, searchInput);

  const list = document.createElement("div");
  list.className = "workshop-apply-list";
  list.setAttribute("aria-label", "可套用的桌宠列表");

  const previewAnimations = new Map<string, FrameAnimation>();
  const randomAnimationForPet = (pet: ProjectPet): FrameAnimation => {
    const selectedAnimation = previewAnimations.get(pet.id);
    if (selectedAnimation) return selectedAnimation;
    const customAnimations = Object.values(pet.animations || {}) as FrameAnimation[];
    const animations = [...DEFAULT_PREVIEW_ANIMATIONS, ...customAnimations].filter((animation) => animation.frames > 0);
    const animation = animations[Math.floor(Math.random() * animations.length)] || DEFAULT_PREVIEW_ANIMATIONS[0];
    previewAnimations.set(pet.id, animation);
    return animation;
  };

  const createAvatar = (
    src: string,
    name: string,
    animation: FrameAnimation,
    columns: number = ATLAS_COLS,
  ): HTMLElement => {
    const avatar = document.createElement("div");
    avatar.className = "workshop-apply-avatar";
    const sprite = document.createElement("div");
    sprite.className = "workshop-apply-sprite";
    sprite.style.backgroundImage = `url("${src}")`;
    sprite.style.backgroundSize = `${Math.max(1, columns) * 48}px auto`;
    sprite.setAttribute("role", "img");
    sprite.setAttribute("aria-label", `${name} 动作预览`);

    let frame = 0;
    const drawFrame = (): void => {
      sprite.style.backgroundPosition = `${-frame * 48}px ${-animation.row * 52}px`;
    };
    const advance = (): void => {
      frame = (frame + 1) % animation.frames;
      drawFrame();
      const delay = animation.frameDurations[frame] || animation.frameDurations[animation.frameDurations.length - 1] || 140;
      previewTimers.push(window.setTimeout(advance, delay));
    };
    drawFrame();
    previewTimers.push(window.setTimeout(advance, animation.frameDurations[0] || 140));
    avatar.append(sprite);
    return avatar;
  };

  const createMatchBadge = (text: string, variant: string): HTMLElement => {
    const badge = document.createElement("span");
    badge.className = `workshop-match-badge ${variant}`;
    badge.textContent = text;
    return badge;
  };

  const renderList = (filterQuery = "") => {
    stopPreviewAnimations();
    list.replaceChildren();

    const virtualMatched = showVirtualItem && marketPet && (
      !filterQuery ||
      marketPet.slug.toLowerCase().includes(filterQuery) ||
      (marketPet.display_name && marketPet.display_name.toLowerCase().includes(filterQuery))
    );

    if (virtualMatched && marketPet) {
      const petRow = document.createElement("div");
      petRow.className = "workshop-apply-pet download-required";

      const infoBox = document.createElement("div");
      infoBox.className = "workshop-apply-pet-info";

      const nameEl = document.createElement("div");
      nameEl.className = "workshop-apply-pet-name";
      const petName = document.createElement("strong");
      petName.textContent = marketPet.display_name || marketPet.slug;
      nameEl.append(petName, createMatchBadge("原配 · 待下载", "pending"));

      const idEl = document.createElement("div");
      idEl.className = "workshop-apply-pet-meta";
      idEl.textContent = "下载原配桌宠后即可应用该动作";

      infoBox.append(nameEl, idEl);

      const downloadBtn = document.createElement("button");
      downloadBtn.className = "primary-button workshop-download-button";
      downloadBtn.type = "button";
      downloadBtn.textContent = "下载原配桌宠";

      let isDownloading = false;
      downloadBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isDownloading) return;
        isDownloading = true;
        downloadBtn.disabled = true;
        downloadBtn.textContent = "下载中...";
        try {
          if (!marketPet) throw new Error("无法获取市场桌宠下载配置。");
          await invoke<ProjectPet>("download_pet_to_project", {
            petId: marketPet.slug,
            downloadUrl: marketDownloadUrl(marketPet),
          });

          await loadProjectPets();

          localPets = state.projectPets.filter((p) => !p.builtin);
          exactLocalMatch = localPets.find((p) => p.id === item.petId);

          petsWithScores = localPets.map((pet) => ({
            pet,
            score: getMatchScore(item.title, pet) + (pet.id === item.petId ? 1000 : 0),
          }));
          petsWithScores.sort((a, b) => b.score - a.score);

          recommendedPet = exactLocalMatch || (petsWithScores[0]?.score > 0 ? petsWithScores[0].pet : null);
          hasMatchingPet = !!recommendedPet;

          showVirtualItem = false;
          selectedPet = exactLocalMatch || null;

          renderList(searchInput.value.trim().toLowerCase());
          updateConfirmButtonState();
        } catch (err) {
          console.error(err);
          window.alert(`下载失败：${err}`);
          downloadBtn.disabled = false;
          downloadBtn.textContent = "下载原配桌宠";
          isDownloading = false;
        }
      });

      const actionPreview: FrameAnimation = {
        row: 0,
        frames: item.framesCount,
        frameDurations: Array.from({ length: item.framesCount }, () => item.frameDuration),
      };
      petRow.append(createAvatar(item.imageUrl, marketPet.display_name || marketPet.slug, actionPreview, item.framesCount), infoBox, downloadBtn);
      list.append(petRow);
    }

    const filteredPets = petsWithScores.filter((entry) => {
      return (
        !filterQuery ||
        entry.pet.displayName.toLowerCase().includes(filterQuery) ||
        entry.pet.id.toLowerCase().includes(filterQuery)
      );
    });

    if (filteredPets.length === 0 && !virtualMatched) {
      const hint = document.createElement("p");
      hint.className = "workshop-apply-empty";
      hint.textContent = "未找到匹配的本地宠物。";
      list.append(hint);
      return;
    }

    filteredPets.forEach((entry) => {
      const { pet } = entry;
      const isRecommended = recommendedPet && pet.id === recommendedPet.id;
      const isSelected = selectedPet && pet.id === selectedPet.id;

      const petRow = document.createElement("button");
      petRow.className = "workshop-apply-pet selectable";
      petRow.classList.toggle("selected", Boolean(isSelected));
      petRow.classList.toggle("recommended", Boolean(isRecommended));
      petRow.type = "button";
      petRow.setAttribute("aria-pressed", String(Boolean(isSelected)));

      const infoBox = document.createElement("div");
      infoBox.className = "workshop-apply-pet-info";

      const nameEl = document.createElement("div");
      nameEl.className = "workshop-apply-pet-name";
      const name = document.createElement("strong");
      name.textContent = pet.displayName;
      nameEl.append(name);

      if (isSelected) {
        if (isRecommended) {
          nameEl.append(createMatchBadge("推荐原配 · 已选中", "selected"));
        } else {
          nameEl.append(createMatchBadge("已选中", "selected"));
        }
      } else if (isRecommended) {
        nameEl.append(createMatchBadge("推荐原配", "recommend"));
      }

      const idEl = document.createElement("div");
      idEl.className = "workshop-apply-pet-meta";
      idEl.textContent = pet.id;

      infoBox.append(nameEl, idEl);
      petRow.append(createAvatar(projectPetSpriteUrl(pet), pet.displayName, randomAnimationForPet(pet)), infoBox);

      petRow.addEventListener("click", () => {
        selectedPet = pet;
        renderList(searchInput.value.trim().toLowerCase());
        updateConfirmButtonState();
      });

      list.append(petRow);
    });
  };

  renderList();

  searchInput.addEventListener("input", () => {
    renderList(searchInput.value.trim().toLowerCase());
  });

  const actionRow = document.createElement("div");
  actionRow.className = "workshop-apply-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary-button workshop-apply-action";
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => closeModal());

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "primary-button workshop-apply-action";
  confirmBtn.type = "button";
  confirmBtn.textContent = "应用";

  const updateConfirmButtonState = () => {
    confirmBtn.disabled = !selectedPet;
  };

  confirmBtn.addEventListener("click", () => {
    if (!selectedPet) {
      window.alert("请先选择要套用动作的目标桌宠！");
      return;
    }

    const isRecommended = recommendedPet && selectedPet.id === recommendedPet.id;
    if (hasMatchingPet && !isRecommended) {
      const proceed = window.confirm(
        `⚠️ 【跨宠物套用温馨提示】\n\n您当前选中的套用目标为非同名宠物：「${selectedPet.displayName}」。\n\n由于不同角色的原雪碧图结构、身体缩放偏移以及各个模式动作的帧数与此社区动作不一致，非同名跨宠物强行套用可能会导致后续画面出现错位、缩放混乱或播放异常！\n\n您确定要继续套用此动作到「${selectedPet.displayName}」吗？`
      );
      if (!proceed) return;
    }

    closeModal();
    void applyCommunityActionToPet(item, selectedPet);
  });

  updateConfirmButtonState();

  actionRow.append(cancelBtn, confirmBtn);
  modal.append(header, searchField, list, actionRow);
  overlay.append(modal);
  document.body.append(overlay);
  document.addEventListener("keydown", handleDialogKeydown);
  searchInput.focus();
}

async function applyCommunityActionToPet(item: WorkshopItem, pet: ProjectPet): Promise<void> {
  setStatus(els.workshopStatus, `正在为 ${pet.displayName} 下载并写入「${item.title}」动作...`);
  try {
    const image = await loadImageElement(item.imageUrl);
    const origImage = await loadSpritesheetImage(pet);

    const origCols = ATLAS_COLS;
    const origRows = Math.max(1, Math.floor(origImage.height / ATLAS_CELL_HEIGHT));
    const animations = pet.animations || {};
    let targetRow = 0;
    let isNewRow = false;

    if (animations[item.actionType]) {
      targetRow = animations[item.actionType].row;
    } else {
      targetRow = origRows;
      isNewRow = true;
    }

    const newRows = isNewRow ? origRows + 1 : origRows;
    const canvas = document.createElement("canvas");
    canvas.width = origCols * ATLAS_CELL_WIDTH;
    canvas.height = newRows * ATLAS_CELL_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画板。");

    ctx.drawImage(origImage, 0, 0);
    ctx.clearRect(0, targetRow * ATLAS_CELL_HEIGHT, canvas.width, ATLAS_CELL_HEIGHT);
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, targetRow * ATLAS_CELL_HEIGHT, item.framesCount * ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("WebP 转换失败")), "image/webp", 0.96);
    });
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));

    const nextAnimations = { ...animations };
    nextAnimations[item.actionType] = {
      row: targetRow,
      frames: item.framesCount,
      frameDurations: Array.from({ length: item.framesCount }, () => item.frameDuration)
    };

    const updatedPet = await invoke<ProjectPet>("save_project_pet_spritesheet", {
      petId: pet.id,
      bytes,
      animations: nextAnimations
    });

    localStorage.setItem(LS_PET_ASSETS_VERSION, String(Date.now()));
    const index = state.projectPets.findIndex((p) => p.id === pet.id);
    if (index >= 0) state.projectPets[index] = updatedPet;

    if (state.editorPet && state.editorPet.id === pet.id) {
      void openSpriteEditor(updatedPet);
    }

    window.alert(`🎉 套用成功！动作「${item.title}」已无缝集成到桌宠 ${pet.displayName} 中！召唤它即可在对应模式下自动播放！`);
    setStatus(els.workshopStatus, `成功将「${item.title}」动作套用到 ${pet.displayName}！`);
  } catch (err) {
    console.error(err);
    window.alert(`套用动作失败：${err instanceof Error ? err.message : String(err)}`);
    setStatus(els.workshopStatus, `套用动作失败：${err instanceof Error ? err.message : String(err)}`, true);
  }
}

async function fetchWorkshopItems(): Promise<void> {
  setStatus(els.workshopStatus, "正在同步云端创意工坊动作包...");

  // 动作索引是静态内容，按可用性在三个公共分发源之间回退。
  const endpoints = [
    "https://raw.gitmirror.com/ZhangYiLong416/LingoPet-workshop/main/patches/index.json",
    "https://raw.githubusercontent.com/ZhangYiLong416/LingoPet-workshop/main/patches/index.json",
    "https://fastly.jsdelivr.net/gh/ZhangYiLong416/LingoPet-workshop@main/patches/index.json"
  ];

  let lastError: Error | null = null;
  let successData: any = null;

  for (let i = 0; i < endpoints.length; i++) {
    const apiBase = endpoints[i];
    try {
      const listUrl = new URL(apiBase);
      listUrl.searchParams.set("t", String(Date.now())); // 追加随机时间戳，彻底击穿 WebView/CDN 本地缓存

      const resp = await fetch(listUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (Array.isArray(data)) {
        successData = data;
        break; // 成功拉取到合规 of 数组结构，终止轮询！
      } else {
        throw new Error("数据格式不合规");
      }
    } catch (err) {
      console.warn(`创意工坊通道 [${apiBase}] 同步受阻，正在自动跳转备用熔断降级通道...`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (successData !== null) {
    // 【殿堂级源头数据清洗与防白板网络拦截】
    // 将所有 item.imageUrl 中的 raw.githubusercontent.com 无缝转化为极速稳定的 GitMirror 加速域名！
    // 彻底防范和消除了接下来在渲染动图预览和执行“一键套用”网络下载 WebP 时因直连 GitHub 发生 Failed to fetch 的惨剧！
    state.workshopItems = successData.map((item: any) => {
      if (item && item.imageUrl && typeof item.imageUrl === "string") {
        item.imageUrl = item.imageUrl.replace("https://raw.githubusercontent.com/", "https://raw.gitmirror.com/");
      }
      return item;
    });

    setStatus(els.workshopStatus, `共 ${state.workshopItems.length} 个动作扩展包。`);
    renderWorkshop();
  } else {
    console.error("创意工坊所有高可用同步通道均告折戟：", lastError);
    setStatus(
      els.workshopStatus,
      `创意工坊同步失败：所有网络通道已熔断。请检查本地网络或关闭代理防火墙安全拦截。(错误：${lastError ? lastError.message : "未知"})`,
      true
    );
  }
}

// ==========================================
// 创意工坊动作分享功能实现 (TS 完美版)
// ==========================================
async function shareCurrentActionToCommunity(): Promise<void> {
  const action = state.editorActions[state.editorSelectedRow];
  if (!action || !state.editorPet) {
    window.alert("请先选择左侧要分享的动作。");
    return;
  }

  if (!action.key || !(action.key in MODE_ACTION_PRESETS)) {
    window.alert("仅支持分享功德模式、专注模式及音乐律动三类精选模式动作。");
    return;
  }

  const framesCount = MODE_ACTION_PRESETS[action.key as ModeActionKey].frames;
  const frames = action.frames.slice(0, framesCount);
  if (!frames.every((frame) => frameHasContent(frame))) {
    window.alert("请先在此动作导入并生成完毕横版帧图后，再进行分享。");
    return;
  }

  const defaultTitle = `${state.editorPet.displayName} - ${action.name}`;
  const defaultAuthor = localStorage.getItem("workshop_author") || "";

  const shareMeta = await new Promise<{ author: string; description: string } | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.6)";
    overlay.style.backdropFilter = "blur(10px)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";

    const modal = document.createElement("div");
    modal.className = "editor-card";
    modal.style.width = "400px";
    modal.style.padding = "24px";
    modal.style.borderRadius = "12px";
    modal.style.background = "rgba(30, 30, 40, 0.95)";
    modal.style.border = "1px solid rgba(255,255,255,0.1)";

    const titleEl = document.createElement("h3");
    titleEl.style.margin = "0 0 20px 0";
    titleEl.style.fontSize = "18px";
    titleEl.style.color = "#fff";
    titleEl.textContent = "分享动作到社区";

    const nameGroup = document.createElement("div");
    nameGroup.style.marginBottom = "16px";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "分享动作补丁名称 (自动生成)";
    nameLabel.style.display = "block";
    nameLabel.style.fontSize = "12px";
    nameLabel.style.color = "rgba(255, 255, 255, 0.6)";
    nameLabel.style.marginBottom = "6px";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = defaultTitle;
    nameInput.disabled = true;
    nameInput.style.width = "100%";
    nameInput.style.padding = "10px 12px";
    nameInput.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
    nameInput.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    nameInput.style.borderRadius = "8px";
    nameInput.style.color = "rgba(255, 255, 255, 0.4)";
    nameInput.style.cursor = "not-allowed";
    nameInput.style.boxSizing = "border-box";
    nameGroup.append(nameLabel, nameInput);

    const authorGroup = document.createElement("div");
    authorGroup.style.marginBottom = "16px";
    const authorLabel = document.createElement("label");
    authorLabel.textContent = "作者昵称 (选填)";
    authorLabel.style.display = "block";
    authorLabel.style.fontSize = "12px";
    authorLabel.style.color = "rgba(255, 255, 255, 0.6)";
    authorLabel.style.marginBottom = "6px";
    const authorInput = document.createElement("input");
    authorInput.type = "text";
    authorInput.value = defaultAuthor;
    authorInput.placeholder = "匿名大佬";
    authorInput.style.width = "100%";
    authorInput.style.padding = "10px 12px";
    authorInput.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
    authorInput.style.border = "1px solid rgba(255, 255, 255, 0.15)";
    authorInput.style.borderRadius = "8px";
    authorInput.style.color = "#fff";
    authorInput.style.outline = "none";
    authorInput.style.boxSizing = "border-box";
    authorGroup.append(authorLabel, authorInput);

    const descGroup = document.createElement("div");
    descGroup.style.marginBottom = "24px";
    const descLabel = document.createElement("label");
    descLabel.textContent = "动作描述 (选填)";
    descLabel.style.display = "block";
    descLabel.style.fontSize = "12px";
    descLabel.style.color = "rgba(255, 255, 255, 0.6)";
    descLabel.style.marginBottom = "6px";
    const descInput = document.createElement("textarea");
    descInput.rows = 3;
    descInput.placeholder = "简单介绍一下这个动作，让大家更喜欢它吧...";
    descInput.style.width = "100%";
    descInput.style.padding = "10px 12px";
    descInput.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
    descInput.style.border = "1px solid rgba(255, 255, 255, 0.15)";
    descInput.style.borderRadius = "8px";
    descInput.style.color = "#fff";
    descInput.style.outline = "none";
    descInput.style.resize = "none";
    descInput.style.boxSizing = "border-box";
    descGroup.append(descLabel, descInput);

    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "12px";
    btnGroup.style.justifyContent = "flex-end";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "取消";
    cancelBtn.style.padding = "8px 16px";
    cancelBtn.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
    cancelBtn.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    cancelBtn.style.borderRadius = "6px";
    cancelBtn.style.color = "rgba(255, 255, 255, 0.8)";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.fontSize = "14px";
    cancelBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve(null);
    });

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.textContent = "点击分享";
    submitBtn.style.padding = "8px 20px";
    submitBtn.style.backgroundColor = "#a855f7";
    submitBtn.style.border = "none";
    submitBtn.style.borderRadius = "6px";
    submitBtn.style.color = "#fff";
    submitBtn.style.cursor = "pointer";
    submitBtn.style.fontSize = "14px";
    submitBtn.style.fontWeight = "500";
    submitBtn.addEventListener("click", () => {
      const author = authorInput.value.trim() || "神秘宠物训练师";
      const description = descInput.value.trim();
      if (authorInput.value.trim()) {
        localStorage.setItem("workshop_author", author);
      }
      document.body.removeChild(overlay);
      resolve({ author, description });
    });

    btnGroup.append(cancelBtn, submitBtn);
    modal.append(titleEl, nameGroup, authorGroup, descGroup, btnGroup);
    overlay.append(modal);
    document.body.append(overlay);
  });

  if (!shareMeta) return;

  const { author: cleanAuthor } = shareMeta;

  const canvas = document.createElement("canvas");
  canvas.width = framesCount * ATLAS_CELL_WIDTH;
  canvas.height = ATLAS_CELL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  frames.forEach((frame, idx) => {
    if (frame) ctx.drawImage(frame, idx * ATLAS_CELL_WIDTH, 0);
  });

  const base64DataUrl = canvas.toDataURL("image/webp", 0.95);
  const base64Data = base64DataUrl.split(",", 2)[1];

  const originalText = els.actionStripShare.textContent || "分享此动作到社区";
  els.actionStripShare.disabled = true;
  els.actionStripShare.textContent = "正在提交到云端...";
  setStatus(els.editorStatus, "正在打包动作数据并上传至社区代理服务器...");

  try {
    const payload = {
      petId: state.editorPet.id,
      actionType: action.key,
      title: defaultTitle,
      author: cleanAuthor,
      promptUsed: shareMeta.description,
      framesCount,
      frameDuration: action.frameDurations?.[0] || 120,
      imageBufferBase64: base64Data
    };

    const response = await fetch(WORKSHOP_SHARE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

    window.alert(`🎉 分享提交成功！\n动作已上传到创意工坊仓库，索引更新后即可在列表中浏览和套用。感谢你的贡献！`);
    setStatus(els.editorStatus, "动作分享成功，等待社区索引更新。");
  } catch (err) {
    console.error(err);
    window.alert(`动作分享失败：${err instanceof Error ? err.message : String(err)}\n请检查网络连接或稍后重试。`);
    setStatus(els.editorStatus, `动作分享失败：${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    els.actionStripShare.disabled = false;
    els.actionStripShare.textContent = originalText;
  }
}

async function openSpriteEditor(pet: ProjectPet): Promise<void> {
  if (pet.builtin) {
    setStatus(els.mineStatus, "内置桌宠需要先导入到本地 pets 目录后再编辑。", true);
    return;
  }
  try {
    setStatus(els.editorStatus, "正在加载图集...");
    state.editorPet = pet;
    state.editorActions = [];
    state.editorSelectedRow = 0;
    state.editorSelectedCol = 0;
    state.editorClipboard = null;
    state.editorSelectionType = "cell";
    state.editorPreviewMode = "frame";
    state.editorZoomScale = 1.0;
    if (els.editorZoomSlider) els.editorZoomSlider.value = "100";
    if (els.editorZoomInput) els.editorZoomInput.value = "100";
    applyEditorCssZoom(1.0);
    state.editorEraserEnabled = false;
    state.editorErasing = false;
    state.editorErasePointerId = null;
    state.editorEraseLastPoint = null;
    state.editorEraserUndoFrame = null;
    state.editorEraserUndoRow = 0;
    state.editorEraserUndoCol = 0;
    state.editorMoveUndoFrame = null;
    state.editorMoveUndoRow = 0;
    state.editorMoveUndoCol = 0;
    state.editorMoveUndoStripOffset = null;
    state.editorMoving = false;
    state.editorMovePointerId = null;
    state.editorMoveOrigin = null;
    state.editorMoveSourceFrame = null;
    state.editorMoveSourceOffset = null;
    state.editorMoveChanged = false;
    state.editorDirty = false;

    stopEditorActionPreview();
    updateEditorEraserUi();
    els.editorPetName.textContent = `${pet.displayName} · ${pet.spritesheetPath}`;
    setView("editor");

    const image = await loadProjectPetSpritesheetImage(pet);
    if (image.width % ATLAS_COLS !== 0) {
      throw new Error(`图集宽度必须能被 ${ATLAS_COLS} 整除`);
    }
    if (image.width !== ATLAS_COLS * ATLAS_CELL_WIDTH || image.height % ATLAS_CELL_HEIGHT !== 0) {
      throw new Error(`当前仅支持 ${ATLAS_CELL_WIDTH}x${ATLAS_CELL_HEIGHT} 单帧、${ATLAS_COLS} 列的图集`);
    }

    const rows = Math.max(1, Math.floor(image.height / ATLAS_CELL_HEIGHT));
    for (let row = 0; row < rows; row += 1) {
      const frames: HTMLCanvasElement[] = [];
      for (let col = 0; col < ATLAS_COLS; col += 1) {
        const canvas = createEmptyFrameCanvas();
        canvas.getContext("2d")?.drawImage(image, col * ATLAS_CELL_WIDTH, row * ATLAS_CELL_HEIGHT, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT, 0, 0, ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT);
        frames.push(canvas);
      }

      const defaultPresetKey = row >= DEFAULT_ACTION_NAMES.length && row < DEFAULT_ACTION_NAMES.length + Object.keys(MODE_ACTION_PRESETS).length
        ? Object.keys(MODE_ACTION_PRESETS)[row - DEFAULT_ACTION_NAMES.length] as ModeActionKey
        : undefined;
      const animKey = getPetAnimationKeyByRow(pet, row) || defaultPresetKey;

      state.editorActions.push({
        name: animKey && animKey in MODE_ACTION_PRESETS ? MODE_ACTION_PRESETS[animKey as ModeActionKey].label : DEFAULT_ACTION_NAMES[row] || `动作 ${row + 1}`,
        key: animKey as ModeActionKey,
        frameDurations: animKey && animKey in MODE_ACTION_PRESETS ? getPetAnimationFrameDurationsByRow(pet, row) || [...MODE_ACTION_PRESETS[animKey as ModeActionKey].frameDurations] : getPetAnimationFrameDurationsByRow(pet, row),
        frames,
      });
    }

    ensureDefaultModeActions();
    setStatus(els.editorStatus, `已切分 ${rows} 个动作，共 ${rows * ATLAS_COLS} 帧。`);
    renderSpriteEditorGrid();
    updateActionPromptPreview();
  } catch (err) {
    console.error(err);
    setStatus(els.editorStatus, `加载失败：${err instanceof Error ? err.message : String(err)}`, true);
  }
}

function renderSpriteEditorGrid(): void {
  normalizeEditorSelection();
  const content = document.querySelector(".content");
  const contentTop = content?.scrollTop ?? 0;
  const gridTop = els.editorGrid.scrollTop;
  const gridLeft = els.editorGrid.scrollLeft;

  els.editorGrid.replaceChildren();
  const fragment = document.createDocumentFragment();

  state.editorActions.forEach((action, rowIndex) => {
    const row = document.createElement("div");
    row.className = "sprite-grid-row";

    const labelBtn = document.createElement("button");
    labelBtn.className = "sprite-grid-label";
    labelBtn.type = "button";
    labelBtn.textContent = action.name;
    labelBtn.classList.toggle("active", rowIndex === state.editorSelectedRow && state.editorPreviewMode === "action");
    labelBtn.addEventListener("pointerdown", (event) => event.preventDefault());
    labelBtn.addEventListener("click", () => {
      state.editorSelectedRow = rowIndex;
      state.editorSelectedCol = 0;
      state.editorSelectionType = "action";
      state.editorPreviewMode = "action";
      updateActionPromptPreview();
      renderSpriteEditorGrid();
      setStatus(els.editorStatus, `正在预览「${action.name}」。`);
      playSelectedEditorAction();
    });
    row.append(labelBtn);

    action.frames.forEach((frame, colIndex) => {
      const button = document.createElement("button");
      button.className = "sprite-frame-cell";
      button.type = "button";
      button.classList.toggle("active", rowIndex === state.editorSelectedRow && colIndex === state.editorSelectedCol);
      button.setAttribute("aria-label", `${action.name} 第 ${colIndex + 1} 帧`);

      if (frameHasContent(frame)) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = frame!.toDataURL("image/png");
        button.append(image);
      } else {
        const empty = document.createElement("span");
        empty.textContent = "空";
        button.append(empty);
      }

      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        state.editorSelectedRow = rowIndex;
        state.editorSelectedCol = colIndex;
        state.editorSelectionType = "cell";
        state.editorPreviewMode = "frame";
        updateActionPromptPreview();
        renderSpriteEditorGrid();
        drawSelectedEditorFrame();
      });
      row.append(button);
    });

    fragment.append(row);
  });

  els.editorGrid.append(fragment);
  if (content) content.scrollTop = contentTop;
  els.editorGrid.scrollTop = gridTop;
  els.editorGrid.scrollLeft = gridLeft;
  requestAnimationFrame(() => {
    if (content) content.scrollTop = contentTop;
    els.editorGrid.scrollTop = gridTop;
    els.editorGrid.scrollLeft = gridLeft;
  });

  if (state.editorPreviewMode === "action") {
    const action = state.editorActions[state.editorSelectedRow];
    els.editorFrameTitle.textContent = action ? `动作预览：${action.name}` : "动作预览";
  } else {
    drawSelectedEditorFrame();
  }
}

