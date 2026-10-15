# 交付验证记录

## Flutter WebView 接入改造验证（2026-09-22）

- 交付内容：纯模型离线入口、版本化消息桥接、Flutter Widget/Controller/型号 Session、Android/iOS 示例与接入文档。App 仍负责 MQTT 解析与硬件控制。未改模型几何、材质或默认画质/刷新策略。
- Node.js 24.16.0：npm test 108/108 通过；npm run build、npm run build:flutter 通过。离线 HTML 2,268,577 字节，校验值见 assets/manifest.json。
- Flutter 3.13.9 / Dart 3.1.5：flutter analyze 无问题，flutter test 14/14 通过，覆盖握手、会话失效、超时、错误消息、状态格式和隐藏恢复时序。
- Android：Gradle 8.6 / AGP 8.3.2 / Kotlin 1.9.22，debug APK 构建成功。未安装到 Android 真机或小米电视；debug 包不是发布包。
- iOS：最低部署版本 16.4，iOS 18.6 / iPhone 16 Pro 模拟器构建并运行。观察到 T11+/T12 切换、气囊调节、加热与双侧按摩叠加；电动床目标与速度控件可调用。发现并修复示例按摩 Map 类型导致强度赋值失败的问题。
- 补充 Chrome 离线桥接页通过握手、无演示控件、T12 126 囊能力检查；首帧等待在 document.hidden=true 时超时，性能状态 visible=false。该轮完整浏览器流程未通过，不计入验收成功；隐藏页停绘符合当前设计。
- 未实施：真实设备 MQTT 联调、手机/电视持续运行的帧率、温升与耗电验收、iOS 真机签名发布、Android release 签名发布。模拟器运行与自动测试不代替这些验收。

## Flutter 原生二维降级 1.1.0（2026-09-22）

- 实现：RenderPolicy.auto / threeD / twoD / staticImage；auto 先显示原生底图和区域状态，候选 3D 完成型号、最新状态与呈现屏障后切换。threeD 仍为兼容默认值，示例显式使用 auto；原有 3D 画质和刷新策略保持。
- twoD/staticImage 不创建 WebView。T11+、T12、generic 各带 1600×1000 底图及同镜头区域坐标；动态支撑、加热、按摩按人体左右独立。静态模式停止持续光效，电动角度使用数值与侧视示意。
- JS：Node.js 24.16.0，npm test 119/119 通过，npm run build / npm run build:flutter 成功；生成包 resourceVersion 1.1.0，8 个资源文件的大小及 SHA-256 全部核对一致。日志 work/fallback-qa/node-tests.log、build.log、package.log。
- Dart：Flutter 3.13.9 / Dart 3.1.5，flutter analyze 无问题；flutter test 56/56 通过。测试包括共享状态契约、原生动态/静态、旧会话失效、未知/null/0、断序、T12 映射、自定义型号幂等及跨后端恢复、可见性、故障注入、首帧关联、迟到回调和同步事件重入。日志 work/fallback-qa/flutter-analyze.log、flutter-tests.log。
- 真实桌面 Chrome：呈现屏障在实际 render 提交后完成；切型号拒绝旧等待；context loss 拒绝等待，restore 仅发一次重同步。证据 work/fallback-qa/bridge-browser.json。此项不是旧电视 WebView 验收。
- Flutter 离屏画面：三个型号分别检查 1280×720 动态效果和 360×640 静态布局，共六张图；检查双侧区域投影、支撑/加热/按摩叠加及 65°/35°角度示意，修正窄屏说明和示意裁剪。图片 work/fallback-qa/flutter-*-tv-effects.png、flutter-*-phone-static.png。这些是 Flutter 测试环境截图，不是目标屏幕实拍或最终产品视觉验收。
- Android debug APK、iOS simulator debug Runner.app 构建成功，日志 work/fallback-qa/android-build.log、ios-build.log。Android 构建提示既有 NDK 版本建议（25.1.8937393），未阻止 debug 构建；本次未变更 NDK 配置。两者均不是签名发布或实际电视运行证明。
- 未实施：目标电视/手机的真实 MQTT 联调、真实旧内核与平台视图遮挡下的候选呈现、1080p/4K 实屏与遥控焦点验收、深浅配色扩展、持续运行帧率/温升/耗电、系统 WebView 进程内存观测、签名 release 发布。缺图/无效元数据以明确资源错误和可用状态示意处理，不替换成其他型号外观。

## 降级视觉第二版（2026-09-28）

