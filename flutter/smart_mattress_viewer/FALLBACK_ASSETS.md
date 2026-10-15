# 降级资源生成与维护

## 来源与目录

- `src/fallback-assets/<modelId>/base.png`：从现有 3D 正式预设外观导出的平躺底图。
- 同目录 `regions.json`：同一镜头投影的床面、左右侧、气路、热区及按摩区域，坐标归一化到图片宽高。
- `src/model-profiles.js`：型号业务定义的源文件，Dart 目录由脚本生成，不手写第二套区域 ID。
- Flutter 包 `assets/models/catalog.json` 与 `assets/fallback/`：生成交付物，不手工修改。

当前导出尺寸 1200 × 1400（assetRevision 2），fit 为 contain；图片与多边形须使用同一缩放和偏移。元数据记录 schemaVersion、型号 revision、assetRevision、appearanceKey、图片 SHA-256、镜头、姿态及仰躺左右约定。内部数值 side 为 1 左/0 右；面向 App 使用 `Side.left/right` 和字符串区域 ID。

## 更新命令

仓库使用 `.nvmrc` 指定的 Node.js，先 `npm ci`。修改型号结构、正式外观或投影镜头后重新导出：

```sh
npm run export:fallback
npm run build:flutter
```

导出脚本使用 Playwright 和 Chrome，在本机临时启动 Vite 5188 端口。开发机须有可用的 Playwright 模块和浏览器；可用 `PLAYWRIGHT_MODULE` 指向已有模块入口，`FALLBACK_BROWSER_CHANNEL` 指定已安装的浏览器 channel。这些是资源制作依赖，不是接入 App 的运行依赖。

`npm run build:flutter` 从已纳入源码的 PNG/JSON 生成交付资源，无需每次重新截图；同时导出型号目录、复制状态契约夹具、同步接入/API/性能/降级文档，生成 manifest 的逐文件字节数及 SHA-256。打包不替代视觉检查，也不自动改变图片版本。

## 变更检查

1. 对比模型 id、revision、区域集合、imageSha256 和 metadata。气路归并不能改变物理区域 ID。
2. 检查每型号近景、左右侧、床面四角和光效边界；窗口宽高比变化时保持对齐。
3. 测试 T12 腰部 3/4/5，T11+ 三路和双侧不同状态，确认没有左右反转。
4. 运行 `npm test`、`npm run build`、`npm run build:flutter`，再执行 Flutter analyze/test；如修改生成资源，提交源资源和生成包的一致版本。
5. 缺图、哈希或 revision 错配必须作为失败处理；不得用其他型号图片静默替换。

随包资源覆盖当前内置型号。新增型号可以加入目录重新构建，也可用 `controller.registerModel(profile)` 注册完整配置，但必须额外提供 `fallback: {image: 本地asset路径, regions: 区域元数据对象}`，图片预先在 App 的 pubspec.yaml 声明并打包。路径限 assets/ 或 packages/<package>/assets/，不得含 ..；元数据需与型号 id/revision、左右和区域集合一致。不能覆盖内置型号。Controller 内同 ID 同完整配置重复注册幂等（忽略对象键顺序），同 ID 不同配置返回 INVALID_PROFILE；注册不会自动生成或下载图片。纯网页旧浏览器入口和任意材质/配色编辑不在本次二维实现范围。

Controller 在其生命周期内保存已成功注册的自定义配置，在新后端/网页实例 ready 通知之前重新注册，业务无需在每次 onReady 重复注册相同配置。Controller 销毁后不保留这些运行时配置。auto 或原生路径先验证 fallback，避免出现只在 3D 可用的型号；纯 threeD 可沿用无 fallback 的 JS 配置，但不能据此切换到原生展示。

## 视觉资源第二版

固定镜头从床尾正中俯视床头，床头在上、床尾在下；画面右侧对应仰躺人体左侧。底图、左右透视层和区域坐标共用同一镜头，禁止单独裁切或拉伸。

每型号包含 `base.png`、`reveal-left.png`、`reveal-right.png` 和 `regions.json`。透视层来自真实模型；深色内部承托和 #10191d 背景仅用于二维导出，不修改实时 3D 材质。`layerSha256` 校验左右图层，目录的 `fallback.layers` 指向包内图片。

气路元数据增加 `cells`（归一化 x/y/rx/ry 与 shape），按实际内部气囊高度投影。T12 每侧 9×7 圆囊，气路分组继续使用现有定义；光效不能用气路矩形代替气囊轮廓。新版自定义资源须同时提供左右图层和完整 cells；旧版 schemaVersion 1 资源仍兼容，无 cells 时使用柔和区域光晕。

打包清单包含 14 个资源文件。检查时额外核对透视层与底图边缘、逐囊光圈与气囊对齐、人体左右、多区域同时亮起以及静态模式停动。

### 2026-09-28 视觉修订：完整外罩与柔边区域光

按最新确认，原生二维和网页二维在软硬调节期间不显示透视图层，始终使用完整底图。气囊弧光改为沿区域投影的柔边矩形青色光，低透明度叠加并缓慢呼吸，不描硬边。已有 reveal 图片及 cells 元数据保留以兼容资源契约，但当前二维视图不加载 reveal 图片、不绘制逐囊轮廓。实时原始 3D 行为保持不变。本条取代上文关于二维透视及逐囊弧光的视觉规定。
