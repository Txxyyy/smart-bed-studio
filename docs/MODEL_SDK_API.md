# 床垫模型 SDK V.19 接口

本组件只显示模型。App 继续处理已有设备绑定、控制与 MQTT；App 根据自己的数据解析结果调用下面的接口，模型不连接 MQTT、不向设备发送命令。用户 App 与门店 App 使用相同接口，不自动生成调节数据。

## 入口

- `/`：型号选择及状态查看页。
- `/?embed=1`：仅模型画布，适合嵌入已有 App 页面。可追加 `&model=generic`；默认 T11+。
- `/?studio=1`：保留的 V.17 设计工作台及视觉调试循环，不用于驱动实际设备。
- 构建后的 `dist/index.html` 为单文件，以上查询参数同样适用；App 从自身 Web 容器加载它。
- 源码集成：从 `src/mattress-sdk.js` 导入 `createMattressViewer(container, options)`。每个实例独立，不依赖网页控件。返回值就是以下 `mattress` 对象。

页面准备好接口后发出 `window` 的 `mattress:ready` 事件，也可检查 `window.mattressDispatch` 是否存在。`await mattress.setModel(...)` 完成后才可操作对应型号。若页面默认型号不可用，接口仍可接收另一次 setModel，状态查询会返回 MODEL_NOT_READY。

## 1. 最常用的直接调用

```js
const model = await mattress.setModel('T11+');
const options = { modelToken: model.modelToken };

// App 确认左侧腰部开始工作后调用。
mattress.adjustment.begin(['left.lumbar'], options);
mattress.setAirState('left.lumbar', { value: 65 }, options);

// 后续数据持续更新数值；同一次调节不会反复扫描。
mattress.setAirState('left.lumbar', { value: 72 }, options);

// App 确认工作结束后调用；最后一个活动部位结束时扫描恢复外观。
mattress.adjustment.end(['left.lumbar'], options);

// 加热独立于气囊，只有加热时不自动透视。
mattress.heating.setState('right.leg', { level: 2, status: 'heating' }, options);
mattress.heating.setState('right.leg', { status: 'off' }, options);

// 实际背部/腿部角度，单位度。
mattress.setPose({ back: 30, leg: 15 }, options);

// 仅用于模型预览的连续运动：从当前显示值匀速走向目标。
// 气囊单位仍是型号区域 range 的展示级别；床体单位为度。
mattress.air.moveTo('left.lumbar', { target: 72, ratePerSecond: 12 });
mattress.pose.moveTo({
  back: { angle: 30, degreesPerSecond: 1 },
  leg: { angle: 15, degreesPerSecond: .5 }
});
```

`value` 使用型号区域 `range` 指定的范围，内置配置为 0–100 的展示级别；它不是默认以 kPa 为单位的测量值。内置加热 `level` 为 0–3；没有实际温度接口，不把档位当温度。

也可以一次调用同时表达值与工作状态：

```js
mattress.setAirState('left.lumbar', { value: 72, status: 'inflating' });
mattress.setAirState('left.lumbar', { value: 72, status: 'idle' });
```

气囊 status：`idle / inflating / deflating / adjusting / fault`。加热 status：`off / heating / holding / fault`。`heating` 显示动态热纹，`holding` 保留静态热色，`off / fault` 关闭热效果。气囊仅 value 变化时平滑改变实体形状，不据此猜测工作开始/结束。

`air.moveTo` 与 `pose.moveTo` 是视觉运动接口，返回各段 `actionId` 和预计 `durationMs`。它们会保持目标展示姿态，直到再次调用同一接口的 `stop`，或 App 用 `setAirState` / `setPose` / `updateDeviceState` 写入该区域的真实状态；真实状态会取消同一部位的视觉运动并接管显示。它们不发送任何设备命令。

`adjustment.begin/end/cancel(ids, options?)` 支持多个区域；cancel 表达 App 通知该区域活动已结束，模型本身不取消设备操作。只想取消视觉呈现而保留活动状态，请用 `animation.cancel()`。

## 2. 型号接口

| 调用 | 返回/行为 |
| --- | --- |
| `await setModel('T11+' / 't11-plus' / 'T12' / 't12' / 'generic')` | 原子切换配置，返回 id/name/revision/status/modelToken/input/regions/heating/massage/airbagCount/massageCellCount |
| `getModelInfo()` | 当前型号、能力与区域定义的只读副本 |
| `listModels()` | 当前实例已注册型号列表 |
| `registerModel(profile)` | 校验并登记声明式配置；随后可 setModel(profile.id) |

