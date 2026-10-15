import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import '../rendering/native_backend.dart';
import '../state/native_profile.dart';
import 'soft_light_painter.dart';

class NativeMattressView extends StatefulWidget {
  final NativeBackend backend;
  final bool visible;
  final Color background;
  const NativeMattressView(
      {super.key,
      required this.backend,
      required this.visible,
      required this.background});
  @override
  State<NativeMattressView> createState() => _NativeMattressViewState();
}

class _NativeMattressViewState extends State<NativeMattressView>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late Ticker _ticker;
  Duration? _last;
  bool _foreground = true;
  String? _reportedImage;
  String? _lastModelToken;
  final Map<String, String> _lastAirBySide = {};
  @override
  void initState() {
    super.initState();
    _foreground = WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    _ticker = createTicker(_tick);
    widget.backend.addListener(_changed);
    _sync();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    widget.backend.reducedMotion = MediaQuery.of(context).disableAnimations;
    _sync();
  }

  @override
  void didUpdateWidget(NativeMattressView old) {
    super.didUpdateWidget(old);
    if (old.backend != widget.backend) {
      old.backend.removeListener(_changed);
      widget.backend.addListener(_changed);
      _reportedImage = null;
      _lastModelToken = null;
      _lastAirBySide.clear();
    }
    _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  void _tick(Duration elapsed) {
    final last = _last;
    _last = elapsed;
    if (last != null)
      widget.backend.advance((elapsed - last).inMicroseconds / 1000000);
  }

  void _sync() {
    final active =
        widget.visible && _foreground && widget.backend.needsAnimation;
    if (active && !_ticker.isActive) {
      _last = null;
      _ticker.start();
    } else if (!active && _ticker.isActive) {
      _ticker.stop();
      _last = null;
    }
  }

  void _changed() {
    _sync();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.backend.removeListener(_changed);
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.backend, p = b.profile;
    if (p == null)
      return ColoredBox(
          color: widget.background,
          child: const Center(
              child: Text('等待床垫状态', style: TextStyle(color: Colors.white70))));
    final fallback = p['fallback'] is Map ? p['fallback'] as Map : null;
    final metadata =
        fallback?['regions'] is Map ? fallback!['regions'] as Map : null;
    final image =
        fallback?['image'] is String ? fallback!['image'] as String : null;
    if (_lastModelToken != b.modelToken) {
      _lastModelToken = b.modelToken;
      _lastAirBySide.clear();
    }
    for (final region in p['regions'] as List) {
      final id = region['id'] as String;
      final record = (b.state['air'] as Map? ?? {})[id] as Map? ?? {};
      if (['inflating', 'deflating', 'adjusting'].contains(record['status']) ||
          b.motions.containsKey('air:$id') ||
          b.highlight?.contains(id) == true) {
        _lastAirBySide[region['side'] == 1 ? 'left' : 'right'] = id;
      }
    }
    var valid = true;
    try {
      validateNativeAssets(p);
    } catch (_) {
      valid = false;
      final key = 'invalid-${p['id']}-${p['revision']}';
      if (_reportedImage != key) {
        _reportedImage = key;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) b.reportAssetError('FALLBACK_ASSET_INVALID');
        });
      }
    }
    final pose = b.state['pose'] as Map? ?? {};
    final offline = b.state['online'] == false;
    String label(String kind, String id) {
      final definitions = p[kind == 'air' ? 'regions' : kind] as List? ?? [];
      final matches = definitions.where((r) => r['id'] == id);
      if (matches.isEmpty) return '区域';
      final r = matches.first;
      return kind == 'massage'
          ? (r['side'] == 1 ? '左侧按摩' : '右侧按摩')
          : '${r['side'] == 1 ? '左侧' : '右侧'}${r['name']}';
    }

    final entries = <String>[];
    for (final m in b.motions.values.where((m) => m['kind'] == 'air-motion')) {
      entries.add('${label('air', m['key'])} 展示目标 ${m['target']}');
    }
    for (final kind in ['air', 'heating', 'massage']) {
      for (final e in (b.state[kind] as Map? ?? {}).entries) {
        final record = e.value as Map;
        final status = record['status'];
        if (status == null) {
          entries.add('${label(kind, e.key)} 未知');
          continue;
        }
        if (['idle', 'off'].contains(status)) continue;
        const labels = {
          'inflating': '充气中',
          'deflating': '放气中',
          'adjusting': '调节中',
          'heating': '加热中',
          'holding': '保温',
          'running': '按摩中',
          'paused': '暂停',
          'fault': '故障'
        };
        entries.add(
            '${label(kind, e.key)} ${labels[status] ?? status}${record['level'] != null ? ' ${record['level']}档' : ''}');
      }
    }
    return ColoredBox(
        color: widget.background,
        child: Column(children: [
          Expanded(child: LayoutBuilder(builder: (context, c) {
            if (!valid)
              return const Center(
                  child: Text('区域示意资源不可用，请查看状态',
                      style: TextStyle(color: Colors.white70)));
            final width = (metadata!['width'] as num).toDouble(),
                height = (metadata['height'] as num).toDouble();
            final scale = math.min(c.maxWidth / width, c.maxHeight / height);
            final cacheWidth =
                (width * scale * MediaQuery.of(context).devicePixelRatio)
                    .round()
                    .clamp(1, 1920);
            return Center(
                child: SizedBox(
                    width: width * scale,
                    height: height * scale,
                    child: Stack(fit: StackFit.expand, children: [
                      if (image != null)
                        RepaintBoundary(
                            child: Image.asset(image,
                                fit: BoxFit.contain, cacheWidth: cacheWidth,
                                errorBuilder: (context, error, stack) {
                          if (_reportedImage != image) {
                            _reportedImage = image;
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (mounted)
                                b.reportAssetError('FALLBACK_ASSET_MISSING');
                            });
                          }
                          return CustomPaint(
                              painter: _OutlinePainter(metadata));
                        }))
                      else
                        CustomPaint(painter: _OutlinePainter(metadata)),
                      RepaintBoundary(
                          child: CustomPaint(
                              painter: SoftLightPainter(
                                  b, metadata, _lastAirBySide))),
                    ])));
          })),
          SizedBox(
              width: 160,
              height: 48,
              child: CustomPaint(painter: _PosePainter(b))),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Text(
                  '${p['name']} · 固定姿态示意 · 左右按仰躺人体${offline ? ' · 设备离线，以下为最后状态' : ''}',
                  style: const TextStyle(color: Colors.white70, fontSize: 13))),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                  '背部 ${pose['back'] ?? '未知'}° · 腿部 ${pose['leg'] ?? '未知'}°${b.motions.values.where((m) => m['kind'] == 'pose-motion').map((m) => ' · ${m['key'] == 'back' ? '背部' : '腿部'}目标 ${m['target']}°').join()}',
                  style: const TextStyle(color: Colors.white, fontSize: 14))),
          ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 140),
              child: SingleChildScrollView(
                  child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                          entries.isEmpty ? '当前无活动调节' : entries.join('  ·  '),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 12))))),
        ]));
  }
}

