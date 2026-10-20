# Flutter 模型组件接入（1.1.0）

组件目录：`flutter/smart_mattress_viewer`。支持 Android / iOS 的 Flutter 组件，提供 WebView 3D 与原生二维展示；MQTT、设备绑定和硬件命令继续由 App 负责。包内附离线 HTML，不依赖开发服务器、CDN 或 Node.js。示例中的按钮仅模拟状态，不控制真实设备。

## 1. 加入 App

将整个 `smart_mattress_viewer` 文件夹放入 App 的 `packages/`，在 App 的 pubspec.yaml 添加：

```yaml
dependencies:
  smart_mattress_viewer:
    path: packages/smart_mattress_viewer
```

运行 `flutter pub get`。模型 HTML 和清单已在包的 assets 中声明，不需要业务项目重复声明。不要只复制 Dart 文件，也不要直接修改生成的 `assets/mattress.html`。

## 2. 创建组件

```dart
import 'package:smart_mattress_viewer/smart_mattress_viewer.dart';

// 在页面 State 中创建一次；不要在 build() 内重新创建。
final controller = MattressController();
MattressSession? session;

// 放在具有有限宽高的容器，例如 Expanded / SizedBox 中。
MattressView(
  controller: controller,
  renderPolicy: RenderPolicy.auto,
  visible: true, // 非当前 Tab / PageView 页面时必须传 false
  onReady: () async {
    final next = await controller.setModel('T12');
    // App 自行取得已解析的设备状态；未知字段用 null，不用 0 冒充。
    await next.applySnapshot(latestDeviceState);
    session = next;
  },
  onResyncRequired: (current) async {
    await current.applySnapshot(latestDeviceState);
  },
  onError: (error) {
    // 展示或记录 error.code / error.message。
  },
);
```

这里 `latestDeviceState` 是 App 提供的 `MattressState`，不是 MQTT 原文。例如：

```dart
final latestDeviceState = MattressState(
  air: {
    'left.circuit4': const AirState(value: 65, status: AirStatus.inflating),
    'right.circuit6': const AirState(value: 40, status: AirStatus.idle),
  },
  heating: {
    'left.lumbar': const HeatingState(level: 2, status: HeatingStatus.heating),
  },
  massage: {
    Side.left: const MassageState(status: MassageStatus.running,
        intensity: 0.7, cycleSeconds: 9),
  },
  pose: {'back': 20, 'leg': 10},
  online: true,
);
```

完整快照未提供的区域会变为未知，不会自动补成 0。增量更新用 `applyPatch`，未提供字段保持原值。需要只将一个字段设为未知时，用 `MattressState.fromJson({'air': {'left.circuit4': {'value': null}}})`。加热 level 为 0–3 展示档位，气囊 value 为型号 range 内的展示值，均不默认等同实测温度或 kPa。

页面 State.dispose 中调用 `controller.dispose()`；组件卸载也会尽力通知 JS dispose，并使旧会话失效。一个 controller 只能同时绑定一个 MattressView。更换 controller 时更换 Widget Key。

## 3. 业务调用

```dart
await session!.setWaistCircuit(Side.left, 4);
await session!.setAirState(regionId: 'left.circuit4', value: 72,
    status: AirStatus.inflating);
await session!.setBodyState('left.lumbar',
    const AirState(value: 72, status: AirStatus.adjusting));
await session!.setHeating(regionId: 'right.leg', level: 2,
    status: HeatingStatus.heating);
await session!.setMassage(side: Side.right, status: MassageStatus.running,
    intensity: 0.7, cycleSeconds: 9);
await session!.setPose(back: 30, leg: 10); // 设备实际角度
await session!.movePose(back: const PoseTarget(35, degreesPerSecond: 3));
await session!.focusSide(Side.left); // 3D 转镜头；二维高亮该侧
await session!.resetCamera(); // 不重置设备状态
```

`moveAir` / `movePose` 只驱动视觉运动，不发送设备命令；真实状态上报会接管对应部位。`PoseTarget` 默认 3°/秒。左右、加热、按摩与姿态独立，不等待一侧动画结束才执行另一侧。

常用方法有类型化封装；其余镜头、扫描、动画策略、结构视图等可使用 `session.invoke('camera.setZoom', [1.2])`，方法必须在现有 SDK 白名单内。禁止通过 session.invoke 切换型号、注册配置或销毁实例，使用 controller 对应方法。完整方法见 MODEL_SDK_API.md。

