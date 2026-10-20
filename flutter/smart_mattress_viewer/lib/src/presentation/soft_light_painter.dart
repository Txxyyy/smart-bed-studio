import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import '../rendering/native_backend.dart';
import 'fallback_layers.dart';

/// 二维调节光效的配色，与 3D `AIR_FX_COLORS`（src/air-cell-effect.js）一致。
class AirFxColors {
  static const inflate = Color(0xff16c8ff);
  static const deflate = Color(0xffff8a1e);
  static const hold = Color(0xff7fe2ff);
  static const fault = Color(0xffff3048);
  static const scan = Color(0xff9cf1ff);
}

/// 床面顶面到底图的透视映射。导出脚本把 1.6 × 1.9 m 床面顶面四角投影为 `surface`；
/// 平面在透视投影下是单应变换，所以床面上任一点 (x, z)（米）都能精确换算到底图像素。
class SurfaceProjection {
  static const halfWidth = .8, halfLength = .95;
  final double _a, _b, _c, _d, _e, _f, _g, _h;
  const SurfaceProjection._(
      this._a, this._b, this._c, this._d, this._e, this._f, this._g, this._h);

  /// `surface` 顺序为床头左、床头右、床尾右、床尾左（世界坐标 -X/+X、-Z/+Z）。
  static SurfaceProjection? fromMetadata(Map<dynamic, dynamic> metadata) {
    final surface = metadata['surface'];
    final width = metadata['width'], height = metadata['height'];
    if (surface is! List || surface.length != 4) return null;
    if (width is! num || height is! num) return null;
    final p = [
      for (final q in surface)
        Offset(((q as List)[0] as num).toDouble() * width,
            (q[1] as num).toDouble() * height)
    ];
    // 单位正方形到四边形的闭式解（Heckbert）。
    final sx = p[0].dx - p[1].dx + p[2].dx - p[3].dx,
        sy = p[0].dy - p[1].dy + p[2].dy - p[3].dy;
    if (sx.abs() < 1e-9 && sy.abs() < 1e-9) {
      return SurfaceProjection._(p[1].dx - p[0].dx, p[3].dx - p[0].dx, p[0].dx,
          p[1].dy - p[0].dy, p[3].dy - p[0].dy, p[0].dy, 0, 0);
    }
    final dx1 = p[1].dx - p[2].dx,
        dx2 = p[3].dx - p[2].dx,
        dy1 = p[1].dy - p[2].dy,
        dy2 = p[3].dy - p[2].dy,
        den = dx1 * dy2 - dx2 * dy1;
    if (den.abs() < 1e-9) return null;
    final g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return SurfaceProjection._(
        p[1].dx - p[0].dx + g * p[1].dx,
        p[3].dx - p[0].dx + h * p[3].dx,
        p[0].dx,
        p[1].dy - p[0].dy + g * p[1].dy,
        p[3].dy - p[0].dy + h * p[3].dy,
        p[0].dy,
        g,
        h);
  }

  /// 床面坐标（米，x 向人体左侧为正，z 向床尾为正）到底图像素。
  Offset map(double x, double z) {
    final u = (x + halfWidth) / (2 * halfWidth),
        v = (z + halfLength) / (2 * halfLength),
        w = _g * u + _h * v + 1;
    return Offset((_a * u + _b * v + _c) / w, (_d * u + _e * v + _f) / w);
  }
}

/// 正在点亮的一路气囊。
class _LitCircuit {
  final String id;
  final Color tint;
  final double energy, direction;
  final bool fault, animate;
  _LitCircuit(this.id, this.tint, this.energy, this.direction, this.fault,
      this.animate);
}

/// 一个气囊在床面上的投影：条囊为圆角矩形，圆囊阵列每个圆囊一个轮廓。
class _Cell {
  final List<Offset> outline;

  /// 0 = 靠近床中线（气路端），1 = 床边。
  final double order;
  _Cell(this.outline, this.order);
}

class _Bag {
  final String regionId;
  final int side;
  final bool round;
  final double inner, outer, z, depth;
  final List<_Cell> cells;
  _Bag(this.regionId, this.side, this.round, this.inner, this.outer, this.z,
      this.depth, this.cells);
}

/// 型号底图对应的气囊投影，按元数据缓存；尺寸变化时只重建缩放后的路径。
class _AirGeometry {
  final SurfaceProjection projection;
  final List<_Bag> bags;
  final List<Offset> surface;
  final Map<String, List<Offset>> sides;
  Size? _size;
  final Map<_Cell, Path> _paths = {};
  _AirGeometry(this.projection, this.bags, this.surface, this.sides);