当前内置 T11+ revision 2 为单侧七囊三路、整床14囊；generic 为奶油通用外观、八区气囊与四个热区。T12 revision 8 使用每侧七路九排圆囊、整床126个支撑囊，左右独立潮汐腰部；外观按产品图固化，厚度、床屏及气囊尺寸为展示适配，加热布局待设备规格确认。详细区域见本文末的型号章节和 getModelInfo()。

首次无上报时读数为未知，静态默认几何不代表设备实测值。型号切换清空旧数据、效果和异步任务。App 切换到同型号的另一台设备也调用一次 setModel，并提交新设备状态。modelToken 只是加载版本标记，不是设备绑定；给晚到回调传入原标记可得到 `STALE_MODEL`，不能把旧数据改用新标记发送。

### T12 左右独立按摩

T12 revision 7 新增加热层下方的按摩气囊。`getModelInfo().massage` 返回每侧的单元布局及展示默认值；当前按参考示意图拟合每侧三组（6 + 6 + 4 个圆形囊），`massageCellCount` 为 32。`airbagCount` 在 T12 revision 8 为下层126个支撑气囊，两类计数独立。T11+ / 通用型号的 `massage` 为空，调用不支持侧别时返回 `UNSUPPORTED_MASSAGE`。

```js
const model = await mattress.setModel('T12');
const options = { modelToken: model.modelToken };

// App 收到左侧按摩运行状态后调用；不需要传入 MQTT 原文。
mattress.massage.setState('left', {
  status: 'running', intensity: 0.7, cycleSeconds: 9
}, options);
mattress.massage.setState('right', {
  status: 'running', intensity: 0.5, cycleSeconds: 12
}, options);

mattress.massage.setState('left', { status: 'paused' }, options);
mattress.massage.setState('left', { status: 'running' }, options); // 接续本侧进度
mattress.massage.setState('right', { status: 'off' }, options);   // 只停止右侧
```

| 字段 | 取值及含义 |
| --- | --- |
| `side` | `left` / `right`，仰躺人体左右，左 +X、右 −X |
| `status` | `running` 循环按摩；`paused` 保持本侧进度与形态；`off` / `fault` 平滑收尾并恢复面料；`null` 未知，不启动按摩 |
| `intensity` | 0–1，展示鼓起幅度；0 不显示按摩，默认 0.7；不表示实测气压 |
| `cycleSeconds` | 4–30 秒，一轮三组循环的时长，默认 9 秒；不是设备电磁阀时序 |

字段省略表示保持上次设置；`intensity` / `cycleSeconds` 为 null 时使用型号默认展示值。只设置强度或周期不会自动启动，运行中修改强度采用平滑过渡，暂停时保留可见形态、恢复后追随新设置。重复运行状态、修改周期和启动另一侧均不重置本侧相位，动画不改写 `observed.massage`；`rendered.massage` 提供展示相位和淡入幅度。批量入口接受 `massage: {left: {...}, right: {...}}`，与 air / heating / pose 同时提交时原子校验。

默认整体合拢且按摩不改变面料透明度。运行侧按摩气囊带动对应床面缓慢隆起、回落，紫色气囊光圈与扩散纹跟随床面；软硬调节仅改变内部支撑气囊，不顶起外罩。可同时叠加橙金加热、青蓝软硬调节及电动床姿态。开启自动跟随时，首次单侧按摩转向该侧床尾；已有按摩或软硬调节继续时不抢镜头。App 可以显式调用 camera.focusSide。

`animation.pause/resume` 控制整体效果时间线；`setDataAvailable(false)` 冻结当前按摩形态和相位；停止后收尾完毕不持续绘制。减少动态效果时显示静态按摩结构，停止后恢复实体外观。切换型号创建全新的按摩状态并回收实例网格资源。JSON 分发入口支持 `method: 'massage.setState'`，参数与 JavaScript 接口相同。

## 3. 批量状态入口（可选）

App 可直接调用上述分项接口，也可将已解析的数据一次提交为统一对象：

```js
const model = await mattress.setModel('T12');
mattress.updateDeviceState({
  air: {
    'left.circuit4': { value: 70, status: 'idle' },
    'left.circuit6': { value: 40, status: 'adjusting' }
  },
  heating: { 'right.leg': { level: 2, status: 'holding' } },
  massage: { left: { status: 'running', intensity: 0.7, cycleSeconds: 9 } }, // T12
  pose: { back: 0, leg: 0 },
  online: true
}, { kind: 'patch', modelToken: model.modelToken });
```

