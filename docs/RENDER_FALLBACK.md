# Flutter 展示模式与降级

组件使用统一的 Dart 业务接口，提供 WebView 3D 和 Flutter 原生二维后端。自动选择依据实际启动和运行结果，不依赖电视品牌或型号清单。App 保留设备绑定、状态缓存、MQTT 和硬件控制责任。

## 选择策略

| `RenderPolicy` | 行为 |
| --- | --- |
| `threeD` | 默认值，保留已有集成行为；仅使用 3D，失败报错 |
| `auto` | 先提供原生二维，再尝试 3D；成功切换，失败保持二维 |
| `twoD` | 原生静态底图与分区动态光效；不创建 WebView |
| `staticImage` | 原生静态底图、区域标记和状态；不持续运行光效 |

`staticImage` 的名字避开 Dart 保留字 `static`。App 可通过更新 Widget 属性改变策略。`RenderPolicy` 与画质参数 `PerformanceMode` 无关；3D 继续保持原画质。

```dart
MattressView(
  controller: controller,
  renderPolicy: RenderPolicy.auto,
  fallbackOptions: const FallbackOptions(
    threeDAttemptBudget: Duration(seconds: 6),
    contextRestoreBudget: Duration(seconds: 2),
  ),
  onReady: bindLatestDevice, // 每次后端就绪重建固定会话，见接入文档
  onResyncRequired: (session) => session.applySnapshot(latestDeviceState),
  onRenderModeChanged: (info) {
    // activeMode 是当前展示模式，requestedPolicy 是 App 选择的策略。
    // 可记录 phase、reasonCode、attemptId，不以此判断设备控制完成。
  },
);
```

上述 `controller`、`bindLatestDevice`、`latestDeviceState` 由业务页提供。启用 auto 前必须处理重复 `onReady`，详见 [接入说明](FLUTTER_INTEGRATION.md)。

## 切换与状态

自动模式保留可用的原生画面，候选 3D 完成桥接、型号和状态同步后，通过关联型号与 presentationRevision 的首帧提交屏障才参与切换；页面 `onPageFinished` 不能单独证明成功。首帧提交是渲染层信号，不是 GPU 或视觉验收结果。

3D 尝试默认预算 6 秒，图形上下文恢复预算 2 秒；按候选能够绘制的可见时间计时，后台/隐藏及等待 App 提交状态的阶段不消耗预算；等待 App 首份状态时 phase 为 `awaitingState`；预算不能代替 App 自己的网络数据超时。明确初始化失败、超时或无法恢复时使用二维，释放失败候选并拒绝迟到回调。本次挂载不循环自动重启，可由 App 在 auto 下调用 `controller.retryThreeD()` 显式重试。其 Future 不应当被视为最终切换成功，观察 `onRenderModeChanged` 的实际模式。

后端切换使旧 Session 失效；旧设备订阅和异步调用不得转投新会话。App 始终维护独立的最新完整状态，重建会话后同步快照，不回放积压动作。型号校验失败、非法区域和断序仍按业务错误处理，不应归类为电视性能问题。

`controller.rendererInfo` / `onRenderModeChanged` 暴露 `requestedPolicy`、`activeMode`、`phase`、`reasonCode`、`attemptId`、`capabilities`。展示能力字段包括 `interactiveCamera`、`geometryDeformation`、`layerViews`、`regionEffects`、`poseDiagram`、`dynamicEffects`；设备按摩/加热能力仍来自型号信息。

## 二维展示与接口范围

随包内置 generic、T11+、T12 各有离线预渲染底图和同一镜头投影的区域多边形。人体仰躺左侧仍是 `left`，不能按图片屏幕位置推断左右。T11+ 为每侧三路；T12 为每侧七路，并保留腰部 3/4/5 动态映射。底图保持平躺固定外观，角度以数值及侧视示意表达，不能当成精确折弯模型。

| 调用类别 | 原生二维 / 静态表现 |
| --- | --- |
| listModels、setModel、getModelInfo、状态查询 | 内置型号目录与固定会话 |
| applySnapshot / applyPatch、区域状态、在线状态 | 独立 Dart 校验；省略、null、0 和断序规则保留 |
| adjustment、air.moveTo、pose.moveTo、stop | 光效/数值/示意，保留展示动作语义；不产生真实几何形变 |
| heating、massage、body、tidal | 分区光效或静态状态；按型号能力校验 |
| animation pause/resume/cancel/setPolicy | 控制原生展示；不改变硬件状态 |
| effects scanIn/scanOut/reveal/sideReveal/highlight/heatingStyle | 扫描、区域高亮及热纹的二维替代 |
| visible、suspend/resume、resize | 原生生命周期和布局 |
| camera.focusSide / camera.focusRegion | 对应侧或区域高亮，返回 actionId、representation: highlight；发送 presentation.completed，不伪造 camera.completed |
| registerModel(profile) | 校验完整配置及 fallback 描述；需预先随 App 打包本地资产。同 ID 同配置重复注册幂等，不同配置返回 INVALID_PROFILE，不能覆盖内置型号 |
| 任意镜头旋转/缩放、结构拆解及其他未支持扩展 | 返回 `UNSUPPORTED_RENDERER_FEATURE`，不伪装成功 |

二维以青蓝色表达支撑调节、橙色表达加热、紫色表达按摩。未知方向用中性呼吸效果；没有真实数据不能自行推断充放气。左右独立，同侧连续区域切换不重复进入扫描。静态模式只更新标记；离线、隐藏和暂停停止动态绘制。

## 资源、错误与验证

静态资源损坏时报告资源错误，保留可绘制的状态示意；不能把缺失图片误报为成功展示了产品外观。资源生成及校验见 [FALLBACK_ASSETS.md](FALLBACK_ASSETS.md)。