  static final _cache = Expando<_AirGeometry>();

  static _AirGeometry? of(
      Map<dynamic, dynamic> metadata, Map<String, dynamic>? profile) {
    final cached = _cache[metadata];
    if (cached != null) return cached;
    final projection = SurfaceProjection.fromMetadata(metadata);
    final airbags = profile?['airbags'];
    if (projection == null || airbags is! List) return null;
    const segments = 6;
    final bags = <_Bag>[];
    for (final raw in airbags) {
      final bag = raw as Map;
      final x = (bag['x'] as num).toDouble(),
          z = (bag['z'] as num).toDouble(),
          width = (bag['width'] as num).toDouble(),
          depth = (bag['depth'] as num).toDouble(),
          sign = x < 0 ? -1.0 : 1.0,
          inner = x - sign * width / 2,
          outer = x + sign * width / 2;
      final round = bag['shape'] == 'round-array';
      final cells = <_Cell>[];
      if (round) {
        final count = (bag['cellCount'] as num? ?? 7).toInt(),
            pitch = width / count,
            radius = math.min(depth, pitch) * .46;
        for (var i = 0; i < count; i++) {
          final cx = x + (i - (count - 1) / 2) * pitch;
          cells.add(_Cell([
            for (var k = 0; k < 24; k++)
              projection.map(cx + radius * math.cos(k * math.pi / 12),
                  z + radius * math.sin(k * math.pi / 12))
          ], ((cx - inner) / (outer - inner)).abs().clamp(0.0, 1.0)));
        }
      } else {
        // 与 model.js 的条囊同一圆角，略向内收，避免相邻光带连成一片。
        final hx = width / 2 - .006,
            hz = depth / 2 - .006,
            r = math.min(.047, math.min(width * .2, depth * .2)) - .006;
        final corners = [
          Offset(x + hx - r, z - hz + r),
          Offset(x + hx - r, z + hz - r),
          Offset(x - hx + r, z + hz - r),
          Offset(x - hx + r, z - hz + r),
        ];
        final outline = <Offset>[];
        for (var c = 0; c < 4; c++) {
          for (var k = 0; k <= segments; k++) {
            final a = (c - 1 + k / segments) * math.pi / 2;
            outline.add(projection.map(corners[c].dx + r * math.cos(a),
                corners[c].dy + r * math.sin(a)));
          }
        }
        cells.add(_Cell(outline, .5));
      }
      bags.add(_Bag(bag['regionId'] as String, (bag['side'] as num).toInt(),
          round, inner, outer, z, depth, cells));
    }
    List<Offset> quad(double x0, double x1) => [
          projection.map(x0, -SurfaceProjection.halfLength),
          projection.map(x1, -SurfaceProjection.halfLength),
          projection.map(x1, SurfaceProjection.halfLength),
          projection.map(x0, SurfaceProjection.halfLength),
        ];
    final geometry = _AirGeometry(projection, bags, quad(-.8, .8), {
      'left': quad(0, .8),
      'right': quad(-.8, 0),
    });
    _cache[metadata] = geometry;
    return geometry;
  }

  /// 底图像素到画布的统一缩放（画布保持底图宽高比）。
  void resize(Size size, double scale) {
    if (_size == size) return;
    _size = size;
    _paths.clear();
    for (final bag in bags) {
      for (final cell in bag.cells) {
        _paths[cell] = Path()
          ..addPolygon([for (final p in cell.outline) p * scale], true);
      }
    }
  }

  Path path(_Cell cell) => _paths[cell]!;
}

/// 降级二维的调节光效，取自 3D 渲染：
/// - 某侧开始调节时，与 3D 一样随扫描线从床头到床尾把该侧外罩换成 3D 揭开后的透视层
///   （半透明外罩、深色气囊、底板网格与气路，src/fallback-assets/*/reveal-*.png）；
/// - 调节中的气路叠加该路的 3D 光效层（glow-*.png，以中性白色烘焙），按充气青/放气琥珀/
///   保压浅青（缓慢呼吸）/故障红（静态）着色后加色叠加；充放气时再叠一段从床中线扫向床边的
///   流光（放气反向）表达方向；
/// - 结束时扫描退场，最后调节的气路随之淡出；静态、暂停和减少动态时无流光、呼吸与扫描动画。
/// 缺少烘焙图层（旧资源或自定义型号）时，回退为按床面透视绘制的气囊亮边与柔光。
/// 网页评审页 fallback-compare.html 用同一画法和参数，二者同步修改。加热与按摩沿用原有柔光与波纹。
class SoftLightPainter extends CustomPainter {
  final NativeBackend backend;
  final Map<dynamic, dynamic> metadata;
  final Map<String, String> lastAirBySide;
  final FallbackLayers layers;
  SoftLightPainter(this.backend, this.metadata, this.lastAirBySide, this.layers)
      : super(repaint: Listenable.merge([backend.frames, layers]));

