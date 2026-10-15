# Claude Code 入口

本项目由 Codex 与 Claude Code 两端协作维护。**项目规则只有一份：AGENTS.md**，下面导入后全部适用；本文件只补充 Claude Code 特有的事项，不重复、不覆盖 AGENTS.md。修改项目规则时改 AGENTS.md，两端同时生效。

@AGENTS.md

协作约定（分支、交接、生成文件冲突处理）见 @docs/AGENT_COLLABORATION.md 。

## Claude Code 补充

- 云端会话由 `.claude/hooks/session-start.sh` 自动对齐 `.nvmrc` 的 Node 版本并安装锁定依赖；本机会话不执行该 hook，使用自己的 nvm。
- 云端容器默认没有 Flutter SDK 和真机/模拟器。涉及 `flutter/` 的修改可手动安装 Flutter 3.13.9（`storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.13.9-stable.tar.xz` 解压到 `~/.cache/flutter`）后运行 `flutter analyze` / `flutter test`，或推送后以 CI 的 Flutter 任务为准；两者都没有时在交付说明中写明“未验证”。云端访问不到 `pub.flutter-io.cn`，`flutter pub get` 改写的 `pubspec.lock` url 不要提交。示例 Android/iOS 构建只能在本机做。
- 云端也没有可视化检查条件（无法人工看近景材质、深浅配色）；可用 Playwright + 预装 Chromium 截图到 `work/` 作为辅助，但不等同于人工验收，结论中要写清楚。
- `.claude/settings.json` 已禁止直接编辑 `dist/`、`exports/baseline-v12/`、`references/` 与 Flutter 生成资源；这些规则来自 AGENTS.md，需要更新 Flutter 资源时运行 `npm run build:flutter`。
- 迭代中先跑相关的 `node --test src/<模块>.test.js`，提交前运行 `npm run check`。
- 提交信息、文档和代码注释沿用中文。
