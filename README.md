# 智能床 3D 模型 · Flutter 集成

本项目提供可嵌入现有 Flutter App 的智能床模型。App 设置产品型号后，模型加载对应外观、气囊结构和能力；App 将已解析的设备状态通过 Dart 接口传入，驱动气囊、加热、按摩、电动床与镜头动画。

**团队接入入口：`flutter/smart_mattress_viewer`。** 包内已包含离线模型资源，接入方无需启动网页服务器、安装 Node.js 或自行编写 JavaScript 桥接。

设备绑定、MQTT 收发、设备命令、算法和业务页面继续由现有 App 负责。模型接口只改变可视化，不向床垫发送硬件命令。示例按钮模拟设备状态，不能直接作为生产控制逻辑。

仓库：[Txxyyy/smart-bed-studio](https://github.com/Txxyyy/smart-bed-studio)（私有）。团队成员需要先获得仓库读取权限。

```sh
git clone https://github.com/Txxyyy/smart-bed-studio.git
cd smart-bed-studio
```

## 1. 团队应该拿哪些文件

| 内容 | 位置 | 使用方式 |
| --- | --- | --- |
| Flutter 组件及离线模型 | `flutter/smart_mattress_viewer/` | 整目录复制到 App 的 `packages/` |
| 可运行示例 | `flutter/smart_mattress_viewer/example/` | 先在目标设备验证，再接入业务页 |
| 完整接入说明 | [FLUTTER_INTEGRATION.md](docs/FLUTTER_INTEGRATION.md) | 生命周期、状态同步、错误处理与发布 |
| 底层模型接口 | [MODEL_SDK_API.md](docs/MODEL_SDK_API.md) | 区域 ID、参数、事件和扩展接口 |
| 实际验证范围 | [VALIDATION.md](flutter/smart_mattress_viewer/VALIDATION.md) | 区分测试、模拟器与实机验收 |

建议团队固定经过验收的 Git commit 或组件交付版本，不直接随开发分支更新生产资源。仓库中的 `exports/` 是历史交付，最新代码以 `src/` 和 Flutter 组件目录为准。

## 2. 接入现有 Flutter App

### 环境要求

- 当前包声明 Flutter >=3.13、Dart >=3.1，依赖 `webview_flutter >=4.4.4 <5.0.0`；本次验证使用 Flutter 3.13.9 / Dart 3.1.5，不代表全部版本组合均已验证。
- 支持 Android / iOS。模型必须能够创建 **WebGL 2**；构建基线为 Chromium 111+ / Safari 16.4+。
- Android 示例 minSdk 24，开启硬件加速。请核对现有 App 的 Manifest 和目标设备实际 WebView 内核；Android 版本高不等于内核一定满足要求。
- iOS 示例最低版本 16.4；现有 App 的 Runner 与 Podfile 部署目标需一致，执行 CocoaPods 安装。
- 小米电视需要按具体型号和系统验证；该组件不替换电视 WebView 内核。Flutter Web/桌面端不属于当前封装范围。

### 添加依赖

复制整个组件目录后，App 目录形如：

```text
existing_app/
  lib/
  packages/
    smart_mattress_viewer/
      lib/
      assets/
      pubspec.yaml
  pubspec.yaml
```

在 App 的 `pubspec.yaml` 添加：

```yaml
dependencies:
  smart_mattress_viewer:
    path: packages/smart_mattress_viewer
```

执行 `flutter pub get`。模型 assets 已由组件声明，App 不需要重复声明。不要只复制 Dart 文件，不要手动修改 `assets/mattress.html`。

### 在业务页面放入模型

下面的 Widget 可以作为现有设备详情页中的模型区域。`snapshot` 必须由 App 提供当前设备的完整状态；MQTT 增量订阅的接法见下一节。

```dart
import 'package:flutter/material.dart';
import 'package:smart_mattress_viewer/smart_mattress_viewer.dart';

class BedModelPanel extends StatefulWidget {
  const BedModelPanel({
    super.key,
    required this.modelId,
    required this.snapshot,
    required this.visible,
  });
  final String modelId;
  final MattressState snapshot;
  final bool visible;

  @override
  State<BedModelPanel> createState() => _BedModelPanelState();
}

class _BedModelPanelState extends State<BedModelPanel> {
  final controller = MattressController();

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 360,
    child: MattressView(
      controller: controller,
      visible: widget.visible,
      onReady: () async {
        final session = await controller.setModel(widget.modelId);
        await session.applySnapshot(widget.snapshot);
      },
      onResyncRequired: (session) async {
        await session.applySnapshot(widget.snapshot);
      },
      onError: (error) {
        debugPrint('Bed model: ${error.code}: ${error.message}');
      },
    ),
  );

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }
}
```

这个最小示例用于初始化和恢复同步，不会自动把每次 `snapshot` 属性变化推送给模型；实时上报应调用 `applyPatch`。父组件在切换设备或型号时给 `BedModelPanel` 设置新的 `ValueKey(deviceId + modelId)`，或使用下面的会话切换方式。Controller 在页面 State 中只创建一次，不要在 `build()` 内重新创建；模型容器必须有有限宽高。

## 3. 把现有 MQTT 状态接到模型

数据路径：设备 → App 现有 MQTT/业务状态层 → 转换为 `MattressState` → 固定型号会话 → 模型动画。

1. 等待 `onReady`，再调用 `controller.setModel(modelId)`。
2. 用 `applySnapshot` 提交完整状态，再接收 `applyPatch` 增量。
3. 保留 App 自己的最新完整状态缓存；页面恢复、断线恢复和模型重载时重新同步。
4. 切设备时取消旧订阅，再建立新会话；即使两台设备型号相同也要重新 `setModel`。

以下是业务层连接示意，`initialSnapshot` 和 `parsedDeviceUpdates` 均由现有 App 提供，不是组件内置数据源：

```dart
final boundSession = await controller.setModel(deviceModel);
await boundSession.applySnapshot(initialSnapshot);
final subscription = parsedDeviceUpdates.listen((MattressState patch) async {
  try {
    await boundSession.applyPatch(patch);
  } on MattressException catch (error) {
    if (error.code != 'STALE_MODEL') {
      // 接入现有错误处理；断序等情况需重新获取完整快照。
    }
  }
});
// 切换设备或销毁页面时：await subscription.cancel();
```

回调必须捕获固定的 `boundSession`，避免旧设备消息写进新设备。App 需要保证首次快照与订阅之间不丢消息，并维持增量顺序；如果启用 sequence，断序后重新同步，不直接删掉消息后沿用原序号。桥接会拒绝旧型号/旧页面会话，但不会替 App 判断设备编号。

**数据含义：**完整快照缺省区域变为未知；增量缺省字段保持原值；显式 `null` 表示未知，`0` 是真实值。气囊展示量不默认等于 kPa，加热 0–3 是展示档位，不是摄氏温度，需由 App 做业务映射。

## 4. 型号与接口使用

左右统一按**人仰躺在床上时的左右侧**，不要按屏幕左右或站在床尾观察的左右传值。

| 型号 ID | 支撑结构 | 调节区域 | 特有能力 |
| --- | --- | --- | --- |
| `T11+` / `t11-plus` | 单侧 7 囊，整床 14 囊 | 每侧 `shoulder` / `lumbar` / `hip`，对应 2/2/3 囊 | 三路调节，腰腿加热 |
| `T12` / `t12` | 单侧 63 圆囊，整床 126 囊 | 每侧 `circuit1`…`circuit7` | 潮汐腰部映射、左右独立按摩 |
| `generic` | 通用八囊 | 按 modelInfo 返回的区域 | 通用外观，无按摩 |

从 `session.modelInfo` 读取 regions、heating、supportsMassage 和 supportsTidal，不硬编码所有型号的数量。T12 腰部选择 3/4/5 路，上方候选并入背部、下方并入臀部；左右独立。未知型号应由 App 明确选择通用配置，组件不会静默替代。

下面假设已经获得一个 T12 的 `session`；各行是独立调用示例：

```dart
await session.setWaistCircuit(Side.left, 4);
await session.setAirState(regionId: 'left.circuit4', value: 65,
    status: AirStatus.inflating);
await session.setAirState(regionId: 'left.circuit4', value: 30,
    status: AirStatus.deflating);
await session.setAirState(regionId: 'left.circuit4', value: 30,
    status: AirStatus.idle);
await session.setHeating(regionId: 'left.lumbar', level: 2,
    status: HeatingStatus.heating);
await session.setMassage(side: Side.right, status: MassageStatus.running,
    intensity: 0.7, cycleSeconds: 9);
await session.setPose(back: 20, leg: 10); // 设备实际角度
await session.movePose(back: const PoseTarget(35, degreesPerSecond: 3));
await session.focusSide(Side.left);
await session.resetCamera(); // 只恢复镜头，不重置设备状态
```

`setPose` 用于实际角度上报，`movePose` 用目标角度与每秒角度驱动视觉过渡；两者都不发送设备命令。双侧气囊、加热、按摩和床体姿态可以叠加。`await` 成功表示请求已应用，不代表动画结束或硬件动作完成；动画完成需订阅 controller.events。

## 5. 生命周期与异常处理

- 非当前 Tab/PageView 页面时传 `visible: false`。App 前后台由组件处理，业务遮挡关系由 App 明确告知。
- 恢复可见时，`onResyncRequired` 先提交最新完整快照，再恢复绘制；不要回放后台积压的历史动画。
- 设备断线调用 `session.setDataAvailable(false)`；重新在线时提交带 `online: true` 的完整快照。设备离线与页面隐藏不是同一状态。
- 页面重载后 `onReady` 会再次执行，重建会话及订阅；销毁时取消订阅并 dispose Controller。
- `STALE_MODEL` / `STALE_INSTANCE`：丢弃旧回调；`RESYNC_REQUIRED` / `SNAPSHOT_REQUIRED`：补完整快照。
- `REQUEST_TIMEOUT`：执行结果未知，不自动重复发送会重启动画的请求；查询状态或重新同步。
- `UNSUPPORTED_RUNTIME`：检查 WebGL 2 与内核；不支持按摩/潮汐时按型号能力隐藏相应按钮。

默认保留原画质与 RAF 刷新节奏，静止、后台和隐藏时停绘。App 不需要逐帧传动画值；请传状态、目标及速度。真实性能与温升取决于目标设备，详见 [性能说明](docs/PERFORMANCE.md)。

## 6. 先运行示例，再做项目联调

```sh
cd flutter/smart_mattress_viewer
flutter pub get
flutter analyze
flutter test
cd example
flutter pub get
flutter run -d <设备ID>
```

示例包含型号选择、充放气、加热、双侧按摩、潮汐选择、电动床角度/速度、镜头和暂停绘制按钮。现有 App 无需复制示例 Android/iOS 工程配置；应将组件与示例调用适配到团队现有构建体系。

交付前请在目标真机检查：首次离线加载、型号/设备切换、双侧效果叠加、前后台及 Tab 切换、断线恢复、页面反复创建销毁，以及持续运行的帧率和温升。门店电视还需要验证目标分辨率、遥控操作和实际 WebView 内核。

本版已有 108 项 JS 测试、14 项 Flutter 测试、静态分析与构建记录；Android debug APK 构建成功，iOS 18.6 模拟器已验证型号切换与叠加效果。尚未完成 Android/iOS 真机、小米电视及真实 MQTT 联调；详情见[验证记录](flutter/smart_mattress_viewer/VALIDATION.md)。

## 7. 模型维护与资源更新

仅集成组件的同学无需执行以下 Node.js 命令；调整模型、材质或新增型号时才需要：

```sh
# Node.js 版本见 .nvmrc：24.16.0
npm ci
npm test
npm run build
npm run build:flutter
```

`build:flutter` 从源码生成离线 HTML，并同步到组件 `assets/`，同时生成协议版本、型号 revision 和 SHA-256 清单。更新模型后一起交付 Dart 包和 assets，保持版本兼容；不要只复制 dist 文件。现有离线包不提供在线代码热更新。

| 目录 | 用途 |
| --- | --- |
| `src/` | Three.js 模型、状态接口、型号配置与动画 |
| `src/webview-bridge.js` | Flutter 消息桥接与调用隔离 |
| `flutter/smart_mattress_viewer/` | 团队使用的 Dart 包、资源、示例和测试 |
| `docs/` | 接入、接口、性能和历史说明 |
| `references/` | 产品原始参考资料，保持原样 |
| `exports/` | 历史交付，不反向同步源码 |
| `work/` / `dist/` | 临时验证/构建输出，不作为源码编辑 |

网页开发使用 `npm run dev`：`/` 为展示控制页，`/?embed=1` 为纯模型，`/?studio=1` 为原设计工作台。历史材质、机构、导出及 V.12–V.19 说明保留在 [MODEL_HISTORY.md](docs/MODEL_HISTORY.md)。当前型号、区域与 App 左右定义以本 README 和接口文档为准。