  /// 充气 1、放气 -1、保压/未知 0：显式状态优先，其次是展示中的 air.moveTo 方向。
  static double airDirection(String? status, Map<dynamic, dynamic>? motion) {
    if (status == 'inflating') return 1;
    if (status == 'deflating') return -1;
    if (motion != null) {
      final target = (motion['target'] as num).toDouble(),
          value = (motion['value'] as num).toDouble();
      if (target != value) return (target - value).sign;
    }
    return 0;
  }

  static Color airTint(String? status, double direction) => status == 'fault'
      ? AirFxColors.fault
      : direction > 0
          ? AirFxColors.inflate
          : direction < 0
              ? AirFxColors.deflate
              : AirFxColors.hold;

  /// 扫描线位置，与 src/air-cell-effect.js 的 scanState 相同（米，床头为负）。
  static double scanFront(double progress) =>
      -SurfaceProjection.halfLength -
      .03 +
      (SurfaceProjection.halfLength * 2 + .06) * progress;

  Path _polygon(List<dynamic> points, Size size) {
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final point = points[i] as List;
      final x = (point[0] as num).toDouble() * size.width;
      final y = (point[1] as num).toDouble() * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path..close();
  }

  void _soft(Canvas canvas, Color color, Rect rect, double strength,
      {bool heating = false}) {
    canvas.save();
    canvas.translate(rect.center.dx, rect.center.dy);
    canvas.scale(rect.width / 2, rect.height / 2);
    canvas.drawCircle(
        Offset.zero,
        1,
        Paint()
          ..shader = RadialGradient(
            colors: [
              color.withOpacity((strength * .75).clamp(0, 1)),
              color.withOpacity((strength * .28).clamp(0, 1)),
              color.withOpacity(0)
            ],
            stops: [0, heating ? .56 : .38, 1],
          ).createShader(const Rect.fromLTWH(-1, -1, 2, 2)));
    canvas.restore();
  }

  Path _quad(SurfaceProjection projection, double scale, double x0, double x1,
          double z0, double z1) =>
      Path()
        ..addPolygon([
          projection.map(x0, z0) * scale,
          projection.map(x1, z0) * scale,
          projection.map(x1, z1) * scale,
          projection.map(x0, z1) * scale,
        ], true);

