import 'dart:async';
import 'package:flutter/material.dart';
import 'package:smart_mattress_viewer/smart_mattress_viewer.dart';

void main() => runApp(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData.dark(useMaterial3: true),
    home: const ExamplePage()));

class ExamplePage extends StatefulWidget {
  const ExamplePage({super.key});
  @override
  State<ExamplePage> createState() => _ExamplePageState();
}

class _ExamplePageState extends State<ExamplePage> {
  final controller = MattressController();
  MattressSession? session;
  StreamSubscription<MattressEvent>? subscription;
  String model = 'T12', message = '正在初始化', region = '';
  final Map<String, dynamic> latest = {};
  double back = 0, leg = 0, speed = 3;
  int heat = 0;
  bool hidden = false;
  final massage = {Side.left: false, Side.right: false};
  @override
  void initState() {
    super.initState();
    subscription = controller.events.listen((event) {
      if (mounted &&
          ['model.presented', 'animation.completed', 'camera.completed']
              .contains(event.name)) setState(() => message = event.name);
    });
  }

  Future<void> run(Future<dynamic> Function() action) async {
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => message = error.toString());
    }
  }

  Future<void> selectModel(String id) async {
    if (mounted)
      setState(() {
        session = null;
        model = id;
        message = '加载 $id';
      });
    final next = await controller.setModel(id);
    latest.clear();
    latest.addAll({
      'air': {
        for (final r in next.modelInfo.regions)
          r['id']: {'value': 35, 'status': 'idle'}
      },
      'heating': {
        for (final r in next.modelInfo.heating)
          r['id']: {'level': 0, 'status': 'off'}
      },
      if (next.modelInfo.supportsMassage)
        'massage': <String, dynamic>{
          'left': {'status': 'off'},
          'right': {'status': 'off'}
        },
      'pose': {'back': 0, 'leg': 0},
      'online': true,
    });
    await next.applySnapshot(MattressState.fromJson(latest));
    if (!mounted || !next.isCurrent) return;
    setState(() {
      session = next;
      region = next.modelInfo.regions.first['id'] as String;
      back = 0;
      leg = 0;
      heat = 0;
      massage[Side.left] = false;
      massage[Side.right] = false;
      message = '$id 已就绪 · ${next.modelInfo.airbagCount} 个支撑气囊';
    });
  }

  Future<void> air(AirStatus status) async {
    final active = session!;
    final value = status == AirStatus.inflating
        ? 80
        : status == AirStatus.deflating
            ? 15
            : ((latest['air'] as Map)[region]['value'] as num);
    (latest['air'] as Map)[region] = {'value': value, 'status': status.name};
    await active.setAirState(regionId: region, value: value, status: status);
  }

  Future<void> heating() async {
    heat = (heat + 1) % 4;
    final records = {
      for (final r in session!.modelInfo.heating)
        r['id']: {'level': heat, 'status': heat == 0 ? 'off' : 'heating'}
    };
    latest['heating'] = records;
    await session!.applyPatch(MattressState.fromJson({'heating': records}));
    if (mounted) setState(() {});
  }

  Future<void> setMassage(Side side) async {
    massage[side] = !massage[side]!;
    (latest['massage'] as Map)[side.name] = {
      'status': massage[side]! ? 'running' : 'off',
      'intensity': 0.7,
      'cycleSeconds': 9
    };
    await session!.setMassage(
        side: side,
        status: massage[side]! ? MassageStatus.running : MassageStatus.off,
        intensity: 0.7,
        cycleSeconds: 9);
    if (mounted) setState(() {});
  }

  Future<void> movePose() async {
    latest['pose'] = {'back': back, 'leg': leg};
    await session!.movePose(
        back: PoseTarget(back, degreesPerSecond: speed),
        leg: PoseTarget(leg, degreesPerSecond: speed));
  }

  @override
  void dispose() {
    subscription?.cancel();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('床垫模型 Flutter 接入示例')),
        body: Column(children: [
          const Padding(
              padding: EdgeInsets.all(8),
              child: Text('以下按钮模拟设备上报及视觉运动，不发送设备命令。左右以人体仰躺为准。')),
          Expanded(
              child: MattressView(
                  controller: controller,
                  visible: !hidden,
                  onReady: () => selectModel(model),
                  onResyncRequired: (active) => active
                      .applySnapshot(MattressState.fromJson(latest))
                      .then((_) {}),
                  onError: (error) {
                    if (mounted) setState(() => message = error.toString());
                  })),
          SizedBox(
              height: 260,
              child: SingleChildScrollView(
                  padding: const EdgeInsets.all(12),
                  child: Column(children: [
                    Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          for (final id in ['T11+', 'T12', 'generic'])
                            OutlinedButton(
                                onPressed: () => run(() => selectModel(id)),
                                child: Text(id)),
                          TextButton(
                              onPressed: () => setState(() => hidden = !hidden),
                              child: Text(hidden ? '恢复显示' : '暂停绘制')),
                          TextButton(
                              onPressed: () => run(() =>
                                  controller.getPerformanceStats().then((v) {
                                    if (mounted)
                                      setState(() => message = v.toString());
                                  })),
                              child: const Text('性能统计')),
                        ]),
                    if (session != null) ...[
                      DropdownButton<String>(
                          value: region,
                          items: session!.modelInfo.regions
                              .map((r) => DropdownMenuItem(
                                  value: r['id'] as String,
                                  child: Text('${r['id']} · ${r['name']}')))
                              .toList(),
                          onChanged: (v) => setState(() => region = v!)),
                      Wrap(spacing: 8, runSpacing: 6, children: [
                        for (final status in [
                          AirStatus.inflating,
                          AirStatus.deflating,
                          AirStatus.idle
                        ])
                          OutlinedButton(
                              onPressed: () => run(() => air(status)),
                              child: Text({
                                AirStatus.inflating: '上报充气',
                                AirStatus.deflating: '上报放气',
                                AirStatus.idle: '上报结束'
                              }[status]!)),
                        OutlinedButton(
                            onPressed: () => run(heating),
                            child: Text('加热 $heat 档')),
                        if (session!.modelInfo.supportsMassage)
                          for (final side in Side.values)
                            OutlinedButton(
                                onPressed: () => run(() => setMassage(side)),
                                child: Text(
                                    '${side == Side.left ? '左' : '右'}侧按摩 ${massage[side]! ? '关闭' : '开启'}')),
                        if (session!.modelInfo.supportsTidal)
                          for (final side in Side.values)
                            PopupMenuButton<int>(
                                tooltip: '选择腰部气路',
                                onSelected: (value) => run(() =>
                                    session!.setWaistCircuit(side, value)),
                                itemBuilder: (_) => [
                                      for (final value in [3, 4, 5])
                                        PopupMenuItem(
                                            value: value,
                                            child: Text('腰部：气路$value'))
                                    ],
                                child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: Text(
                                        '${side == Side.left ? '左' : '右'}侧腰部映射'))),
                        for (final side in Side.values)
                          TextButton(
                              onPressed: () =>
                                  run(() => session!.focusSide(side)),
                              child:
                                  Text('${side == Side.left ? '左' : '右'}侧镜头')),
                        TextButton(
                            onPressed: () =>
                                run(() => session!.setCameraFollow(true)),
                            child: const Text('自动跟随')),
                        TextButton(
                            onPressed: () => run(() => session!.resetCamera()),
                            child: const Text('重置镜头')),
                      ]),
                      Row(children: [
                        const Text('背部'),
                        Expanded(
                            child: Slider(
                                value: back,
                                max: 65,
                                label: '$back°',
                                onChanged: (v) =>
                                    setState(() => back = v.roundToDouble()),
                                onChangeEnd: (_) => run(movePose))),
                        Text('${back.toInt()}°')
                      ]),
                      Row(children: [
                        const Text('腿部'),
                        Expanded(
                            child: Slider(
                                value: leg,
                                max: 35,
                                label: '$leg°',
                                onChanged: (v) =>
                                    setState(() => leg = v.roundToDouble()),
                                onChangeEnd: (_) => run(movePose))),
                        Text('${leg.toInt()}°')
                      ]),
                      Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            TextButton(
                                onPressed: speed <= 0.5
                                    ? null
                                    : () => setState(() => speed -= 0.5),
                                child: const Text('−0.5')),
                            Text('$speed°/秒'),
                            TextButton(
                                onPressed: speed >= 30
                                    ? null
                                    : () => setState(() => speed += 0.5),
                                child: const Text('+0.5')),
                            TextButton(
                                onPressed: () => run(() {
                                      setState(() {
                                        back = 0;
                                        leg = 0;
                                      });
                                      return movePose();
                                    }),
                                child: const Text('平躺')),
                            TextButton(
                                onPressed: () => run(() {
                                      setState(() {
                                        back = 35;
                                        leg = 15;
                                      });
                                      return movePose();
                                    }),
                                child: const Text('阅读姿态')),
                          ]),
                    ],
                    SelectableText(message,
                        style: const TextStyle(fontSize: 12)),
                  ]))),
        ]),
      );
}
