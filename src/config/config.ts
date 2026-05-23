import "./style.css";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

const API_BASE = "https://codexpet.xyz";
const PAGE_SIZE = 30;
const LS_PET_SIZE_SCALE = "pet_size_scale";
const LS_API_ENDPOINT = "pet_api_endpoint";
const LS_API_KEY = "pet_api_key";
const LS_API_MODEL = "pet_api_model";
const LS_CHAT_MODE = "pet_chat_mode";
const LS_PERSONA_MODE = "pet_persona_mode";
const LS_CUSTOM_PERSONA = "pet_custom_persona_text";
const LS_ALLOW_MULTIPLE_PETS = "pet_allow_multiple_instances";
const LS_PRIMARY_PET_ID = "pet_primary_project_id";
const LS_SUMMONED_PET_IDS = "pet_summoned_pet_ids";
const LS_PET_VOLUME = "pet-volume";
const BUILTIN_IKUN_PET: ProjectPet = {
  id: "ikun-pet",
  displayName: "鸡哥ikun",
  description: "内置默认桌宠",
  spritesheetPath: "spritesheet.webp",
  kind: "animal",
  version: "v1.0.0",
  dir: "内置资源",
  spritesheetFile: "",
  builtin: true,
};

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
}

interface SummonedPetWindow {
  label: string;
  petId: string;
  primary?: boolean;
}

type ViewName = "mine" | "recall" | "market" | "settings";
type SortName = "hot" | "latest" | "downloads";

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
  importLocalPet: document.getElementById("import-local-pet") as HTMLButtonElement,
  activePetsStatus: document.getElementById("active-pets-status") as HTMLParagraphElement,
  activePetsList: document.getElementById("active-pets-list") as HTMLDivElement,
  refreshActivePets: document.getElementById("refresh-active-pets") as HTMLButtonElement,
  recallSelectedPets: document.getElementById("recall-selected-pets") as HTMLButtonElement,
  petsPath: document.getElementById("pets-path") as HTMLParagraphElement,
  settingsPetsPath: document.getElementById("settings-pets-path") as HTMLParagraphElement,
  openPetsDir: document.getElementById("open-pets-dir") as HTMLButtonElement,
  settingsOpenPetsDir: document.getElementById("settings-open-pets-dir") as HTMLButtonElement,
  autostartToggle: document.getElementById("autostart-toggle") as HTMLInputElement,
  alwaysTopToggle: document.getElementById("always-top-toggle") as HTMLInputElement,
  allowMultipleToggle: document.getElementById("allow-multiple-toggle") as HTMLInputElement,
  sizeSlider: document.getElementById("manager-size-slider") as HTMLInputElement,
  sizeInput: document.getElementById("manager-size-input") as HTMLInputElement,
  sizeText: document.getElementById("manager-size-text") as HTMLSpanElement,
  volumeSlider: document.getElementById("manager-volume-slider") as HTMLInputElement,
  volumeInput: document.getElementById("manager-volume-input") as HTMLInputElement,
  volumeText: document.getElementById("manager-volume-text") as HTMLSpanElement,
  chatMode: document.getElementById("chat-mode-select") as HTMLSelectElement,
  persona: document.getElementById("persona-select") as HTMLSelectElement,
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
};

const state = {
  view: "mine" as ViewName,
  sort: "hot" as SortName,
  marketPage: 1,
  marketTotal: 0,
  minePage: 1,
  marketPets: [] as MarketPet[],
  projectPets: [] as ProjectPet[],
  activePetWindows: [] as SummonedPetWindow[],
  selectedRecallLabels: new Set<string>(),
  downloading: new Set<string>(),
};

let marketRequestSeq = 0;
let marketSearchTimer: number | null = null;

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

