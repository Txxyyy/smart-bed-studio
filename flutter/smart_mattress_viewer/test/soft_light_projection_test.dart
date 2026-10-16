import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_mattress_viewer/src/presentation/soft_light_painter.dart';

Map<String, dynamic> model(String id) =>
    ((jsonDecode(File('assets/models/catalog.json').readAsStringSync())
            as Map<String, dynamic>)['models'] as List)
        .cast<Map<String, dynamic>>()
        .firstWhere((m) => m['id'] == id);

bool inside(Offset p, List<Offset> polygon) {
  var hit = false;
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    final a = polygon[i], b = polygon[j];
    if ((a.dy > p.dy) != (b.dy > p.dy) &&
        p.dx < (b.dx - a.dx) * (p.dy - a.dy) / (b.dy - a.dy) + a.dx) {
      hit = !hit;
    }
  }
  return hit;
}

void main() {
  for (final id in ['t11-plus', 't12', 'generic']) {
    test('$id air light follows the mattress-top perspective', () {
      final profile = model(id);
      final metadata = (profile['fallback'] as Map)['regions'] as Map;
      final width = (metadata['width'] as num).toDouble(),
          height = (metadata['height'] as num).toDouble();
      final projection = SurfaceProjection.fromMetadata(metadata)!;
      final surface = [
        for (final p in metadata['surface'] as List)
          Offset(((p as List)[0] as num) * width, (p[1] as num) * height)
      ];
      // 床面四角精确落在导出的 surface 上。
      final corners = [
        projection.map(-.8, -.95),
        projection.map(.8, -.95),
        projection.map(.8, .95),
        projection.map(-.8, .95)
      ];
      for (var i = 0; i < 4; i++) {
        expect((corners[i] - surface[i]).distance, lessThan(1e-6));
      }
      for (final region
          in (profile['regions'] as List).cast<Map<dynamic, dynamic>>()) {
        final side = (metadata['sidePolygons']
            as Map)[region['side'] == 1 ? 'left' : 'right'] as List;
        final half = [
          for (final p in side)
            Offset(((p as List)[0] as num) * width, (p[1] as num) * height)
        ];
        final outlines =
            projectedAirOutlines(metadata, profile, region['id'] as String);
        final bags = (profile['airbags'] as List)
            .cast<Map<dynamic, dynamic>>()
            .where((b) => b['regionId'] == region['id']);
        expect(outlines.length,
            bags.fold<int>(0, (n, b) => n + ((b['cellCount'] as int?) ?? 1)));
        // 每个气囊轮廓都在所属半侧的床面内，且是有面积的透视形状。
        for (final outline in outlines) {
          expect(outline.every((p) => inside(p, half)), isTrue,
              reason: '${region['id']} 超出所属半侧');
          final xs = outline.map((p) => p.dx), ys = outline.map((p) => p.dy);
          expect(
              xs.reduce((a, b) => a > b ? a : b) -
                  xs.reduce((a, b) => a < b ? a : b),
              greaterThan(10));
          expect(
              ys.reduce((a, b) => a > b ? a : b) -
                  ys.reduce((a, b) => a < b ? a : b),
              greaterThan(5));
        }
      }
    });
  }

  test('T11+ strip outline narrows toward the head like the mattress', () {
    final profile = model('t11-plus');
    final metadata = (profile['fallback'] as Map)['regions'] as Map;
    double widthOf(String regionId) {
      final outline = projectedAirOutlines(metadata, profile, regionId).first;
      final xs = outline.map((p) => p.dx);
      return xs.reduce((a, b) => a > b ? a : b) -
          xs.reduce((a, b) => a < b ? a : b);
    }

    // 透视下离镜头更远的床头一侧更窄：肩部条囊比臀部条囊窄。
    expect(widthOf('left.shoulder'), lessThan(widthOf('left.hip')));
  });
}
