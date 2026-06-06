# LingoPet 灵动宠物

[English](README_en.md)

> 一个轻量、可扩展的 Tauri 桌面宠物应用。它把透明桌宠、多宠物管理、AI 对话、提醒待办、专注计时、功德木鱼、音乐律动、宠物市场和动作创作工具整合在同一个桌面陪伴体验里。

LingoPet 基于 Tauri v2 + Rust 后端 + Vite/TypeScript 前端构建。桌宠窗口保持透明、无边框、置顶和小尺寸；管理面板负责宠物下载、召唤、编辑和设置。前端使用原生 DOM + CSS，没有引入 React/Vue，也没有用 Canvas/WebGL 渲染桌宠主体。

## 当前能力

### 桌面宠物

- 透明、无边框、可拖拽的桌宠窗口，支持置顶、缩放、音量调节和开机自启动。
- 内置 Doro 桌宠和项目宠物目录，启动时会使用内置兜底资源，避免默认宠物加载失败后留下透明遮挡窗口。
- 自动游走、奔跑、等待、睡觉、打招呼、玩耍等基础动画；拖拽时会根据移动方向播放左右奔跑动作。
- 重力模式会让宠物落到桌面、屏幕边界或其他窗口顶部；关闭后可把宠物固定摆放在任意位置。
- 鼠标点击会触发气泡、粒子和随机台词；长时间无人互动时会进入发呆/休息状态。

### 多宠物与管理面板

管理面板包含「我的桌宠」「宠物召回」「宠物市场」「创意工坊」「设置」几个主要区域：

- 在「我的桌宠」中查看、搜索、收藏、分组、召唤、编辑或删除本地宠物。
- 支持单宠模式和派对模式。派对模式下可以同时召唤多个桌宠，也可以一键召唤当前分组。
- 「宠物召回」会列出正在运行的宠物实例，方便单独召回或统一管理。
- 本地导入 `.zip` 宠物包，或从宠物市场下载社区宠物到项目 `pets/` 目录。
- 系统托盘支持打开管理面板、显示/隐藏主宠物和退出应用。

### 创意工坊与动作编辑

- 「宠物市场」从 `codexpet.xyz` 拉取社区宠物，支持搜索、热门/最新/下载量排序和下载后召唤。
- 「创意工坊」提供社区扩展动作，可按功德模式、专注模式、音乐律动筛选，并一键套用到本地宠物。
- 内置雪碧图编辑器：可逐帧替换、复制、粘贴、擦除、清空、缩放宠物主体，并保存为新的 WebP 雪碧图。
- 支持导入横版动作图，把一组帧写入功德、专注或音乐律动动作行。
- 编辑完成后可以把动作分享到创意工坊，等待社区索引更新后供其他用户套用。

### AI 对话与提醒

- 支持 OpenAI 兼容接口：填写 Endpoint、API Key 和模型名即可使用。
- API Key 在桌面应用中优先保存到系统凭据，不再长期明文保存在 localStorage。
- 对话模式分为「基础闲聊」和「全面觉醒」；全面觉醒可选择阳光、温柔、高冷、傲娇、毒舌、腹黑或自定义人格。
- 右键可打开待办和定时提醒面板。待办保存到本地，提醒支持秒/分钟/小时和单次/循环提醒。

### 专注、功德与音乐律动

- 专注模式提供 25/45/60 分钟预设和自定义分钟数，支持开始、暂停、重置、进度环和结束提醒。
- 功德模式有独立大面板：可设置功德文案、正负数值、敲击频率、累计/今日/连续天数和历史记录。
- 音乐律动会根据系统音频播放状态触发宠物律动；多宠物可选择随机或同步律动。
- 部分宠物包可为专注、功德和律动提供专属动作；没有专属动作时会回退到可用基础动作。

### 系统集成

- 文件拖到宠物身上会调用系统回收站接口，避免直接永久删除。
- Windows 上会读取系统音频峰值，用于音乐律动状态判断；非 Windows 平台会安全返回未播放。
- 支持 Tauri updater，在设置页显示当前版本、检查更新并下载重启安装。
- 设置页可打开本地 `pets/` 目录，便于手动管理宠物包和编辑素材。

## 快速开始

### 安装

