# 贡献指南

感谢你愿意帮助改进 LingoPet。

## 本地开发

在仓库根目录安装前端依赖：

```bash
npm install
```

运行前端构建：

```bash
npm run build
```

运行 Tauri 桌面开发模式：

```bash
npm run tauri dev
```

只检查 Rust 层：

```bash
cd src-tauri
cargo check
```

## 代码约定

- 前端保持框架无关，使用 TypeScript、原生 DOM API 和 CSS。
- 宠物窗口 UI 要保持轻量、紧凑，避免引入不必要的大型依赖。
- 宠物精灵图渲染默认使用 DOM + CSS 背景定位，不要为了小功能引入 Canvas/WebGL。
- 新增 Tauri 前端 API 或插件时，需要同步检查 `src-tauri/capabilities/default.json` 权限。
- 不要随意改名 `localStorage` key，除非同时提供迁移逻辑。
- PR 尽量保持聚焦，不要在修功能时顺手重构无关代码。

## 提交宠物素材

自定义宠物包应为 `.zip` 文件，至少包含：

```text
pet.json
spritesheet.webp
```

`pet.json` 至少包含：

```json
{
  "id": "example-pet",
  "displayName": "Example Pet",
  "description": "Short description",
  "spritesheetPath": "spritesheet.webp",
  "version": "1.0.0"
}
```

精灵图建议使用 192x208 单元格。默认图集为 8 列、9 行，不同行对应不同动作。

提交宠物或图片素材前，请确认：

- 你拥有素材版权，或已获得明确的再分发授权。
- 如果素材来自第三方，请附上来源、作者和许可证说明。
- 不要提交版权角色、商标 Logo、未经授权的社区作品或私人照片。
- 尽量使用透明背景，控制文件体积，保证导入后可以正常预览。

## 提交创意工坊动作

创意工坊动作补丁应说明：

- 适配的宠物 ID
- 动作类型，例如 `focus`、`music`、`merit`
- 帧数和帧时长
- 使用的提示词、参考图或生成流程
- 作者昵称和必要授权说明

## Pull Request

提交 PR 前，请按改动范围运行最小必要检查：

- 前端改动：`npm run build`
- Rust/Tauri 改动：在 `src-tauri/` 下运行 `cargo check`
- 权限、窗口、updater 或原生行为改动：尽量运行 `npm run tauri dev` 实测

如果某项检查无法运行，请在 PR 描述中说明原因。
