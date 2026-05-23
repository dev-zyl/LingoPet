# VibePet

[English](README_en.md)

> 一个桌面 AI 灵魂宠物 -- 基于 Tauri v2 + Rust 内核，零框架纯 DOM 渲染，极致轻量仅 5MB。

灵感来源于 Codex Pet，将其独立并赋予更多伴侣级桌面能力。即便没有使用代码编辑器，也能拥有一只懂你的桌面宠物。

## 核心特性

### 自定义代办

接入大模型 API 后，自然语言输入自动分类为"倒计时提醒"或"永久备忘"：

```
"30 分钟后提醒我喝水"    -->  倒计时提醒，到时循环提示音 + 视觉脉冲
"学习深度学习"           -->  永久备忘，存入 localStorage
"1 小时后叫我开会"       -->  倒计时提醒
```

未配置 API 时自动降级为纯记事本模式，一键复制，随时粘贴。

### AI 人格对话

连接任意 OpenAI 兼容接口，六种内置性格预设 + 自定义性格面板：

| 预设 | 风格 |
|------|------|
| 傲娇猫 | 外冷内热，偷偷关心 |
| 阳光少女 | 活力充沛，感叹号密度溢出 |
| 毒舌朋友 | 吐槽精准，但没有恶意 |
| 温柔前辈 | 暖心耐心，轻声细语 |
| 中二少年 | 戏剧独白，中二台词 |
| 禅系柴犬 | 佛系哲学，惜字如金 |

首次点击触发完整 LLM 回复，之后回落到轻量语录，10 分钟冷却后再次触发 -- 兼顾体验与成本。

### 专注模式

5-60 分钟自由设定的番茄钟计时器。专注期间宠物保持安静、显示倒计时，结束后铃声提醒。

### 功德木鱼

右键菜单开启功德模式后，宠物会进入自动敲木鱼状态，按固定节奏累积“功德 +1”。支持自定义功德文案、保存今日次数，并使用独立木鱼敲击音效，避免和普通气泡提示音混在一起。

### 节日祝福

内置日历，节日当天首次开机自动送上祝福。

### 互动彩蛋

点击宠物身体随机出现黄脸标签，头顶上方冒出各种语录。七种内置动态动作（待机、行走、奔跑、坐下、睡觉、打招呼、玩耍），每一种都有独特的个性表达。

### 自定义形象

支持导入社区制作的宠物包（`.zip`），一键切换。ikun、奶龙、甚至可以把亲人朋友创作出来陪伴。

前往 [codexpet.xyz](https://codexpet.xyz/zh) 或 [codex-pet.org](https://codex-pet.org/zh) 下载更多宠物。

### 极致轻量

安装包仅 5MB，后台常驻完全不影响系统性能。

### 系统深度集成

- Windows 系统音频感知 -- 检测到系统正在播放声音时，宠物自动轻微弹动并飘出音符粒子
- 文件拖入回收站 -- 拖到宠物身上即可删除
- GitHub 提交监控 -- 绑定账号后，有新 commit 时宠物冒出鼓励语
- 开机自启动（Tauri autostart 插件）
- 窗口置顶（状态跨会话持久化）

### 右键丰富菜单栏

右键点击宠物弹出功能菜单，所有功能一目了然。

## 快速开始

**安装**

前往 [Releases](https://github.com/ZhangYiLong416/DesktopPet/releases) 页面下载最新安装包（`.msi`、`setup.exe` 或 macOS 构建产物），安装后启动即可。

**配置 API（可选）**

右键宠物 > 对话模式 > 接入 API，填入以下信息：

| 字段 | 说明 |
|------|------|
| Endpoint | API 服务地址（支持任何 OpenAI 兼容接口） |
| Key | 你的 API 密钥 |
| Model | 模型名称 |

点击"保存"自动测试连通性，绿色表示成功。免费 API 获取教程见 [getAPI.md](docs/getAPI.md)。

## 基本操作

| 操作 | 效果 |
|------|------|
| 左键点击 | 宠物打招呼，冒出粒子特效 |
| 按住拖拽 | 宠物跟着鼠标跑，松手落地弹跳 |
| 右键菜单 | 打开功能菜单 |
| 右键 > 功德模式 | 打开木鱼面板，开始/停止自动敲木鱼 |
| 拖文件到宠物身上 | 文件送入回收站 |
| 长时间不操作 | 宠物发呆、思考、最后睡着 |
| 移动鼠标唤醒 | 宠物惊喜跳起 |

## 开发与构建

```bash
npm install            # 安装依赖
npm run build          # TypeScript 检查 + Vite 前端构建
npm run tauri dev      # 开发模式（热重载）
npm run tauri build    # 生产构建（生成安装包）
```

构建产物位于 `src-tauri/target/release/bundle/`（NSIS 和 MSI 两种格式）。

Rust 层检查：

```bash
cd src-tauri
cargo check
```

推送 `v*` tag 会触发 GitHub Actions 发布流程，workflow 位于 `.github/workflows/publish.yml`，当前会构建 Windows `nsis/msi` 和 macOS `dmg/app` 产物。

## 技术规范

- **运行时**: Tauri v2 (Rust 后端 + WebView2 前端)
- **前端**: Vite + TypeScript, 零框架纯 DOM 渲染
- **动画**: TypeScript 计时驱动精灵图引擎 + CSS 反馈动画，无 Canvas/WebGL
- **音效**: HTML5 `Audio`，Vite 管理本地音频资源
- **安装包**: Windows NSIS (.exe) / MSI，macOS DMG / App

## 宠物包格式

支持导入自定义宠物（`.zip` 文件）：

```
pet.json              -- 宠物清单（id, displayName, description, spritesheetPath, version）
spritesheet.webp      -- 精灵图（每格 192x208，按行排列不同动作）
```

右键 > 设置 > 导入宠物(.zip) 即可更换。详细教程见 [导入教程](docs/daorujiaocheng.md)。

## 许可证

MIT