`await` 表示 SDK 已应用请求，**不表示动画或设备动作完成**。`movePose`、`moveAir` 和镜头操作返回 actionId 等结果；监听对应完成或取消事件，不要把它当成设备控制回执。

```dart
final eventSubscription = controller.events.listen((event) {
  if (event.name == 'model.presented') { /* 已提交该型号首帧 */ }
  if (event.name == 'animation.completed') { /* 视觉动作完成 */ }
  if (event.name == 'camera.completed') { /* 镜头过渡完成 */ }
  // 异步使用事件时可比对 event.modelToken 与当前 session 的 token。
});
// 页面销毁时 eventSubscription.cancel();
```

## 4. 型号和设备切换

- T11+：14 囊，每侧 shoulder / lumbar / hip 三个区域；T12：126 个圆囊，每侧 circuit1…7；generic：通用八囊配置。
- 从 `session.modelInfo.regions`、`heating`、`supportsMassage` 和 `supportsTidal` 获取能力。运行时潮汐映射变化后用 `await session.getModelInfo()` 取得最新信息；初始 modelInfo 是加载时快照。
- T12 使用 `setWaistCircuit` 指定左右各自 3/4/5 中的腰部气路；其上候选并背，其下候选并臀。物理气路不随归并改变。
- 同型号的另一台设备也必须再次 `controller.setModel`。方法调用时立即使旧会话失效；网页侧也校验 instanceId 和 modelToken，包括 pose.moveTo、镜头等原 SDK 不带 token 参数的方法。
- 未知型号返回错误。App 如果选择通用外观，应显式 `setModel('generic')`，不静默伪装硬件能力。

以下仅演示捕获固定 session，未处理快照期间更新或串行增量；async listen 不会等待上次 Future，不能直接作为生产订阅。完整顺序和缓冲示例见第 9 节。旧设备回调不能读取已改为新设备的全局 session：

```dart
final boundSession = await controller.setModel(deviceModel);
await boundSession.applySnapshot(initialSnapshot);
final subscription = parsedDeviceUpdates.listen((patch) async {
  try {
    await boundSession.applyPatch(patch);
  } on MattressException catch (error) {
    if (error.code != 'STALE_MODEL') { /* 上报错误 / 请求重新同步 */ }
  }
});
// 切设备时取消旧 subscription，然后建立新 session 和订阅。
```

切换失败会保持错误状态，需重新 setModel；不自动把旧请求附到新 token。App 仍负责选择正确设备、取消旧网络订阅。用户 App 和门店 App 的调用方式一致。

## 5. 初始化、通信和异常

独立 `embed.html` 不自动加载型号，不创建演示控件。先建立桥接，再 configure、setModel、applySnapshot。`onReady` 是当前展示后端可用（原生二维不经过桥接），setModel Future 是型号加载完成，`model.presented` 是模型首帧提交。不能仅靠 WebView.onPageFinished 判断模型就绪。

桥接协议 v1：

```json
{"protocolVersion":1,"instanceId":"page-...","requestId":"dart-1","modelToken":"model-1","method":"setAirState","args":["left.circuit4",{"value":65,"status":"inflating"}]}
```

JS 经 `MattressHost.postMessage` 回传 JSON：response 带 requestId/ok/result 或 error；event 带 name/data/modelToken。Dart 使用 JSON 编码，不把业务数据插入未转义的 JS 字符串。JS 会等待 Promise 后返回结果；不依赖平台 evaluateJavascript 自动等待 Promise。

- 普通调用默认超时 10 秒，初始化/型号加载 30 秒，可在 controller 构造时调整。
- REQUEST_TIMEOUT 表示回执未知，不自动重试可能重启动画的操作。必要时查询当前状态或提交最新快照。
- 同一网页最近 128 个 requestId 提供有界去重；同 ID 不同内容返回 REQUEST_CONFLICT。这不提供跨页面的持久化 exactly-once 保证。
- 首次 applyPatch 返回 SNAPSHOT_REQUIRED；启用连续 sequence 后断序返回 RESYNC_REQUIRED。不要一边删除增量消息一边沿用原序号。
- STALE_MODEL / STALE_INSTANCE：丢弃旧设备或旧页面回调。
- MODEL_LOADING / MODEL_SUPERSEDED：等待最新型号请求完成。
- UNSUPPORTED_MASSAGE / UNSUPPORTED_TIDAL：按型号能力隐藏不支持的 UI。
- PROTOCOL_MISMATCH / UNSUPPORTED_RUNTIME：auto 策略转入二维；threeD 策略保留错误提示。
- JS 初始化失败有桥接错误及屏幕错误提示；Dart 初始化超时也显示重试入口，不无限等待空白页。