首次调用默认 snapshot，后续默认 patch。显式 `kind: 'snapshot'` 表示完整状态，未给出的区域字段变为未知；patch 只更改所给字段。字段缺省、null（未知）、0（零值）不同。未知值保留最后可见形态但不伪造读数。首次显式 patch 会返回 SNAPSHOT_REQUIRED。

同一消息中的区域变更先一起应用再判断活动侧，因此“腰部停止 + 腿部开始”不会造成退场后再次入场。两个分项调用在同一渲染帧内也会合并；若中间真实存在停止间隔，则按实际状态收尾。

可选 sequence 为非负整数。旧/重复序号返回 `{ignored:true,reason:'stale'}`；启用序号后增量断序抛出 RESYNC_REQUIRED，需完整快照恢复。无序号时以调用顺序为准。选择一种编号策略，直接分项调用若与批量调用混用，需保持同一顺序约定。

非法字段、未知区域或超范围数值会整体拒绝，不发生半次更新。`setDataAvailable(false)` 标记数据过期，保留值并停止无依据的光效；它不操纵 App 网络连接。

内置配置使用 `canonical-v1`。`mapped-v1` 是可选字段映射扩展，并非 App 对接前提；即使配置了映射，setAirState/setPose/heating.setState/massage.setState/adjustment 接口始终接收上述统一参数，不要求 MQTT 原始样例。按摩不增加 MQTT 字段映射配置，通过分项接口或 `normalized: true` 的批量入口提交。

## 4. 动画与镜头

区域侧别以**仰躺人体左右**定义：头部在床头（-Z）、足部在床尾（+Z），人体左侧为 +X，人体右侧为 -X。页面标签、区域 ID、加热和镜头使用同一规则。

默认自动编排：有活动部位时转向其侧，扫描进入；同侧连续活动保持透视；所有活动部位结束则扫描收尾。左右同时运行时同步两侧数值，镜头优先保留当前焦点；初始同时活动则保持整体观察，App 可以用 `camera.setPreferredSide('left')` 指定重点。需要两侧同时透视时，App 或页面预览分别调用 `effects.scanIn('left')` / `effects.scanIn('right')`，或用 `effects.setSideReveal` 设置各侧状态。

| 接口 | 参数及语义 |
| --- | --- |
| `camera.setPreset(name)` | perspective/leftFoot/rightFoot/left/right/top/side；top/side 为正投影 |
| `camera.focusRegion(id, {duration}?)` | 聚焦气囊或热区，毫秒；默认 1000 |
| `camera.focusSide('left' / 'right', {duration}?)` | 转到对应人体侧的床尾 70° 方位、约 30° 俯看视角；旋转与推近在同一次过渡内完成，不会改变设备状态 |
| `camera.setPose({position,target,duration})` | 两个三元素坐标数组，单位米；默认 1000 ms |
| `camera.fit() / reset()` | 适配当前结构 / 标准立体视角 |
| `camera.pause() / resume() / cancel()` | 控制相机过渡 |
| `camera.setAutoRotate(boolean)` | 开关持续旋转 |
| `camera.setZoom(number)` | 设置缩放，范围 0.2–5 |
| `camera.setFollow(boolean)` | 开关设备活动侧自动镜头 |
| `camera.setPreferredSide('left' / 'right' / null)` | 双侧活动时指定透视重点 |
| `animation.setPolicy('auto' / 'app')` | 自动扫描编排 / App 显式编排 |
| `animation.pause() / resume()` | 暂停/继续形变与效果时间线；继续接收状态，恢复追随最新目标 |
| `animation.cancel()` | 关闭软硬调节扫描透视/强调，转为 App 编排；不改变设备数据，加热/按摩用各自状态接口停止 |
| `effects.scanIn(side, {duration}?) / scanOut({duration}?)` | App 显式触发入场/退场扫描，默认型号 scanMs |
| `effects.setReveal({side,progress,phase})` | 高级接口，直接设置扫描遮罩；progress 0–1，phase closed/scan/adjust/closing |
| `effects.setSideReveal(side, {progress,phase})` | 独立设置人体左/右侧扫描状态；两侧可同时处于 scan 或 adjust |
| `air.moveTo(id, {target, ratePerSecond})` | 气囊从当前展示值匀速充气或放气到 target；ratePerSecond 为每秒展示级别变化量，范围 0–1000 |
| `air.stop(id)` | 停止该气囊的视觉运动，并把该区交还给随后到来的真实状态 |
| `pose.moveTo({back?, leg?})` | 背/腿独立匀速走到角度；每项为 `{angle, degreesPerSecond}`，最大 65° / 35°，速度最大 30°/秒 |
| `pose.stop('back' / 'leg'?)` | 停止指定床体部位，省略参数停止背部和腿部，并交还给真实状态 |
| `effects.setPoseSpeed(0.25–3)` | 设置模型中床体姿态的展示速度倍率；不发送硬件速度命令 |
| `effects.setHighlight(regionIds)` | 显式指定强调区域 |
| `effects.setHeatingStyle({moving})` | 是否允许动态热纹，不修改加热档位 |

