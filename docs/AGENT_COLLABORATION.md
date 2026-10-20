# Codex / Claude Code 协作约定

Codex 与 Claude Code 共享同一仓库 `Txxyyy/smart-bed-studio`（私有，主分支 `main`）。两端的差别在于运行**环境**（本机 / 云端容器），不在于工具：本机的 Claude Code 与 Codex 能力相同，云端容器受下表限制。规则文件分工：

| 文件 | 读取方 | 内容 |
| --- | --- | --- |
| `AGENTS.md` | Codex、Claude Code（经 CLAUDE.md 导入） | 唯一的项目规则来源 |
| `CLAUDE.md` | Claude Code | 导入 AGENTS.md，仅补充 Claude 端环境差异 |
| `.claude/` | Claude Code | 云端启动 hook、权限与受保护路径、本机预览入口 `launch.json` |
| `.github/pull_request_template.md` | 两端 | PR 交接格式 |
| 本文件 | 两端 | 分工、分支、交接与冲突处理 |

## 环境差异

| 项目 | 本机（macOS，Codex / Claude Code） | 云端容器（Claude Code） |
| --- | --- | --- |
| Node | nvm 按 `.nvmrc` 切换 | 启动 hook 自动安装 `.nvmrc` 版本 |
| 依赖 | `npm ci` | 启动 hook 执行 `npm install`（锁文件不变） |
| `npm test` / `npm run build` / `npm run build:flutter` | 可运行 | 可运行 |
| `flutter analyze` / `flutter test` | 可运行 | 默认未安装，可手动安装 3.13.9 或以 CI 结果为准 |
| 示例 Android/iOS 构建 | 可运行 | 不可用 |
| 人工视觉检查、真机、模拟器 | 可做 | 不可做，仅能自动截图辅助 |
| 起点 | 本机任意提交 | 只能从已推送到 origin 的分支开始 |

## 任务分工

本机为主，云端为辅，GitHub（origin）负责中转、备份与 CI 复核。

| 放本机 | 可放云端 |
| --- | --- |
| 几何、运动、材质（需看近景、深浅配色、最大折弯） | 纯 JS 逻辑、SDK 接口、状态机与时序 |
| Flutter 修改与示例 Android/iOS 构建、真机/模拟器 | 补测试、重构、文档整理 |
| `npm run export:fallback` 及随后的 `build:flutter` | 长时间、可无人值守的回归任务 |
| 最终验收、打交付标签 | 与本机任务互不相干、可并行的小任务 |

`export:fallback` 产出的二维底图、透视层和光效层是交付资源，固定在同一台本机上导出：换机器或渲染后端可能带来无意义的二进制变化，且导出后需要人工检查。需要 Flutter 或视觉验证的任务直接放本机，避免云端只能写“未验证”后返工。

## 提交前检查

两端统一运行 `npm run check`（lint + 格式检查 + 测试 + 构建）；改了 `src/` 再运行 `npm run build:flutter`。代码格式由 Prettier 决定，不手工对齐；查看历史时可执行 `git config blame.ignoreRevsFile .git-blame-ignore-revs` 跳过纯格式化提交。

GitHub Actions（`.github/workflows/ci.yml`）在 `main`、`feat/**`、`fix/**`、`claude/**` 推送和 PR 上运行上述检查，以及 Flutter 3.13.9 的 `flutter analyze` / `flutter test`。已开 PR 的分支推送时 push 与 PR 各跑一次，属预期。CI 通过不等于实机验收。

`pubspec.lock` 中的 `url` 在本机为国内镜像 `pub.flutter-io.cn`；在其他网络执行 `flutter pub get` 若只改了 url，不要提交该变化。

## 分支与合入

1. 一次性准备：`git clone` 后 `nvm use && npm ci`；`git config blame.ignoreRevsFile .git-blame-ignore-revs`。
2. 开始工作前 `git fetch origin`，从最新 `origin/main` 开新分支，避免在过期代码上修改。分支命名：本机（不论 Codex 或 Claude Code）用 `feat/<主题>` / `fix/<主题>`，云端用 `claude/<主题>`。
3. 一个分支同一时间只由一端持有。换端前先提交并推送，另一端拉取后再继续；两端不同时改同一分支。
4. 所有改动经 PR 合入 `main`，两端都不直接提交 `main`。私有仓库未开分支保护，“CI 全部通过后才合并”是人工约定，合并前须确认。
5. 合入后另一端开始新任务前必须重新拉取 `main`。
6. 验收过的交付版本打标签：`git tag -a v<版本> -m "<说明>"`，`git push origin --tags`。
7. 不提交 `dist/`、`work/`、`node_modules/`；回退用 `git revert`。不改写已推送的历史：不对 `main` 做 `reset --hard`，不 rebase / force-push 共享分支。

## 生成文件

`npm run build:flutter` 生成并入库以下文件，均不手改：

- `flutter/smart_mattress_viewer/assets/mattress.html`、`manifest.json`
- `flutter/smart_mattress_viewer/MODEL_SDK_API.md`、`INTEGRATION.md`（分别由 `docs/MODEL_SDK_API.md`、`docs/FLUTTER_INTEGRATION.md` 复制，文档只改 docs/ 一份）

CI 会重新生成并检查与提交内容一致，遗漏时 CI 失败。

- 改了 `src/` 中影响嵌入模型的代码，同一提交内重新生成并提交这两个文件。
- 发生合并冲突时不要手工合并：先解决 `src/` 冲突，再重新运行 `npm run build:flutter`，提交生成结果。两端都改了 `src/` 时，以本机重新生成的结果为准。

## 交接说明

每次交付（提交说明或 PR 描述，PR 模板已列出三栏）写清：

- 改了什么、为什么；涉及的型号与接口。
- 实际运行过的验证（命令及结果），以及 **没有** 验证的项目（例如 Flutter 测试、视觉检查、真机）。
- 留给另一端的待办，例如“需在本机补跑 flutter test”。

接手方先补跑上一端标注的未验证项，再继续开发。只记录已确认的取舍和真实验证；桌面/云端测试不能写成手机或实机验收（见 AGENTS.md）。

## 历史归档

- 标签 `archive/oldlocal-20261015`（提交 `b8c20e8`，含备份提交 `16ad8bb`）：旧工作目录迁移前的本地备份。其中降级渲染部分已在 `26fcab7` 移植；“关闭 3D 调节高光”与 T12 蓝色聚合物气囊材质未移植，仅存于此标签，需要时从标签取回评估，不直接合并。