- 三个内置型号重导为 1200×1400 正中床尾俯视，包含完整底图、左右透视层与逐囊投影坐标。原始参考图片未修改。
- Flutter 改用青色气囊弧光、椭圆暖色加热渐变和紫色按摩波纹；透视层透明度跟随 frames 更新。兼容旧元数据的柔光表达。
- 本次完整 Node 回归 119/119 通过；最终资源定向检查 2/2 通过。网页构建及 Flutter 离线包构建通过，包内 14 个资源文件。
- Flutter analyze 无问题；原有全套 56/56 测试通过，新增逐帧透视透明度回归 1/1 通过。原生离屏截图脚本通过，并人工核看 T12 支撑和加热图片；这些不是实机截图。
- 应用内浏览器实际检查左右支撑、原始 3D 加载及往返二维切换。Chrome 连接工具失败后使用应用内浏览器完成。预览入口为 fallback-compare.html?mode=2d。
- 未进行电视或手机实机验收；本轮未重新构建 Android/iOS 应用，不据此声称终端兼容性或性能验收通过。

### 2026-09-28 完整床面柔边矩形修订

取消二维透视图层及逐囊轮廓，采用区域投影柔边矩形。Flutter analyze 无问题，全套 57/57 测试通过（含调节/扫描期间只挂载完整底图的回归）；build:flutter 通过。应用内浏览器核看左侧调节时完整外罩与柔边青色光。未进行电视实机验收。

### 2026-09-29 粗粒子调节光效

降低区域底光，增加三行错位的青蓝粗粒子、柔光晕与短拖尾。Flutter analyze 无问题，57/57 回归通过，离线资源构建通过。网页已实际核看粒子显示；电视实机未验证。

参考图蓝光修订：Flutter analyze 无问题，57/57测试通过；网页已核看局部亮边、点阵与扫描。二维维持真实区域投影，未模拟物理隆起；未做电视实机验收。

3D 区域方向光效：原有 Node 回归119/119通过，新增方向状态与平躺/65°背35°腿几何测试1/1通过。网页及Flutter离线构建通过；浏览器已显示3D蓝色区域叠加。未进行电视实机验收。

### 2026-09-29 3D 参考图能量区域重做

- 宽幅青蓝能量区域、青白圆角亮边、局部外溢蓝光与三支横排白色实心箭头。光层保持在外罩深度面上方，按当前气囊高度联动，显示升降上限20mm；不改变外罩或设备状态。
- npm test 122/122通过：包括明确方向映射、平躺/最大折弯、暂停时钟、网格缓存与左右压力联动。npm run build / npm run build:flutter通过，14个包内资源的大小及SHA-256核对一致；git diff --check通过。日志 work/fallback-qa/3d-energy-*.log。
- 应用内浏览器实际核看T12充气与放气，使用模型旁按钮切换；截图 work/fallback-qa/3d-energy-inflating.png、3d-energy-deflating.png。控制台历史记录有MutationObserver异常（未定位来源），本轮未观察到着色器编译错误，不能据此称控制台全无错误。
- 本轮未改Dart，因此未重跑Flutter analyze/test；未进行电视/手机实机验收，也未重新检查全部配色和所有镜头角度。折弯位置采用Node几何回归，不能替代实机视觉验收。

### 2026-09-29 3D 光区匹配气囊、移除粗箭头

- 光区改为逐物理排绘制，不再强制扩到34cm；宽深和中心来自该排定义，距当前气囊顶部6mm，随真实展示压力及床体折弯。在外罩之前绘制，保留深度检测与透明覆盖，解决投影错位。
- 移除三支实心箭头，方向由气囊侧面细光纹表达。选中排关闭旧轮廓脉冲和散点；同气路多排分别显示。未知方向不产生上/下流动。
- 定向回归20/20通过；最终全量Node回归124/124通过，包括三个型号逐排宽深/位置、平躺/65°背35°腿顶点、左右独立高度、方向及冻结/缓存行为。网页构建、Flutter离线构建、14项资源大小/哈希核对与git diff --check通过；日志 work/fallback-qa/3d-row-fit-*.log。
- 应用内浏览器核看T12单排充气和放气，光区跟随气囊高度且无粗箭头；截图 work/fallback-qa/3d-row-fit-deflating.png。多排和最大折弯的本轮证据为自动几何回归，不是电视实机视觉验收；未重新检查全部配色。Dart未修改，未重跑Flutter analyze/test。