桥接只运行 SDK 白名单方法，组件限制离开本地模型来源的导航。自定义型号如果引用外部贴图，将不再保证完全离线，优先将资产随版本打包。

## 6. 生命周期、性能及恢复

组件结合 App 前后台、路由状态和 `visible` 属性停绘。App 的 TabBarView、PageView 或其他遮挡关系不能全部由 WebView 推断，必须传入真实 visible。恢复可见时，先等待 onResyncRequired 完成，再恢复绘制；此处应提交 App 保存或重新获得的完整状态，而非回放积压历史动画。

设备断线/数据过期调用 `session.setDataAvailable(false)`；它与 UI 隐藏不同。重新可用时提交带 online:true 的当前快照。WebGL 上下文恢复会请求状态重同步。网页被回收或手动 reload 后重新握手，onReady 再次执行，App 重建型号会话并提交状态；不自动重放旧动作。

默认 auto→native：不主动限帧，不降低阴影、贴图或原有动画效果。Flutter 不逐帧传位置，只传实际状态、目标、速度；业务 rebuild 不重新加载 WebView。性能统计按需调用 `controller.getPerformanceStats()`，CPU 帧时不等于 GPU 帧时或手机功耗。

## 7. 运行环境与验证边界

- Flutter/Dart 的包约束：Flutter >=3.13、Dart >=3.1；webview_flutter >=4.4.4 <5。本次本地实际解析版本见 pubspec.lock，不能据此保证整个版本范围均已实测。
- 仅 3D 路径的模型构建基线：Chromium 111+ / Safari 16.4+，必须能够创建 WebGL 2；插件的最低 OS 支持范围不等于模型范围。示例 Android minSdk 24、iOS deployment target 16.4。
- 3D 路径需开启硬件加速并满足实际 WebView 要求；二维不依赖 WebView。自动选择无需提前提供电视型号，但不能替代后续实机体验验证。Flutter 包不会替换电视内核。
- 原生示例仅配置 Android / iOS。Flutter Web、Windows、电视厂商非 Android 系统不在当前原生包装验收范围。
- 手机温升、电视目标分辨率持续运行、GPU/驱动兼容性必须用实机验证；iOS 模拟器不代表 iPhone 真机或小米电视。

## 8. 构建与开发

仓库根目录：

```sh
npm ci
npm test
npm run build
npm run build:flutter
```

最后一步从 src/ 构建 `dist/embed/embed.html`，同步二维图片、区域元数据、型号目录、契约夹具和随包文档，并生成各资源 SHA-256、协议版本、型号 revision 清单。静态资源更新方式见 [FALLBACK_ASSETS.md](FALLBACK_ASSETS.md)。原网页入口和设计工作台仍保留；旧 `?embed=1` 的 JS API 保留，Flutter 使用专用入口。不要手动编辑 dist/ 或生成的 HTML。

```sh
cd flutter/smart_mattress_viewer
flutter pub get
flutter analyze
flutter test
cd example
flutter pub get
flutter run -d <Android或iOS设备ID>
```

本机 CocoaPods 需 UTF-8 环境时，可仅对该次命令设置 `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`，不用修改用户全局配置。示例 Android 构建使用 Gradle 8.6 / AGP 8.3.2 / Kotlin 1.9.22 / compileSdk 34，建议 JDK 17 或 21；使用新版 Flutter 的团队可把 example/lib/main.dart 接入其标准新建工程，组件包接口不依赖示例的 Gradle 模板。

## 9. 新型号发布

继续采用产品图片/结构资料→模型调优→确认→固化配置和纹理的流程。新增型号修改 src/model-profiles.js 等模型源码，执行 build:flutter，整体更新组件包资源；App 使用新的型号 ID。新增型号不要求业务代码硬编码气囊数量。新能力扩展协议和 Dart 类型；不兼容变更升级协议版本。本版没有加入在线热更新或自动下载代码机制。

## 9. 自动降级与订阅迁移

显式传 `renderPolicy: RenderPolicy.auto` 启用自动选择；不传时仍是 `threeD`。`twoD` / `staticImage` 从启动即不创建 WebView。`fallbackOptions` 的两个预算默认为 6 秒 / 2 秒，分别用于 3D 尝试和上下文恢复。完整流程与能力表见 [RENDER_FALLBACK.md](RENDER_FALLBACK.md)。