手动镜头调用或用户拖动会关闭自动跟随；App 调用 setFollow(true) 恢复。setAutoRotate 也进入手动镜头模式。左右两侧同时调节时，两个扫描/形变状态独立；镜头只跟随最近指定的侧别，不停止另一侧。效果接口只控制表现；它们不能下发设备命令或制造设备完成状态。

页面自适应预览只在启动某侧时进行一次旋转与推近；肩背、腰部、臀部、腿部之间切换保持镜头不动。双侧同时运行时保留最近启动侧的视角，不随两侧的部位进度反复切换。`camera.focusRegion` 仍供 App 显式调用。

App 自行编排扫描时示例：

```js
mattress.animation.setPolicy('app');
mattress.camera.focusRegion('left.lumbar');
mattress.effects.scanIn('left');
mattress.effects.setHighlight(['left.lumbar']);
// App 后续继续调用 setAirState 更新实际值。
// 收到结束后：
mattress.effects.scanOut();
```

若需要镜头完成后再扫描，可监听相机返回的 actionId 对应的 `camera.completed` 事件。scanIn/scanOut 也返回 actionId 并发送完成/取消事件。该事件只表示视觉任务完成。

坐标为 Y 向上、+Z 指向床尾、+X 为从床尾面向床头时的右侧。当前结构长宽为 1.60 × 1.90 m；基础床垫厚度 0.21 m，T12 外观厚度按照片适配为 0.26 m。其他结构尺寸需另增模板，注册时不会悄悄缩放机构冒充真实尺寸。

## 5. 结构及生命周期

- `view.setMode('solid' / 'xray' / 'explode' / 'mechanism' / 'headboard')`。
- `view.focusLayer('comfort' / 'airbag' / 'foundation')`。
- `view.setBedStyle('flush' / 'wide')`、`view.setHeadboardStyle('cushion' / 'channel')`：搭配检查，不修改型号配置；重新 setModel 恢复预设。
- `resize()`：容器尺寸变化会自动观察，也可显式调用。
- `setInteractionEnabled(boolean)`：允许/禁止用户直接拖动、缩放或平移；App 镜头接口仍可用。
- `suspend()`：停止绘制，仍接收当前状态；`resume()` 同步最新数值并请求 App 按需补充最新状态。
- `dispose()`：释放实例的监听与图形资源；实例销毁后不可再加载型号。
- `getState()`：返回 observed（App 提供）、rendered（视觉插值）、reveal、camera、renderCount 等只读副本。

系统减少动态效果开启时跳过相机/扫描过渡并关闭动态流光。组件可通过创建选项 reducedMotion 显式指定。静止时停止绘制，持续调节/加热或自动旋转期间按需绘制。

## 6. 回调与原生 App 调用

```js
const unsubscribe = mattress.on('animation.completed', event => {
  // 仅视觉完成，不作为设备控制结果。
});
unsubscribe();
```

主要事件：`model.loading / model.ready`、`state.applied / state.resyncRequired`、`animation.started / animation.phase / animation.completed / animation.cancelled`、`camera.completed / camera.cancelled / camera.userControl`、`viewer.error`。`on('*', callback)` 订阅全部事件。

提供单一 JSON 分发入口，方便现有 App 容器桥接，不要求操作页面按钮：

```js
await window.mattressDispatch({
  requestId: 'app-12',
  method: 'setAirState',
  args: ['left.lumbar', { value: 70, status: 'adjusting' }]
});
// { requestId: 'app-12', ok: true, result: ... }
// 失败：{ requestId: 'app-12', ok: false, error: { code, message } }
```