Path _polygon(List points, Size s) {
  final p = Path();
  for (var i = 0; i < points.length; i++) {
    final v = points[i];
    final x = (v[0] as num).toDouble() * s.width,
        y = (v[1] as num).toDouble() * s.height;
    if (i == 0) {
      p.moveTo(x, y);
    } else {
      p.lineTo(x, y);
    }
  }
  return p..close();
}

class _OutlinePainter extends CustomPainter {
  final Map metadata;
  _OutlinePainter(this.metadata);
  @override
  void paint(Canvas c, Size s) {
    final points = metadata['surface'] as List?;
    if (points == null) return;
    final p = _polygon(points, s);
    c.drawPath(p, Paint()..color = const Color(0xffcbd0d5));
    c.drawPath(
        p,
        Paint()
          ..color = Colors.white54
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2);
  }

  @override
  bool shouldRepaint(_OutlinePainter old) => old.metadata != metadata;
}

class _PosePainter extends CustomPainter {
  final NativeBackend backend;
  _PosePainter(this.backend) : super(repaint: backend.frames);
  @override
  void paint(Canvas canvas, Size size) {
    void draw(num back, num leg, Color color) {
      final origin = Offset(size.width * .45, size.height * .77),
          length = math.min(size.width * .3, size.height * .7);
      final b = back * math.pi / 180, l = leg * math.pi / 180;
      final path = Path()
        ..moveTo(
            origin.dx - length * math.cos(b), origin.dy - length * math.sin(b))
        ..lineTo(origin.dx, origin.dy)
        ..lineTo(origin.dx + length * .45, origin.dy)
        ..lineTo(origin.dx + length * .45 + length * .7 * math.cos(l),
            origin.dy - length * .7 * math.sin(l));
      canvas.drawPath(
          path,
          Paint()
            ..color = color
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2.5
            ..strokeCap = StrokeCap.round);
    }

    final pose = backend.state['pose'] as Map? ?? {};
    draw(pose['back'] as num? ?? 0, pose['leg'] as num? ?? 0, Colors.white54);
    if (backend.motions.values.any((m) => m['kind'] == 'pose-motion')) {
      draw(backend.rendered['pose']['back'] ?? 0,
          backend.rendered['pose']['leg'] ?? 0, const Color(0xff43d7ef));
    }
  }

  @override
  bool shouldRepaint(_PosePainter old) => true;
}
