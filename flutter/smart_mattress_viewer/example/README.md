# 床垫模型 Flutter 接入示例

```sh
flutter pub get
flutter run -d <Android或iOS设备ID>
```

模型资源来自上级 smart_mattress_viewer 包，无需网页开发服务器。页面演示 T11+ / T12 / generic、动态区域列表、左右按摩、加热、潮汐腰部、角度与速度、镜头和隐藏恢复。

所有按钮均模拟设备状态或展示动作；真实 App 替换为解析后的设备数据即可。不要把示例中生成的初始值用作真实设备默认读数。

Android 示例使用 Gradle 8.6 / AGP 8.3.2 / Kotlin 1.9.22 / compileSdk 34；iOS deployment target 16.4。构建命令：flutter build apk --debug；flutter build ios --simulator --debug --no-codesign。

示例可帮助验证接入，不是经过门店或目标手机性能验收的正式 App。详见上级 INTEGRATION.md。

展示策略可使用 auto、threeD、twoD、staticImage；自动模式不要求预先知道电视型号。纯二维与静态路径不创建 WebView。模式切换会使旧 Session 失效，实际接入须按上级 INTEGRATION.md 重建状态订阅；二维不提供交互镜头或真实几何折弯，角度由示意表达。示例的本地状态模拟不能证明真实 MQTT 的序号连续性或设备完成状态。
