# 工作空间初始化记录

日期：2026-09-07

工作空间：`/Users/tanxiaoyi/AI_Project/smart-bed-studio`

源目录：`/Users/tanxiaoyi/Documents/Codex/2026-09-07/chua/outputs/smart-bed-studio`

以 V.12 四角贴合修复版为基线，复制源码与锁定依赖，未调整模型行为。31 个未修改源文件逐字节比对一致；README 和 .gitignore 为工作空间用途更新。

## 已完成

- 新增 AGENTS.md、.nvmrc、编辑器工作空间文件和开发入口说明。
- 归档 44 个文件：7 张用户参考图片、1 个原始 STEP、36 个已有导出及预览；无缺失参考。SHA-256 见 references/manifest.json。
- 使用 Node.js 24.16.0 执行 npm ci，安装 24 个包。
- npm test：40 项通过，0 失败，耗时约 33.37 秒，原始日志见 initialization-tests.txt。
- npm run build：成功生成 dist/index.html，约 2.27 MB。
- 开发服务器启动成功；HTTP /、/src/main.js、/src/model.js 均返回 200。临时预览端口 5188，日常启动使用 npm run dev 终端所示地址。
- 本地 Git 使用 main 分支；不设置远程仓库。

## 验证边界

本次为工作空间迁移和初始化，未改变模型代码，执行回归、构建和 HTTP 启动检查，未重复浏览器视觉验收。原版桌面视觉证据与范围见 VALIDATION.md。手机性能、App 封装和原生桥接尚未实施或验收。

历史导出快照不会随 src 自动刷新；后续应重新构建并在 exports 新建对应版本目录。
