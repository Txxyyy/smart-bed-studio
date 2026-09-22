# 交付验证记录

## Flutter WebView 接入改造验证（2026-09-22）

- 交付内容：纯模型离线入口、版本化消息桥接、Flutter Widget/Controller/型号 Session、Android/iOS 示例与接入文档。App 仍负责 MQTT 解析与硬件控制。未改模型几何、材质或默认画质/刷新策略。
- Node.js 24.16.0：npm test 108/108 通过；npm run build、npm run build:flutter 通过。离线 HTML 2,268,577 字节，校验值见 assets/manifest.json。
- Flutter 3.13.9 / Dart 3.1.5：flutter analyze 无问题，flutter test 14/14 通过，覆盖握手、会话失效、超时、错误消息、状态格式和隐藏恢复时序。
- Android：Gradle 8.6 / AGP 8.3.2 / Kotlin 1.9.22，debug APK 构建成功。未安装到 Android 真机或小米电视；debug 包不是发布包。
- iOS：最低部署版本 16.4，iOS 18.6 / iPhone 16 Pro 模拟器构建并运行。观察到 T11+/T12 切换、气囊调节、加热与双侧按摩叠加；电动床目标与速度控件可调用。发现并修复示例按摩 Map 类型导致强度赋值失败的问题。
- 补充 Chrome 离线桥接页通过握手、无演示控件、T12 126 囊能力检查；首帧等待在 document.hidden=true 时超时，性能状态 visible=false。该轮完整浏览器流程未通过，不计入验收成功；隐藏页停绘符合当前设计。
- 未实施：真实设备 MQTT 联调、手机/电视持续运行的帧率、温升与耗电验收、iOS 真机签名发布、Android release 签名发布。模拟器运行与自动测试不代替这些验收。
