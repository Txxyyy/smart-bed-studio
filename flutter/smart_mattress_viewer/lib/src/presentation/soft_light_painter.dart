import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../rendering/native_backend.dart';

// Feather the projected region on the intact cover; no internal reveal.
class SoftLightPainter extends CustomPainter {
  final NativeBackend backend;
  final Map metadata;
  final Map<String, String> lastAirBySide;
  SoftLightPainter(this.backend, this.metadata, this.lastAirBySide)
      : super(repaint: backend.frames);

  Path _polygon(List points, Size size) {
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final x = (points[i][0] as num).toDouble() * size.width;
      final y = (points[i][1] as num).toDouble() * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path..close();
  }

  Path _roundedZone(List points, Size size) {
    final vertices = points
        .map((p) => Offset((p[0] as num).toDouble() * size.width,
            (p[1] as num).toDouble() * size.height))
        .toList();
    final path = Path();
    for (var i = 0; i < 4; i++) {
      final p = vertices[i],
          prev = vertices[(i + 3) % 4],
          next = vertices[(i + 1) % 4];
      Offset approach(Offset q) =>
          p + (q - p) * math.min(9 * size.width / 1200 / (q - p).distance, .2);
      final a = approach(prev), b = approach(next);
      if (i == 0) {
        path.moveTo(a.dx, a.dy);
      } else {
        path.lineTo(a.dx, a.dy);
      }
      path.quadraticBezierTo(p.dx, p.dy, b.dx, b.dy);
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

  @override
  void paint(Canvas canvas, Size size) {
    final online = backend.state['online'] == true;
    final sidePolygons = metadata['sidePolygons'] as Map? ?? {};
    final activeAirCounts = <String, int>{};
    for (final region in metadata['regions'] as List) {
      if (region['kind'] != 'air') continue;
      final id = region['id'] as String, side = region['side'] as String;
      final status =
          ((backend.state['air'] as Map? ?? {})[id] as Map? ?? {})['status'];
      final active = backend.highlight != null
          ? backend.highlight!.contains(id)
          : ['inflating', 'deflating', 'adjusting'].contains(status) ||
              backend.motions.containsKey('air:$id');
      if (active) activeAirCounts[side] = (activeAirCounts[side] ?? 0) + 1;
    }
    for (final region in metadata['regions'] as List) {
      final id = region['id'] as String;
      final kind = region['kind'] as String;
      final side = region['side'] as String;
      final record = (backend.state[kind] as Map? ?? {})[id] as Map? ?? {};
      final status = record['status'];
      var active = kind == 'air'
          ? ['inflating', 'deflating', 'adjusting'].contains(status) ||
              backend.motions.containsKey('air:$id')
          : kind == 'heating'
              ? ['heating', 'holding'].contains(status)
              : ['running', 'paused'].contains(status);
      if (kind == 'air' && backend.highlight != null) {
        active = backend.highlight!.contains(id);
      }
      final trailing = kind == 'air' &&
          !active &&
          lastAirBySide[side] == id &&
          (backend.reveals[side] ?? 0) > 0;
      final focused =
          backend.focusedRegion == id || backend.focusedSide == side;
      if (!active && !trailing && !focused) continue;

      final color = kind == 'air'
          ? const Color(0xff9cefff)
          : kind == 'heating'
              ? const Color(0xffffa36b)
              : const Color(0xffc49be8);
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
          : kind == 'heating'
              ? ((record['level'] as num? ?? 0) /
                      ((backend.profile!['heating'] as List)
                          .firstWhere((h) => h['id'] == id)['maxLevel'] as num))
                  .toDouble()
              : 1.0;
      var strength = (online ? 1.0 : .3) *
          (.3 + .7 * intensity.clamp(0.0, 1.0)) *
          (active
              ? 1.0
              : focused
                  ? .28
                  : .65);
      if (trailing) strength *= (backend.reveals[side] ?? 0).clamp(0.0, 1.0);

      final sidePoints = sidePolygons[side] as List?;
      if (sidePoints != null) {
        canvas.save();
        canvas.clipPath(_polygon(sidePoints, size));
      }
      if (kind == 'air') {
        final source = region['polygon'] as List;
        final cy = ((source[0][1] as num) + (source[2][1] as num)) / 2;
        // Presentation footprint is wider than the physical circuit; IDs stay unchanged.
        final h =
            math.max((source[2][1] as num) - (source[0][1] as num), 66 / 1400);
        final points = List.generate(
            4, (i) => [source[i][0], cy + (i < 2 ? -h / 2 : h / 2)]);
        final bounds = _polygon(points, size).getBounds();
        final crowded = (activeAirCounts[side] ?? 0) > 2;
        final path = _roundedZone(points, size);
        final unit = size.width / 1200;
        final energy = strength * (crowded ? .55 : 1);
        for (final layer in [
          [30.0, .055],
          [18.0, .1],
          [8.0, .25],
          [2.2, .95]
        ]) {
          canvas.drawPath(
              path,
              Paint()
                ..color = const Color(0xff39b9ff).withOpacity(energy * layer[1])
                ..style = PaintingStyle.stroke
                ..strokeJoin = StrokeJoin.round
                ..strokeWidth = layer[0] * unit);
        }
        canvas.drawPath(
            path,
            Paint()
              ..shader = LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  const Color(0xff168bff).withOpacity(energy * .6),
                  const Color(0xff168bff).withOpacity(energy * .4),
                  const Color(0xff39b9ff).withOpacity(energy * .4)
                ],
              ).createShader(bounds));
        canvas.save();
        canvas.clipPath(path);
        final scan = animate ? (backend.clockSeconds / 4.8) % 1 : .5;
        if (animate) {
          final x = bounds.left + bounds.width * (-.18 + 1.36 * scan);
          final band = Rect.fromLTWH(x - bounds.width * .16, bounds.top,
              bounds.width * .32, bounds.height);
          canvas.drawRect(
              band,
              Paint()
                ..shader = LinearGradient(colors: [
                  const Color(0xff66d9ff).withOpacity(0),
                  const Color(0xff66d9ff).withOpacity(energy * .4),
                  const Color(0xff66d9ff).withOpacity(0),
                ]).createShader(band));
        }
        const columns = 28, rows = 5;
        for (var i = 0; i < columns * rows; i++) {
          final column = i % columns, row = i ~/ columns;
          final u = .04 + .92 * (column + (row % 2) * .35) / columns;
          final v = .16 + row * .17;
          final x = bounds.left + bounds.width * u;
          final y = bounds.top + bounds.height * v;
          final pulse = animate
              ? .5 +
                  .5 *
                      math.sin(backend.clockSeconds * math.pi * 2 / 3.6 -
                          column * .06)
              : .5;
          final scanBoost = animate
              ? math.exp(-math.pow((u - (-.18 + 1.36 * scan)) / .12, 2))
              : 0.0;
          final alpha =
              (energy * (.18 + .16 * pulse + .36 * scanBoost)).clamp(0.0, 1.0);
          final radius = 1.8 * unit;
          final center = Offset(x, y);
          _soft(
              canvas,
              color,
              Rect.fromCircle(center: center, radius: radius * 2.6),
              alpha * .4);
          canvas.drawCircle(center, radius,
              Paint()..color = const Color(0xffc7faff).withOpacity(alpha));
        }
        canvas.restore();
      } else {
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
                  ..color = color.withOpacity(
                      (strength * .48 * (1 - progress)).clamp(0, 1))
                  ..style = PaintingStyle.stroke
                  ..strokeWidth = math.max(.8, size.width / 1000));
          }
        }
      }
      if (sidePoints != null) canvas.restore();
    }
  }

  @override
  bool shouldRepaint(SoftLightPainter old) => true;
}