嵌入页面以 `window` 的 `mattress:event` CustomEvent 转发 SDK 事件，App 的现有桥接可监听并转发 detail。requestId 用于关联调用结果，不是设备命令编号；当前分发器不缓存 requestId，重复状态值本身不会重复入场，重复显式镜头/scanIn 调用会替代前一个视觉任务。

## 7. 新型号配置

配置 schemaVersion 为 1。结构参考 `src/model-profiles.js` 的内置配置，动态气囊/热区字段在 `src/air-layout.js`。每个控制区域指定 id、side（0 右/1 左，按人体仰躺定义）、name、range；每个气囊指定 regionId、位置、尺寸、影响范围及高度参数。一个 regionId 可以关联多个气囊。热区独立于气囊下标。气囊内部索引由组件生成，App 不引用它。

通过 registerModel 注册完整配置，或创建组件时传入 `{profiles:[profile]}`。配置校验覆盖 ID/引用、半侧边界、数量上限、范围、模板、材质及贴图；配置在实例内不可变，不会被运行值改写。程序纹理与外部贴图均可由 appearance.materials 配置。

产品制作仍按“提供图片与必要规格 → 制作调优 → 确认 → 固化型号参数/资源版本”的流程进行；不要求提供 MQTT 示例。T12 外观、按摩与七路支撑已固化至 revision 8；实际尺寸和加热规格仍需硬件资料确认，测试用的非对称三气囊配置不是 T12。

## T11+ revision 2：单侧七囊、三路

T11+ 每侧按肩部 2 囊、腰部 2 囊、臀部 3 囊分组，共 14 个网格、6 个独立区域。区域 ID 为 `left.shoulder / left.lumbar / left.hip` 与 `right.shoulder / right.lumbar / right.hip`。同一区域的 value、status、动画及强调同步应用于组内所有气囊。T11+ 不再接受 `left.leg / right.leg` 作为软硬区域；腿部加热 ID 保留。

例如 `viewer.setAirState('left.hip', {value:70,status:'adjusting'})` 同时驱动左侧臀部三囊。原 `air.moveTo`、`adjustment.begin/end` 接口不变。页面按型号 regions 顺序依次执行肩→腰→臀，一次入场扫描、三个部位、一次退场扫描。App 应通过 getModelInfo 获取区域，而非固定四个部位。

分组数量由用户确认；单囊 65×15 cm、纵向中心间距 18 cm（跨组间距 23 cm）为展示适配，并非硬件实测尺寸。通用型号继续采用八囊演示布局；T12 使用下述 revision 8 七路结构。

## T12 revision 8：七路圆囊与潮汐腰部

每侧9排×7个囊体＝63囊，整床126囊。物理状态按 `left.circuit1`…`left.circuit7`、`right.circuit1`…`right.circuit7` 提交。气路2与7分别控制两排，其余控制一排。形态/连接来自结构图，位置与尺寸为展示适配。

```js
// 算法选择人体左侧第3路为腰部；不改变任何已上报的压力/工作状态。
viewer.tidal.setWaistCircuit('left', 3, {modelToken});
// 物理气路上报，始终不受部位归并影响。
viewer.setAirState('left.circuit4', {value:60,status:'inflating'}, {modelToken});
// 按当前部位归并批量更新其所属气路，同一次校验后原子应用。
viewer.body.setState('left.hip', {value:60,status:'adjusting'}, {modelToken});
```

归并规则：肩=1；背=2及腰部选中路上方的候选路；腰=选中的3/4/5；臀=6及下方候选路；腿=7。左右独立。默认4为展示初值，并非算法识别结果，App 应显式设置。`getModelInfo()` 返回 `waistCircuits` 和 `adjustmentGroups`（含每部位 circuitIds）；映射变化事件为 `model.mappingChanged`。切换型号后映射重置，旧 modelToken 拒绝。

`body.setState` 支持 shoulder/back/lumbar/hip/leg；物理气路沿用 air.moveTo、adjustment.begin/end 等接口。T12 原 left.lumbar 等部位 ID 应迁移到 body.setState；setAirState 的 T12 ID 现在表示物理气路。加热和按摩 ID 不变。正在执行的物理动作保留原气路；重新归并影响后续部位调用。页面切换腰部选择会停止本侧预览，下一轮按肩→背→腰→臀→腿依次演示。JSON 分发支持以上两个新方法。