主要新增/关联错误包括 `UNSUPPORTED_RENDERER_FEATURE`、`RENDERER_CHANGED`、`INVALID_POLICY`、`FALLBACK_ASSET_INVALID`，并保留既有会话、范围和断序错误。业务应按错误码处理，不匹配中文错误文案。

验证需覆盖：不创建 WebView 的二维/静态路径；3D 构造、脚本、桥接及上下文故障；隐藏计时；迟到回调；双侧效果和 T12 映射；切设备与快照重同步；图片与遮罩对齐。实际检查记录见 [VALIDATION.md](../VALIDATION.md)。本文件描述实现契约，不宣称电视或全部 Flutter 平台已验收。

二维调用 `setPerformanceMode` 保存偏好，返回 `configured` 和 `applied: false`，不会声称已修改二维画质；切到 3D 后应用该偏好。二维性能统计提供 renderMode、visible、renderCount，camera、triangles、drawCalls、maxFps 为 null，不伪造 3D 指标。

自定义型号在 Controller 生命周期内缓存，后端切换或网页实例更新时，在新后端 ready 通知之前重新注册；同一配置的对象键顺序不影响幂等判断。原生/auto 在注册前校验 fallback。纯 threeD 仍允许无 fallback 的 3D 配置，但该配置不能用于后续原生展示；准备切换为 auto/twoD/staticImage 的 App 应从一开始提供完整资产。

## 固定镜头与柔光呈现（视觉第二版）

二维展示使用床尾正中俯视视角，与对比页的 3D 初始镜头一致。人体左侧在画面右侧。完整床垫底图叠加单侧透视图，通过渐隐边缘与透明度过渡展示内部支撑。

软硬调节采用贴合气囊的青色柔光和细弧，不绘制发光矩形；同时调节多个区域时降低光圈密度，避免满屏亮环。加热使用铺在床面的暖橙椭圆渐变；按摩使用低饱和紫色扩散光圈。离线降低亮度，暂停、减少动态效果和 staticImage 保留静态状态表达。二维不模拟真实床体折弯，姿态仍以数值和示意显示。

运行 `npm run dev` 后打开 `/fallback-compare.html?mode=2d`，可切换 T12 原有 3D 与新版二维，并体验左右侧支撑、加热、按摩。网页为视觉对比入口；Flutter 仍使用原生 Canvas 和本地资源，网页效果验证不替代原生渲染及电视实机验收。RenderPolicy、Session 和设备状态接口保持原有契约。

### 2026-09-28 视觉修订：完整外罩与柔边区域光

按最新确认，原生二维和网页二维在软硬调节期间不显示透视图层，始终使用完整底图。气囊弧光改为沿区域投影的柔边矩形青色光，低透明度叠加并缓慢呼吸，不描硬边。已有 reveal 图片及 cells 元数据保留以兼容资源契约，但当前二维视图不加载 reveal 图片、不绘制逐囊轮廓。实时原始 3D 行为保持不变。本条取代上文关于二维透视及逐囊弧光的视觉规定。

2026-09-29：二维支撑光效改为较弱区域底光 + 青蓝粗粒子及短拖尾，单区域 18 粒、多区域每区 10 粒；原生暂停、静态和减少动态时冻结粒子，不恢复透视层。

2026-09-29 最新视觉修订：支撑粒子采用固定位置的细密圆形波点（20列×4行），替代流动粗粒子和拖尾。呼吸周期 3.6 秒，亮度与半径缓慢变化，行列轻微错相；原生静态/暂停时固定显示。

2026-09-29 波点密度与流动修订：每区域 28列×5行共140个圆点，保留3.6秒呼吸，叠加8秒横向循环流动；边缘淡入淡出，原生静态/暂停冻结流动。替代前条80点固定位置方案。

2026-09-29 最终动效修订：140个圆形波点固定位置，按距区域中心的椭圆归一化距离错相发亮与缩放，形成向外传播的涟漪；取消横向平移。周期3.6秒，保留完整床面与原生静态冻结。取代前条横向流动。

最新参考图修订：二维支撑采用局部蓝色能量底光、柔和蓝色边缘、140个低亮细点及4.8秒横向扫描脉冲；取代涟漪。光效贴合真实区域投影，保持完整床面，不增加悬浮全息或虚构床面隆起。原生静态/暂停不播放扫描。

参考图区域重做：二维光效采用圆角投影形状，视觉高度至少为底图66/1400，保持原始气路ID与状态映射；此范围是视觉强调，不代表物理气囊尺寸。增加多层蓝色外溢边光和渐变。网页另提供五部位低亮背景与局部放大，仅作T12默认腰路4的评审示意，不作为型号或气路定义。

### 3D 气囊区域对齐修订（2026-09-29）

光区按每排气囊的宽深、中心和当前高度绘制，取消34cm最小纵深和20mm显示升降限制。多排气路逐排显示，光层距气囊顶部6mm，真实跟随压力动画和床体折弯；在透明外罩之前绘制，保留遮挡关系。内部支撑光不跟随按摩床面的独立隆起。

取消三支白色实心箭头，用囊体侧面的细光纹向上/向下流动表达明确的 inflating/deflating 状态。没有明确方向的状态不猜测方向，暂停/离线/减少动态时冻结光纹。关闭选中区域旧的强网格、轮廓脉冲和散点，避免叠加。

网页模型右下提供“充气 ↑ / 放气 ↓”切换，使用 air.moveTo 的14级/秒演示速度；这不是生产设备动作速度。3D模式隐藏二维局部放大图。原生二维资产与后端选择策略不受本次修改影响。