function setStatus(el: HTMLElement, message = "", isError = false): void {
  el.textContent = message;
  el.classList.toggle("error", isError);
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

function setView(view: ViewName): void {
  state.view = view;
  for (const item of els.navItems) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  for (const [name, element] of Object.entries(els.views)) {
    element.classList.toggle("active", name === view);
  }

  const copy = {
    mine: ["我的桌宠", "管理本地宠物并召唤多个桌面实例。"],
    recall: ["宠物召回", "查看当前存在的宠物，并支持单独或批量召回。"],
    market: ["宠物市场", "下载新角色并保存到项目 pets 文件夹。"],
    settings: ["设置", "配置开机自启动、置顶、尺寸和对话模式。"],
  }[view];
  els.title.textContent = copy[0];
  els.subtitle.textContent = copy[1];

  if (view === "mine") void loadProjectPets();
  if (view === "recall") void loadActivePets();
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
  return pet.builtin ? new URL("../builtin-pets/ikun-pet/spritesheet.webp", import.meta.url).href : convertFileSrc(pet.spritesheetFile);
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
  if (!query) return state.projectPets;
  return state.projectPets.filter((pet) => pet.displayName.toLowerCase().includes(query) || pet.id.toLowerCase().includes(query));
}

function renderListRow(options: {
  title: string;
  subtitle: string;
  spriteUrl: string;
  actions: HTMLElement[];
}): HTMLElement {
  const row = document.createElement("article");
  row.className = "pet-row";

  const preview = document.createElement("div");
  preview.className = "pet-preview";
  preview.append(createSprite(options.spriteUrl, options.title));

  const info = document.createElement("div");
  info.className = "pet-info";
  const title = document.createElement("h3");
  title.textContent = options.title;
  const subtitle = document.createElement("p");
  subtitle.className = "meta";
  subtitle.textContent = options.subtitle;
  info.append(title, subtitle);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(...options.actions);

  row.append(preview, info, actions);
  return row;
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

  if (pets.length === 0) {
    setStatus(els.mineStatus, "没有找到本地桌宠。");
    els.minePagination.replaceChildren();
    return;
  }
  setStatus(els.mineStatus, `本地已有 ${state.projectPets.length} 个桌宠。`);

  const fragment = document.createDocumentFragment();
  for (const pet of pageItems(pets, state.minePage)) {
    const summon = document.createElement("button");
    summon.className = "summon-button";
    summon.type = "button";
    summon.textContent = "召唤";
    summon.addEventListener("click", () => void summonPet(pet.id, summon));

    const open = document.createElement("button");
    open.className = "secondary-button";
    open.type = "button";
    open.textContent = "打开目录";
    open.disabled = !!pet.builtin;
    open.addEventListener("click", () => void invoke("open_pet_folder", { petId: pet.id }));

    const remove = document.createElement("button");
    remove.className = "danger-button";
    remove.type = "button";
    remove.textContent = "删除";
    remove.disabled = !!pet.builtin;
    remove.addEventListener("click", () => void deletePet(pet));

    fragment.append(renderListRow({
      title: pet.displayName,
      subtitle: `${pet.id} · ${pet.version || "v1.0.0"}${pet.builtin ? " · 内置" : ""}`,
      spriteUrl: projectPetSpriteUrl(pet),
      actions: [summon, open, remove],
    }));
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
  return localStorage.getItem(LS_PRIMARY_PET_ID) || BUILTIN_IKUN_PET.id;
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
    rememberPrimaryPet(BUILTIN_IKUN_PET.id);
  }
}

function renderActivePets(): void {
  preserveScroll(() => {
  els.activePetsList.replaceChildren();
  renderOnlinePetCard();

  if (state.activePetWindows.length === 0) {
    setStatus(els.activePetsStatus, "当前没有可召回的桌宠。");
    els.recallSelectedPets.disabled = true;
    return;
  }

  setStatus(els.activePetsStatus, `当前存在 ${state.activePetWindows.length} 个宠物。`);
  els.recallSelectedPets.disabled = state.selectedRecallLabels.size === 0;
  const fragment = document.createDocumentFragment();
  for (const item of state.activePetWindows) {
    const pet = state.projectPets.find((p) => p.id === item.petId);
    const canBatchRecall = state.activePetWindows.length > 1;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedRecallLabels.has(item.label);
    checkbox.disabled = !canBatchRecall;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedRecallLabels.add(item.label);
      else state.selectedRecallLabels.delete(item.label);
      renderActivePets();
    });

    const recall = document.createElement("button");
    recall.className = "danger-button";
    recall.type = "button";
    recall.textContent = "召回";
    recall.addEventListener("click", () => void recallPet(item.label));

    const spriteUrl = pet ? projectPetSpriteUrl(pet) : "";

    const row = document.createElement("article");
    row.className = "pet-row active-row";
    row.append(checkbox);

    const preview = document.createElement("div");
    preview.className = "pet-preview";
    preview.append(createSprite(spriteUrl, pet?.displayName || petNameById(item.petId)));

    const info = document.createElement("div");
    info.className = "pet-info";
    const title = document.createElement("h3");
    title.textContent = petNameById(item.petId);
    const subtitle = document.createElement("p");
    subtitle.className = "meta";
    subtitle.textContent = item.primary ? "主宠物窗口" : item.label;
    info.append(title, subtitle);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(recall);

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
    state.marketTotal = Number(data.pagination?.totalItems || state.marketPets.length);
    renderMarket(state.marketTotal);
  } catch (err) {
    if (requestSeq !== marketRequestSeq) return;
    console.error(err);
    setStatus(els.marketStatus, "宠物市场加载失败，请检查网络后刷新。", true);
  }
}

async function loadProjectPets(): Promise<void> {
  try {
    const pets = await invoke<ProjectPet[]>("list_project_pets");
    state.projectPets = pets.some((pet) => pet.id === BUILTIN_IKUN_PET.id)
      ? pets
      : [BUILTIN_IKUN_PET, ...pets];
    normalizePrimaryPetId();
    renderMyPets();
    renderMarket(state.marketTotal);
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
    els.petsPath.textContent = dir;
    els.settingsPetsPath.textContent = dir;
  } catch (err) {
    els.petsPath.textContent = String(err);
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
      throw new Error("请在 VibePet 桌面应用的管理面板中召唤桌宠。");
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
    rememberPrimaryPet(petId);
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
  const ok = window.confirm(`删除本地桌宠「${pet.displayName}」？`);
  if (!ok) return;
  try {
    await invoke("delete_project_pet", { petId: pet.id });
    await loadProjectPets();
  } catch (err) {
    setStatus(els.mineStatus, `删除失败：${err}`, true);
  }
}

function getPetSizeScale(): number {
  const saved = Number(localStorage.getItem(LS_PET_SIZE_SCALE) || "0.6");
  return Number.isFinite(saved) ? Math.min(1.4, Math.max(0.35, saved)) : 0.6;
}

function updateSizeControls(percent: number): void {
  const next = Math.min(140, Math.max(35, Math.round(percent)));
  const scale = next / 100;
  localStorage.setItem(LS_PET_SIZE_SCALE, String(scale));
  els.sizeSlider.value = String(next);
  els.sizeInput.value = String(next);
  els.sizeText.textContent = `${next}% · ${Math.round(192 * scale)} x ${Math.round(208 * scale + 48)}px`;
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

async function loadSettings(): Promise<void> {
  els.autostartToggle.checked = await isEnabled().catch(() => false);
  els.alwaysTopToggle.checked = localStorage.getItem("pet-always-on-top") !== "false";
  els.allowMultipleToggle.checked = allowMultiplePets();
  updateSizeControls(Math.round(getPetSizeScale() * 100));
  updateVolumeControls(getPetVolumePercent());
  els.chatMode.value = localStorage.getItem(LS_CHAT_MODE) || "basic";
  els.persona.value = localStorage.getItem(LS_PERSONA_MODE) || "tsundere";
  els.customPersona.value = localStorage.getItem(LS_CUSTOM_PERSONA) || "";
  els.apiEndpoint.value = localStorage.getItem(LS_API_ENDPOINT) || "";
  els.apiModel.value = localStorage.getItem(LS_API_MODEL) || "gpt-3.5-turbo";
  els.apiKey.value = await getApiKey().catch(() => "");
  updateApiConfigVisibility();
  void loadPetsPath();
}

els.navItems.forEach((item) => {
  item.addEventListener("click", () => setView((item.dataset.view || "mine") as ViewName));
});
els.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.sort = (button.dataset.sort || "hot") as SortName;
    state.marketPage = 1;
    for (const item of els.sortButtons) item.classList.toggle("active", item === button);
    void fetchMarketPets(1);
  });
});
els.marketSearch.addEventListener("input", () => {
  state.marketPage = 1;
  if (marketSearchTimer !== null) window.clearTimeout(marketSearchTimer);
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
els.openPetsDir.addEventListener("click", () => void invoke("open_pet_folder", { petId: null }));
els.settingsOpenPetsDir.addEventListener("click", () => void invoke("open_pet_folder", { petId: null }));
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
els.allowMultipleToggle.addEventListener("change", async () => {
  localStorage.setItem(LS_ALLOW_MULTIPLE_PETS, String(els.allowMultipleToggle.checked));
  if (!els.allowMultipleToggle.checked) {
    await invoke("close_all_summoned_pet_windows").catch(console.error);
    setSavedSummonedPetIds([]);
    await invoke("show_primary_pet_window").catch(console.error);
  }
  await loadActivePets();
});
els.sizeSlider.addEventListener("input", () => updateSizeControls(Number(els.sizeSlider.value)));
els.sizeInput.addEventListener("input", () => updateSizeControls(Number(els.sizeInput.value)));
els.volumeSlider.addEventListener("input", () => updateVolumeControls(Number(els.volumeSlider.value)));
els.volumeInput.addEventListener("input", () => updateVolumeControls(Number(els.volumeInput.value)));
window.addEventListener("storage", (event) => {
  if (event.key === LS_PET_VOLUME) updateVolumeControls(getPetVolumePercent());
});
els.chatMode.addEventListener("change", () => {
  localStorage.setItem(LS_CHAT_MODE, els.chatMode.value);
  updateApiConfigVisibility();
});
els.persona.addEventListener("change", () => localStorage.setItem(LS_PERSONA_MODE, els.persona.value));
els.customPersona.addEventListener("input", () => localStorage.setItem(LS_CUSTOM_PERSONA, els.customPersona.value.trim()));
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

void loadPetsPath();
void loadProjectPets();
void fetchMarketPets();
void loadSettings();
void loadActivePets();
