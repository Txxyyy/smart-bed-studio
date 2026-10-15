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
| `flutter analyze` / `flutter test` | 可运行 | 默认未安装，可手动安装 3.13.9 或以 CI 结果为准 |
| 示例 Android/iOS 构建 | 可运行 | 不可用 |
| 人工视觉检查、真机、模拟器 | 可做 | 不可做，仅能自动截图辅助 |

## 提交前检查

两端统一运行 `npm run check`（lint + 格式检查 + 测试 + 构建）；改了 `src/` 再运行 `npm run build:flutter`。代码格式由 Prettier 决定，不手工对齐；查看历史时可执行 `git config blame.ignoreRevsFile .git-blame-ignore-revs` 跳过纯格式化提交。

GitHub Actions（`.github/workflows/ci.yml`）在 `main`、`claude/**` 推送和 PR 上运行上述检查，以及 Flutter 3.13.9 的 `flutter analyze` / `flutter test`。CI 通过不等于实机验收。

`pubspec.lock` 中的 `url` 在本机为国内镜像 `pub.flutter-io.cn`；在其他网络执行 `flutter pub get` 若只改了 url，不要提交该变化。

## 本机开发与 GitHub 备份

日常开发在本机进行，GitHub（origin）作为备份与 CI 复核，不是开发环境：

1. 一次性准备：`git clone` 后 `nvm use && npm ci`；`git config blame.ignoreRevsFile .git-blame-ignore-revs`。
2. 每个任务从最新 `main` 开新分支（`git switch -c feat/<主题>`），小步提交，提交信息写清改了什么、验证了什么。
3. 提交前 `npm run check`；改了 `src/` 再 `npm run build:flutter` 并一起提交。
4. 合入 `main`：本机 `git merge --no-ff`（或经 PR），然后 `git push origin main`。验收过的交付版本打标签：`git tag -a v<版本> -m "<说明>"`，`git push origin --tags`。
5. 不提交 `dist/`、`work/`、`node_modules/`；回退用 `git revert`，不对已推送的 `main` 做 `reset --hard` 或强推。

## 分支与同步

1. 开始工作前先 `git fetch origin` 并基于最新 `main`（或指定分支）开始，避免在过期代码上修改。
2. Claude Code 在 `claude/*` 分支开发并推送，经 PR 合入 `main`；Codex 按用户授权直接在 `main` 或自己的功能分支工作。两端不要同时改同一分支。
3. 合入后另一端开始新任务前必须重新拉取 `main`。
4. 不改写他人已推送的历史（不 rebase / force-push 共享分支）。

## 生成文件

`npm run build:flutter` 生成并入库以下文件，均不手改：

- `flutter/smart_mattress_viewer/assets/mattress.html`、`manifest.json`
- `flutter/smart_mattress_viewer/MODEL_SDK_API.md`、`INTEGRATION.md`（分别由 `docs/MODEL_SDK_API.md`、`docs/FLUTTER_INTEGRATION.md` 复制，文档只改 docs/ 一份）

CI 会重新生成并检查与提交内容一致，遗漏时 CI 失败。

- 改了 `src/` 中影响嵌入模型的代码，同一提交内重新生成并提交这两个文件。
- 发生合并冲突时不要手工合并：先解决 `src/` 冲突，再重新运行 `npm run build:flutter`，提交生成结果。
- `dist/`、`work/` 不入库。

## 交接说明

每次交付（提交说明或 PR 描述）写清：

- 改了什么、为什么；涉及的型号与接口。
- 实际运行过的验证（命令及结果），以及 **没有** 验证的项目（例如 Flutter 测试、视觉检查、真机）。
- 留给另一端的待办，例如“需在本机补跑 flutter test”。

只记录已确认的取舍和真实验证；桌面/云端测试不能写成手机或实机验收（见 AGENTS.md）。