### T12 圆囊调节光效（2026-10-15）

揭开外罩后，T12 每一路圆囊按状态显示，未调节的圆囊保持暗色休眠，只留顶面细描边：

| 外观 | 条件 | 表现 |
| --- | --- | --- |
| 充气 | `status: 'inflating'`，或 `air.moveTo` 目标高于当前，或上报数值持续上升 | 青色；柱壁光带自下而上，光点上升，顶面波纹外扩 |
| 放气 | `status: 'deflating'`，或 `air.moveTo` 目标低于当前，或上报数值持续下降 | 琥珀色；光带自上而下，光点下落 |
| 保压 | `adjusting` 且没有方向（数值停止变化 0.8 秒后） | 浅青色缓慢呼吸 |
| 故障 | `status: 'fault'`，且该侧正在展示 | 静态红色，不显示流向 |
| 休眠 | 其余情况 | 深色圆囊，顶面一圈冷灰描边 |

调节中的每排还有：顶面压力刻度环（按当前展示值点亮，目标值处有亮点）、整排底部的括号形光垫，以及从床尾控制仓沿气路流向该排的流光。同一排7个囊从靠近床中线的一端依次点亮。用 `air.moveTo` 预览时，目标高度会出现一圈虚线环：向上调时悬在顶面上方，向下调时套在柱壁外侧。扫描进入/退出时，扫描线经过的排会闪亮一次，底板细网格随扫描线扫亮。

App 端建议：设备能区分充气和放气时，直接上报 `inflating` / `deflating`，方向最准确；只能上报 `adjusting` 时，模型会根据数值变化推断方向。光效不新增接口，也不改变状态语义。暂停、离线、减少动态效果时只显示静态高亮；淡入淡出结束后停止绘制。光效不进入 GLB。

## 手机性能接口（2026-09-21）

构造支持 `performanceMode: 'auto' | 'native' | 'eco' | 'balanced' | 'high'`（默认auto，所有设备native，保留原画质及屏幕刷新节奏）。运行时 `setPerformanceMode(mode)` 切换；`setVisible(false/true)` 与 App 页面生命周期对接；`getPerformanceStats()` 获取计数和档位。三者支持页面 JSON 分发。详细档位、后台停绘语义和验证限制见 [PERFORMANCE.md](PERFORMANCE.md)。

## Flutter 嵌入（1.1.0）

新增 UI-free 的 embed.html、WebViewBridge 协议 v1 和 flutter/smart_mattress_viewer 组件包。独立入口先建立桥接，由 App 显式 setModel；model.presented 表示型号首帧已提交。旧 ?embed=1 保留 window.mattress / mattressDispatch 及型号查询参数。完整接入见 [FLUTTER_INTEGRATION.md](FLUTTER_INTEGRATION.md)。

## Flutter 原生展示后端

本文件的 JavaScript 接口仍描述 WebView 3D SDK。Flutter 可通过 `RenderPolicy.auto / threeD / twoD / staticImage` 选择展示，原生二维无需 WebView 或 JS 执行。默认仍为 `threeD`，新接入显式使用 auto。

两后端共用设备状态语义、型号区域 ID、null/省略/0 区分、固定 Session 和快照/增量顺序。原生二维以高亮替代 focusSide/focusRegion，任意镜头和结构展示受限；registerModel 需要额外的 fallback 描述和随 App 打包的本地资产，不能将全量 JS 方法视为均可用：详细支持矩阵见 [RENDER_FALLBACK.md](RENDER_FALLBACK.md)。不支持的展示方法返回 `UNSUPPORTED_RENDERER_FEATURE`，型号业务不支持仍使用 `UNSUPPORTED_MASSAGE` 等原错误码。

Flutter 的 `RendererInfo.capabilities` 是展示能力，`MattressModelInfo` 是设备型号能力。后端切换触发重复 onReady，App 重建固定会话并同步最新状态。首帧提交屏障关联型号 token 与展示状态版本，仅证明渲染提交，不能证明硬件动作完成或视觉验收。

原生聚焦返回 `actionId` 与 `representation: highlight`，完成事件为 `presentation.completed`，不是 `camera.completed`。原生 `setPerformanceMode` 返回 `configured`、`applied: false` 并保留 3D 偏好；性能统计中的 camera/triangles/drawCalls/maxFps 为 null。
