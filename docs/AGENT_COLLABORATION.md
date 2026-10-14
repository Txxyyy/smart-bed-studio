# Codex / Claude Code 协作约定

两端共享同一仓库 `Txxyyy/smart-bed-studio`（私有，主分支 `main`）。规则文件分工：

| 文件 | 读取方 | 内容 |
| --- | --- | --- |
| `AGENTS.md` | Codex、Claude Code（经 CLAUDE.md 导入） | 唯一的项目规则来源 |
| `CLAUDE.md` | Claude Code | 导入 AGENTS.md，仅补充 Claude 端环境差异 |
| `.claude/` | Claude Code | 云端启动 hook、权限与受保护路径 |
| 本文件 | 两端 | 分支、交接与冲突处理 |

## 环境差异

| 项目 | Codex（本机 macOS） | Claude Code（云端容器） |
| --- | --- | --- |
| Node | nvm 按 `.nvmrc` 切换 | 启动 hook 自动安装 `.nvmrc` 版本 |
| 依赖 | `npm ci` | 启动 hook 执行 `npm install`（锁文件不变） |
| `npm test` / `npm run build` / `npm run build:flutter` | 可运行 | 可运行 |
| `flutter analyze` / `flutter test` / 示例构建 | 可运行 | 默认不可用，需注明未验证 |
| 人工视觉检查、真机、模拟器 | 可做 | 不可做，仅能自动截图辅助 |

## 分支与同步

1. 开始工作前先 `git fetch origin` 并基于最新 `main`（或指定分支）开始，避免在过期代码上修改。
2. Claude Code 在 `claude/*` 分支开发并推送，经 PR 合入 `main`；Codex 按用户授权直接在 `main` 或自己的功能分支工作。两端不要同时改同一分支。
3. 合入后另一端开始新任务前必须重新拉取 `main`。
4. 不改写他人已推送的历史（不 rebase / force-push 共享分支）。

## 生成文件

`flutter/smart_mattress_viewer/assets/mattress.html` 与 `manifest.json` 由 `npm run build:flutter` 生成并入库。

- 改了 `src/` 中影响嵌入模型的代码，同一提交内重新生成并提交这两个文件。
- 发生合并冲突时不要手工合并：先解决 `src/` 冲突，再重新运行 `npm run build:flutter`，提交生成结果。
- `dist/`、`work/` 不入库。

## 交接说明

每次交付（提交说明或 PR 描述）写清：

- 改了什么、为什么；涉及的型号与接口。
- 实际运行过的验证（命令及结果），以及 **没有** 验证的项目（例如 Flutter 测试、视觉检查、真机）。
- 留给另一端的待办，例如“需在本机补跑 flutter test”。

只记录已确认的取舍和真实验证；桌面/云端测试不能写成手机或实机验收（见 AGENTS.md）。