  /// 一路气囊：极淡内部染色 + 轮廓柔光晕 + 亮边 + 流光，均贴合床面透视。
  /// 尺寸以 1200 宽底图像素计，乘 unit 换算到画布。
  void _paintCircuit(Canvas canvas, _AirGeometry geometry, List<_Bag> bags,
      {required Color tint,
      required double energy,
      required double direction,
      required bool fault,
      required bool animate,
      required double scale,
      required double unit}) {
    final t = backend.clockSeconds;
    final moving = fault ? 0.0 : direction.abs().clamp(0.0, 1.0);
    // 保压时整体缓慢呼吸；调节中保持稳定亮度，由流光表达方向。
    final breathe =
        animate && !fault && moving == 0 ? .5 + .5 * math.sin(t * 2.4) : .5;
    final glow = energy * (fault ? .95 : .82 + .18 * breathe);
    final union = Path();
    for (final bag in bags) {
      for (final cell in bag.cells) {
        union.addPath(geometry.path(cell), Offset.zero);
      }
    }
    // 暖色作大面积半透明填充会在深蓝织物上发灰发棕，所以颜色主要放在轮廓上。
    canvas.drawPath(
        union, Paint()..color = tint.withOpacity((.07 * glow).clamp(0, 1)));
    canvas.drawPath(
        union,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = 6 * unit
          ..color = tint.withOpacity((.32 * glow).clamp(0, 1))
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, 5 * unit));
    canvas.drawPath(
        union,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = 1.4 * unit
          ..color = Color.lerp(tint, Colors.white, .3)!
              .withOpacity((.85 * glow).clamp(0, 1))
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, .6 * unit));
    if (!animate || moving == 0) return;
    final light = Color.lerp(tint, Colors.white, .35)!;
    for (final bag in bags) {
      if (bag.round) {
        // 圆囊：亮度波从靠近气路的圆囊依次传到床边，放气反向。
        for (final cell in bag.cells) {
          final wave = math.pow(
              .5 +
                  .5 *
                      math.cos(
                          2 * math.pi * (t * .8 * direction - cell.order * .9)),
              4);
          canvas.drawPath(
              geometry.path(cell),
              Paint()
                ..color =
                    light.withOpacity((.34 * wave * glow * moving).clamp(0, 1))
                ..maskFilter = MaskFilter.blur(BlurStyle.normal, 2 * unit));
        }
      } else {
        // 条囊：一段柔光沿长度方向从床中线流向床边，放气反向。
        final phase = ((t * .55 * direction) % 1 + 1) % 1,
            center = bag.inner + (bag.outer - bag.inner) * (-.15 + 1.3 * phase),
            half = .075,
            sign = bag.outer > bag.inner ? 1.0 : -1.0;
        canvas.save();
        canvas.clipPath(geometry.path(bag.cells.first));
        canvas.drawPath(
            _quad(
                geometry.projection,
                scale,
                center - half * sign,
                center + half * sign,
                bag.z - bag.depth / 2,
                bag.z + bag.depth / 2),
            Paint()
              ..color = light.withOpacity((.34 * glow * moving).clamp(0, 1))
              ..maskFilter = MaskFilter.blur(BlurStyle.normal, 9 * unit));
        canvas.restore();
      }
    }
  }

  /// 该路的 3D 光效层：按状态着色后加色叠加；充放气时再叠一段流光，只点亮光效本身的形状。
  void _paintGlow(
      Canvas canvas, ui.Image image, Map<dynamic, dynamic> glow, double scale,
      {required Color tint,
      required double strength,
      required double direction,
      required bool animate,
      required String side}) {
    final src =
        Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble());
    final dst = Rect.fromLTWH(
        (glow['x'] as num) * scale,
        (glow['y'] as num) * scale,
        (glow['width'] as num) * scale,
        (glow['height'] as num) * scale);
    // 光效层为白色 + alpha（预乘后即光量），矩阵只缩放 RGB 与 alpha，不依赖平移量的单位约定。
    ColorFilter tinted(double alpha) => ColorFilter.matrix(<double>[
          tint.red / 255, 0, 0, 0, 0, //
          0, tint.green / 255, 0, 0, 0,
          0, 0, tint.blue / 255, 0, 0,
          0, 0, 0, alpha.clamp(0.0, 1.0), 0,
        ]);
    canvas.drawImageRect(
        image,
        src,
        dst,
        Paint()
          ..blendMode = BlendMode.plus
          ..filterQuality = FilterQuality.medium
          ..colorFilter = tinted(strength));
    if (!animate || direction == 0) return;
    final phase = ((backend.clockSeconds * .45 * direction) % 1 + 1) % 1,
        outward = side == 'left' ? 1.0 : -1.0,
        inner = outward > 0 ? dst.left : dst.right,
        center = inner + outward * dst.width * (-.2 + 1.4 * phase),
        half = dst.width * .16;
    canvas.saveLayer(dst, Paint()..blendMode = BlendMode.plus);
    canvas.drawImageRect(
        image,
        src,
        dst,
        Paint()
          ..filterQuality = FilterQuality.medium
          ..colorFilter = tinted(strength * .9));
    canvas.drawRect(
        dst,
        Paint()
          ..blendMode = BlendMode.dstIn
          ..shader = const LinearGradient(colors: [
            Color(0x00ffffff),
            Color(0xffffffff),
            Color(0x00ffffff)
          ]).createShader(Rect.fromLTRB(
              center - half, dst.top, center + half, dst.bottom)));
    canvas.restore();
  }

  void _paintAir(Canvas canvas, Size size, double unit, bool online) {
    final geometry = _AirGeometry.of(metadata, backend.profile);
    if (geometry == null) return;
    final scale = size.width / (metadata['width'] as num).toDouble();
    geometry.resize(size, scale);
    final airState = backend.state['air'] as Map? ?? {};
    final regions = [
      for (final r in backend.profile?['regions'] as List? ?? [])
        if (r is Map) r
    ];
    final glowMeta = <String, Map<dynamic, dynamic>>{
      for (final r in metadata['regions'] as List? ?? [])
        if (r is Map && r['kind'] == 'air' && r['glow'] is Map)
          r['id'] as String: r['glow'] as Map
    };
    bool isActive(String id) {
      if (backend.highlight != null) return backend.highlight!.contains(id);
      final status = (airState[id] as Map?)?['status'];
      return ['inflating', 'deflating', 'adjusting'].contains(status) ||
          backend.motions.containsKey('air:$id');
    }

    // 镜头正对床中线，中线投影为画面正中的竖线；床面上同一 z 的线投影为水平线。
    final center = geometry.projection.map(0, 0).dx * scale;
    final surface = Path()
      ..addPolygon([for (final p in geometry.surface) p * scale], true);
    for (final side in ['left', 'right']) {
      final sideIndex = side == 'left' ? 1 : 0;
      final reveal = (backend.reveals[side] ?? 0).clamp(0.0, 1.0);
      final scanning = backend.motions.containsKey('scan:$side');
      final lit = <_LitCircuit>[];
      for (final region in regions) {
        if ((region['side'] as num?)?.toInt() != sideIndex) continue;
        final id = region['id'] as String;
        final status = (airState[id] as Map?)?['status'] as String?;
        final fault = status == 'fault';
        final active = isActive(id) || fault;
        final trailing = !active && lastAirBySide[side] == id && reveal > 0;
        final focused = backend.focusedRegion == id;
        if (!active && !trailing && !focused) continue;
        final direction = active && !fault
            ? airDirection(status, backend.motions['air:$id'])
            : 0.0;
        // 扫描入场时随扫描淡入；收尾时最后调节的气路随扫描淡出。
        final energy = (online ? 1.0 : .35) *
            (active
                ? (scanning ? reveal : 1.0)
                : trailing
                    ? reveal
                    : .5);
        if (energy <= .001) continue;
        lit.add(_LitCircuit(
            id,
            active ? airTint(status, direction) : AirFxColors.hold,
            energy,
            direction,
            fault,
            backend.dynamicAllowed && active && !fault));
      }
      // 外罩揭开进度：有扫描时跟随扫描；App 自管或静态模式没有扫描时，有光效即直接揭开。
      final open = scanning
          ? reveal
          : (lit.isNotEmpty || backend.focusedSide == side ? 1.0 : reveal);
      final revealImage = layers.reveal(side);
      final baked = <String>{};
      if (revealImage != null && open > 0) {
        // 只换床垫部分：从床头边缘到扫描线（完全揭开时到画面底部，含床尾侧面）。
        final head =
                geometry.projection.map(0, -SurfaceProjection.halfLength).dy *
                        scale -
                    6 * unit,
            front = open >= 1
                ? size.height
                : geometry.projection.map(0, scanFront(open)).dy * scale;
        canvas.save();
        canvas.clipRect(side == 'left'
            ? Rect.fromLTRB(center, head, size.width, front)
            : Rect.fromLTRB(0, head, center, front));
        canvas.drawImageRect(
            revealImage,
            Rect.fromLTWH(0, 0, revealImage.width.toDouble(),
                revealImage.height.toDouble()),
            Offset.zero & size,
            Paint()..filterQuality = FilterQuality.medium);
        for (final item in lit) {
          final image = layers.glow(item.id), glow = glowMeta[item.id];
          if (image == null || glow == null) continue;
          // 保压时在 72%–100% 之间缓慢呼吸；调节中亮度稳定，方向由流光表达。
          final breathe = item.animate && item.direction == 0
              ? .72 + .28 * (.5 + .5 * math.sin(backend.clockSeconds * 2.6))
              : 1.0;
          _paintGlow(canvas, image, glow, scale,
              tint: item.tint,
              strength: item.energy * breathe,
              direction: item.direction,
              animate: item.animate,
              side: side);
          baked.add(item.id);
        }
        canvas.restore();
      }
      final procedural = lit.where((item) => !baked.contains(item.id));
      if (procedural.isNotEmpty) {
        canvas.save();
        canvas.clipPath(surface);
        for (final item in procedural) {
          final bags =
              geometry.bags.where((b) => b.regionId == item.id).toList();
          if (bags.isEmpty) continue;
          _paintCircuit(canvas, geometry, bags,
              tint: item.tint,
              energy: item.energy,
              direction: item.direction,
              fault: item.fault,
              animate: item.animate,
              scale: scale,
              unit: unit);
        }
        canvas.restore();
      }
      // 扫描入场/退场时显示一条横跨该半侧床面的扫描光线，与 3D 外罩上的扫描线对应。
      if (scanning && reveal > 0 && reveal < 1) {
        final x0 = side == 'left' ? 0.0 : -.8, x1 = side == 'left' ? .8 : 0.0;
        final z = scanFront(reveal);
        canvas.save();
        canvas.clipPath(surface);
        canvas.drawPath(
            _quad(geometry.projection, scale, x0, x1, z - .045, z + .01),
            Paint()
              ..color = AirFxColors.scan.withOpacity(.3)
              ..maskFilter = MaskFilter.blur(BlurStyle.normal, 6 * unit));
        canvas.drawPath(
            _quad(geometry.projection, scale, x0, x1, z - .004, z + .004),
            Paint()..color = AirFxColors.scan.withOpacity(.75));
        canvas.restore();
      }
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final online = backend.state['online'] == true;
    final unit = size.width / 1200;
    final sidePolygons = metadata['sidePolygons'] as Map? ?? {};
    _paintAir(canvas, size, unit, online);
    for (final region
        in (metadata['regions'] as List).cast<Map<dynamic, dynamic>>()) {
      final kind = region['kind'] as String;
      if (kind == 'air') continue;
      final id = region['id'] as String;
      final side = region['side'] as String;
      final record = (backend.state[kind] as Map? ?? {})[id] as Map? ?? {};
      final status = record['status'];
      final active = kind == 'heating'
          ? ['heating', 'holding'].contains(status)
          : ['running', 'paused'].contains(status);
      final focused =
          backend.focusedRegion == id || backend.focusedSide == side;
      if (!active && !focused) continue;

      final color =
          kind == 'heating' ? const Color(0xffffa36b) : const Color(0xffc49be8);
      final animate = backend.dynamicAllowed &&
          active &&
          status != 'paused' &&
          status != 'holding';
      final cycle = kind == 'massage'
          ? ((record['cycleSeconds'] as num? ?? 8).toDouble()).clamp(4.0, 30.0)
          : 2.8;
      final wave = animate
          ? .5 + .5 * math.sin(backend.clockSeconds * math.pi * 2 / cycle)
          : .5;
      final intensity = kind == 'massage'
          ? (record['intensity'] as num? ?? 0).toDouble()
          : ((record['level'] as num? ?? 0) /
                  ((backend.profile!['heating'] as List)
                      .cast<Map<dynamic, dynamic>>()
                      .firstWhere((h) => h['id'] == id)['maxLevel'] as num))
              .toDouble();
      final strength = (online ? 1.0 : .3) *
          (.3 + .7 * intensity.clamp(0.0, 1.0)) *
          (active ? 1.0 : .28);

      final sidePoints = sidePolygons[side] as List?;
      if (sidePoints != null) {
        canvas.save();
        canvas.clipPath(_polygon(sidePoints, size));
      }
      final bounds = _polygon(region['polygon'] as List, size).getBounds();
      final oval = Rect.fromCenter(
          center: bounds.center,
          width: bounds.width * (kind == 'heating' ? 1.18 : 1.04),
          height: bounds.height * (kind == 'heating' ? 1.55 : 1.25));
      _soft(canvas, color, oval,
          strength * (kind == 'heating' ? .78 + .1 * wave : .42),
          heating: kind == 'heating');
      if (kind == 'massage' && animate) {
        for (final offset in [0.0, .5]) {
          final progress = (backend.clockSeconds / cycle + offset) % 1;
          final ring = Rect.fromCenter(
              center: bounds.center,
              width: bounds.width * (.35 + .65 * progress),
              height: bounds.height * (.35 + .65 * progress));
          canvas.drawOval(
              ring,
              Paint()
                ..color = color
                    .withOpacity((strength * .48 * (1 - progress)).clamp(0, 1))
                ..style = PaintingStyle.stroke
                ..strokeWidth = math.max(.8, size.width / 1000));
        }
      }
      if (sidePoints != null) canvas.restore();
    }
  }

  @override
  bool shouldRepaint(SoftLightPainter old) => true;
}

/// 供测试核对床面投影与轮廓（底图像素坐标）。
@visibleForTesting
List<List<Offset>> projectedAirOutlines(Map<dynamic, dynamic> metadata,
    Map<String, dynamic> profile, String regionId) {
  final geometry = _AirGeometry.of(metadata, profile);
  if (geometry == null) return const [];
  return [
    for (final bag in geometry.bags.where((b) => b.regionId == regionId))
      for (final cell in bag.cells) List.unmodifiable(cell.outline)
  ];
}
