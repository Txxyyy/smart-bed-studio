# Smart Mattress Viewer

Flutter Android/iOS 智能床模型组件。包内带离线模型资源，App 通过 Dart 接口选择 T11+ / T12 / generic 并提交已解析的设备状态。模型不连接 MQTT、不发送设备命令。

```yaml
dependencies:
  smart_mattress_viewer:
    path: packages/smart_mattress_viewer
```

```dart
final controller = MattressController();

MattressView(
  controller: controller,
  renderPolicy: RenderPolicy.auto,
  onReady: () async {
    final model = await controller.setModel('T12');
    await model.applySnapshot(latestDeviceState);
  },
  onResyncRequired: (model) async {
    await model.applySnapshot(latestDeviceState);
  },
);
```

`latestDeviceState` 由 App 提供，类型是 MattressState。Controller 在页面 State 中创建一次，dispose 时释放。实际项目须捕获设备对应的固定 MattressSession，并在设备切换时取消旧订阅。

完整接入、类型与接口、初始化时序、生命周期、错误码、运行条件见随包 `INTEGRATION.md`。`example/` 是可运行示例，按钮模拟状态，不控制硬件。

- `flutter pub get && flutter analyze && flutter test`
- `cd example && flutter pub get && flutter run -d <device>`
- 开发模型时从源码仓库执行 `npm run build:flutter`，不要编辑 assets/mattress.html。
- 仅 3D 要求 WebGL 2、Chromium 111+ / Safari 16.4+；原生二维/静态模式不创建 WebView。auto 按实际加载结果选择，不依赖电视型号。
- 默认保留原画质、跟随刷新节奏。电视与手机热稳定性必须单独实机验证。

`renderPolicy` 默认仍是 `threeD`，上例显式启用 auto。`twoD` / `staticImage` 直接运行原生展示；`fallbackOptions` 可设置尝试与恢复预算；`onRenderModeChanged` 返回实际模式及能力。auto 切换会再次调用 onReady，旧 Session 失效，业务须取消旧订阅并重绑后同步最新快照。最小示例不包含实时订阅连续性处理，完整步骤见 [INTEGRATION.md](INTEGRATION.md)。

[降级行为与支持矩阵](RENDER_FALLBACK.md) · [资源维护](FALLBACK_ASSETS.md)