前往 [Releases](https://github.com/dev-zyl/LingoPet/releases) 下载最新安装包。Windows 通常使用 `.exe` 或 `.msi`，macOS 使用 `.dmg` 或 `.app` 构建产物。

### 基本操作

| 操作 | 效果 |
| --- | --- |
| 左键点击宠物 | 触发气泡、粒子和互动台词 |
| 按住拖拽宠物 | 移动宠物，释放后按当前物理/重力状态落位 |
| 右键点击宠物 | 打开宠物功能菜单 |
| 右键 > 桌宠管理 | 打开管理面板 |
| 右键 > 定时提醒 / 待办任务 | 管理提醒和本地待办 |
| 右键 > 专注模式 | 打开专注计时面板 |
| 右键 > 功德模式 | 打开功德木鱼面板 |
| 右键 > 音乐律动 | 开启或关闭音乐律动 |
| 拖文件到宠物身上 | 将文件送入系统回收站 |

### 配置 AI 对话

打开「桌宠管理 > 设置 > 对话模式 > 模式 > 全面觉醒」，填写：

| 字段 | 说明                                   |
| --- |--------------------------------------|
| 大模型地址 | OpenAI 兼容 Chat Completions Endpoint  |
| API Key | 服务商提供的密钥，桌面应用会保存到系统凭据                |
| 模型名称 | 点击自动获取，可以选择支持的模型名称，如 `gpt-3.5-turbo` |                         |

可以点击「测试」验证连通性，也可以点击「自动获取」尝试从接口读取模型列表。免费 API 获取教程见 [docs/getAPI.md](docs/getAPI.md)。

## 宠物包格式

本地宠物包是一个 `.zip`，必须包含 `pet.json` 和对应的雪碧图文件。压缩包可以直接把文件放在根目录，也可以套一层顶级目录；导入时会自动剥离顶级目录包装。

```text
pet.json
spritesheet.webp
```

`pet.json` 示例：

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A custom desktop pet.",
  "spritesheetPath": "spritesheet.webp",
  "version": "1.0.0",
  "animations": {
    "idle": { "row": 0, "frames": 4, "frameDurations": [260, 260, 260, 260] },
    "running-left": { "row": 1, "frames": 6, "frameDurations": [120, 120, 120, 120, 120, 120] },
    "running-right": { "row": 2, "frames": 6, "frameDurations": [120, 120, 120, 120, 120, 120] },
    "focus": { "row": 10, "frames": 4, "frameDurations": [300, 300, 360, 300] },
    "merit": { "row": 11, "frames": 4, "frameDurations": [180, 180, 220, 180] },
    "music": { "row": 12, "frames": 8, "frameDurations": [120, 120, 120, 120, 120, 120, 120, 120] }
  }
}
```

默认单帧规格是 `192 x 208`。不同动作按行排列，`animations` 用来声明动作所在行、帧数和每帧时长。详细导入教程见 [docs/daorujiaocheng.md](docs/daorujiaocheng.md)。

## 开发与构建

从仓库根目录运行：

```bash
npm install
npm run dev
npm run build
npm run tauri dev
npm run tauri build
```

Rust 单独检查：

```bash
cd src-tauri
cargo check
```

常用说明：

- `npm run build` 会执行 TypeScript 检查和 Vite 生产构建。
- `npm run tauri dev` 会启动完整桌面应用，并通过 Tauri 的 `beforeDevCommand` 启动 Vite。
- 构建产物位于 `src-tauri/target/release/bundle/`。
- 推送 `v*` tag 会触发 `.github/workflows/publish.yml` 发布流程。

## 技术栈

- **桌面运行时**：Tauri v2
- **后端**：Rust、Tauri commands、系统托盘、keyring、trash、updater、autostart、dialog/opener/process 插件
- **前端**：Vite + TypeScript + 原生 DOM + CSS
- **宠物渲染**：CSS `background-position` + TypeScript 计时驱动雪碧图
- **音效**：HTML5 `Audio` + Vite 静态资源
- **数据存储**：localStorage、系统凭据、项目 `pets/` 目录、应用数据目录

## 开源说明

- 安全反馈和安全边界见 [SECURITY.md](SECURITY.md)。
- 本地构建、PR 和素材贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 本地存储、外部请求、文件拖入回收站和 Windows 音频感知说明见 [PRIVACY.md](PRIVACY.md)。
- 代码采用 MIT 协议；图片、音频、宠物和社区 GIF 等素材可能有独立授权，发布前请核对 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。

GitHub Actions 发布流程需要配置 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 仓库密钥，用于生成 Tauri updater 签名产物。未配置这些密钥的 fork 仍可正常本地开发和构建，但推送 `v*` tag 触发发布 workflow 时会在签名校验步骤失败。

## 许可

MIT