**`onReady` 可能因展示后端切换再次调用。** 不应仅在页面首次创建时初始化型号，也不能让 MQTT 回调读取可变的“当前 session”后把旧设备消息发送给新设备。业务接入采用以下顺序：

1. 为本次绑定递增 generation，先取消旧展示订阅；每个 await 后核对 generation 与页面仍挂载。
2. 以当前设备固定的 modelId 调用 setModel，捕获返回的固定 Session；旧的异步回调不得替换新 Session。
3. 从业务状态缓存取当前完整快照并 applySnapshot；快照期间到达的更新由业务缓存合并或按序缓冲，不能丢弃后沿用旧序号。
4. 建立固定设备、固定 Session 的增量订阅；快照与订阅之间必须有无缝衔接（业务状态源原子订阅/重放，或序号缓冲）。
5. 页面销毁、切设备或再次 onReady 时失效 generation 并取消订阅；捕获旧会话错误，不将失败消息改投新 Session。

上方最小示例只展示快照初始化。实际 MQTT 接入必须实现上述重绑定和连续性；组件不接管业务网络订阅。`onResyncRequired` 使用传入的固定 Session 提交最新完整快照；动画完成事件不代表设备完成。

`onRenderModeChanged` 和 `controller.rendererInfo` 提供实际模式及展示能力，可据此隐藏镜头和结构展示入口；不要隐藏型号支持的加热或按摩控制。`controller.retryThreeD()` 仅在 auto 策略下显式重试。原生后端不支持的展示扩展返回 `UNSUPPORTED_RENDERER_FEATURE`；切换时旧请求可返回 `RENDERER_CHANGED`，应丢弃旧结果。

下面是**单次固定会话**的串行缓冲消费示例。`openDeviceFeed` 是 App 自行实现的状态源，不是组件 API：它必须原子返回完整 `snapshot` / `sequence` 与此序号之后、连续可重放的 `updates`；更新条目含 `patch`、`sequence`。如果现有 MQTT 层不能提供这个契约，应先在业务层建立缓存和序号缓冲。示例中的取消函数由页面保存，重绑定/销毁时调用。

```dart
// import 'dart:async';
final generation = ++bindingGeneration;
await cancelPreviousFeed?.call();
if (generation != bindingGeneration || !mounted) return;
final feed = await openDeviceFeed(deviceId);
final queue = StreamIterator(feed.updates); // 在 await 期间保留待消费更新
Future<void> cancelThisFeed() async {
  await queue.cancel();
  await feed.close();
}
if (generation != bindingGeneration || !mounted) {
  await cancelThisFeed();
  return;
}
cancelPreviousFeed = cancelThisFeed;
try {
  if (generation != bindingGeneration || !mounted) {
    await cancelThisFeed();
    return;
  }
  final bound = await controller.setModel(deviceModel);
  if (generation != bindingGeneration || !mounted) {
    await cancelThisFeed();
    return;
  }
  await bound.applySnapshot(feed.snapshot, sequence: feed.sequence);
  // 消费循环作为独立 Future 运行；不要令 onReady 等待永不结束的订阅。
  unawaited(() async {
    try {
      while (await queue.moveNext()) {
        if (generation != bindingGeneration || !mounted) break;
        final update = queue.current;
        await bound.applyPatch(update.patch, sequence: update.sequence);
      }
    } catch (error) {
      if (generation == bindingGeneration && mounted) {
        reportAndRequestFreshBinding(error); // 业务逻辑：重新快照，不跳过断序
      }
    } finally {
      await cancelThisFeed();
    }
  }());
} catch (error) {
  await cancelThisFeed();
  rethrow;
}
```

页面还需在销毁时递增 bindingGeneration 并调用取消函数，业务 feed.close 应可重复调用；为缓冲设置容量上限，溢出时请求新快照。不要把上段片段直接替代完整生命周期管理；组件本身没有接管业务 feed 的公开绑定器。

自定义型号通过 controller.registerModel 注册，成功后在 Controller 生命周期内缓存，并在新后端 ready 通知前重放。同 ID 同配置幂等，不同配置返回 INVALID_PROFILE，不能覆盖内置型号。auto/原生要求配置具有有效 fallback 和本地资产；纯 threeD 无 fallback 的注册只保证 3D 可用。详见 [FALLBACK_ASSETS.md](FALLBACK_ASSETS.md)。
