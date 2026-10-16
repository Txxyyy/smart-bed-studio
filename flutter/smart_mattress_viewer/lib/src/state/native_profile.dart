import 'device_state.dart';

bool _finite(dynamic n, num low, num high) =>
    n is num && n.isFinite && n >= low && n <= high;
bool _id(dynamic id) =>
    id is String &&
    !['constructor', 'prototype', '__proto__'].contains(id) &&
    RegExp(r'^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,79}$').hasMatch(id);
bool _polygon(dynamic value) =>
    value is List &&
    value.length >= 3 &&
    value.length <= 256 &&
    value.every(
        (p) => p is List && p.length == 2 && p.every((n) => _finite(n, 0, 1)));

/// Validates the fields consumed by the native renderer, without trusting an
/// external asset to add regions or change the meaning of a physical channel.
Map<String, dynamic> validateNativeProfile(Object? source) {
  if (source is! Map) stateError('INVALID_PROFILE', '型号必须为对象');
  final p = copyMap(source);
  Never fail(String message) => stateError('INVALID_PROFILE', message);
  if (p['schemaVersion'] != 1 ||
      !_id(p['id']) ||
      p['name'] is! String ||
      (p['name'] as String).isEmpty ||
      p['revision'] is! int ||
      (p['revision'] as int) < 1) fail('型号身份或版本无效');
  if (p['template'] != 'articulated-160x190')
    stateError('UNSUPPORTED_TEMPLATE', '不支持的床垫模板');
  final definitions = <String, Map<dynamic, dynamic>>{};
  for (final kind in ['air', 'heating', 'massage']) {
    final rows =
        p[kind == 'air' ? 'regions' : kind] ?? (kind == 'massage' ? [] : null);
    if (rows is! List ||
        rows.length >
            (kind == 'air'
                ? 32
                : kind == 'heating'
                    ? 16
                    : 2)) fail('区域配置无效');
    final ids = <String>{};
    for (final row in rows) {
      if (row is! Map ||
          !_id(row['id']) ||
          !ids.add(row['id'] as String) ||
          ![0, 1].contains(row['side']) ||
          row['name'] is! String) fail('区域身份无效');
      if (kind == 'air' &&
          (row['range'] is! List ||
              row['range'].length != 2 ||
              !(row['range'] as List).every((v) => v is num && v.isFinite) ||
              (row['range'][0] as num) >= (row['range'][1] as num)))
        fail('气路范围无效');
      if (kind == 'heating' && !_finite(row['maxLevel'], 1, 100))
        fail('加热档位无效');
      if (kind == 'massage') {
        if (!['left', 'right'].contains(row['id']) ||
            row['side'] != (row['id'] == 'left' ? 1 : 0) ||
            !_finite(row['defaultIntensity'], 0, 1) ||
            !_finite(row['defaultCycleSeconds'], 4, 30) ||
            row['pads'] is! List ||
            (row['pads'] as List).isEmpty ||
            (row['pads'] as List).length > 6) fail('按摩通道无效');
        for (final pad in row['pads'] as List) {
          if (pad is! Map ||
              !_id(pad['id']) ||
              pad['cells'] is! List ||
              (pad['cells'] as List).isEmpty ||
              (pad['cells'] as List).length > 8) fail('按摩单元无效');
        }
      }
      definitions['$kind/${row['id']}'] = row;
    }
    if (kind == 'massage') p['massage'] = rows;
  }
  if (p['airbags'] is! List || (p['airbags'] as List).length > 48)
    fail('气囊配置无效');
  final bags = <String>{}, covered = <String>{};
  for (final bag in p['airbags'] as List) {
    if (bag is! Map ||
        !_id(bag['id']) ||
        !bags.add(bag['id'] as String) ||
        definitions['air/${bag['regionId']}']?['side'] != bag['side'] ||
        !definitions.containsKey('air/${bag['regionId']}')) fail('气囊引用无效');
    if (bag['cellCount'] != null &&
        (bag['cellCount'] is! int ||
            (bag['cellCount'] as int) < 1 ||
            (bag['cellCount'] as int) > 7)) fail('气囊数量无效');
    // 二维降级按气囊位置和尺寸把光效投影到床面，与 JS 型号校验的范围一致。
    if (!_finite(bag['x'], -.8, .8) ||
        !_finite(bag['z'], -.95, .95) ||
        !_finite(bag['width'], .01, 1.6) ||
        !_finite(bag['depth'], .01, 1.9)) fail('气囊位置或尺寸无效');
    covered.add(bag['regionId'] as String);
  }
  if ((p['regions'] as List).any((r) => !covered.contains(r['id'])))
    fail('区域未关联气囊');
  if (p['tidal'] == true) {
    for (final side in ['left', 'right']) {
      for (var n = 1; n <= 7; n++) {
        if (definitions['air/$side.circuit$n']?['side'] !=
            (side == 'left' ? 1 : 0)) fail('潮汐配置缺少七路');
      }
    }
  }
  final input = p['input'];
  if (input is! Map || !['canonical-v1', 'mapped-v1'].contains(input['format']))
    fail('上报格式无效');
  if (input['format'] == 'mapped-v1') {
    if (input['fields'] is! List || (input['fields'] as List).isEmpty)
      fail('字段映射为空');
    final destinations = <String>{};
    for (final f in input['fields'] as List) {
      if (f is! Map ||
          f['path'] is! List ||
          (f['path'] as List).isEmpty ||
          !(f['path'] as List).every((k) =>
              k is String &&
              !['__proto__', 'prototype', 'constructor'].contains(k)))
        fail('字段路径无效');
      final kind = f['kind'], field = f['field'];
      if (kind == 'pose'
          ? !['back', 'leg'].contains(field)
          : !definitions.containsKey('$kind/${f['id']}') ||
              !(kind == 'air'
                      ? ['value', 'status']
                      : kind == 'heating'
                          ? ['level', 'status']
                          : [])
                  .contains(field)) fail('映射目标无效');
      if (!destinations.add('$kind/${f['id']}/$field')) fail('映射目标重复');
      for (final key in ['scale', 'offset']) {
        if (f.containsKey(key) && !_finite(f[key], -1000000, 1000000))
          fail('映射换算无效');
      }
      if (f.containsKey('values') && f['values'] is! Map) fail('映射枚举无效');
    }
  }
  if (p['presentation'] != null && p['presentation'] is! Map) fail('视觉时序必须为对象');
  p['presentation'] = {
    'scanMs': 950,
    'flightMs': 1150,
    'coverOpacity': .38,
    ...?p['presentation'] as Map?
  };
  if (!_finite(p['presentation']['scanMs'], 0, 5000)) fail('扫描时序无效');
  validateNativeAssets(p);
  return p;
}

void validateNativeAssets(Map<String, dynamic> p) {
  Never fail() => stateError('FALLBACK_ASSET_INVALID', '缺少与型号匹配的本地底图或区域元数据');
  final f = p['fallback'];
  if (f is! Map ||
      f['image'] is! String ||
      !RegExp(r'^(packages/[a-zA-Z0-9_]+/)?assets/')
          .hasMatch(f['image'] as String) ||
      (f['image'] as String).contains('..')) fail();
  final m = f['regions'];
  if (m is! Map ||
      m['schemaVersion'] != 1 ||
      m['modelId'] != p['id'] ||
      m['modelRevision'] != p['revision'] ||
      m['sideConvention'] != 'supine' ||
      !_finite(m['width'], 1, 8192) ||
      !_finite(m['height'], 1, 8192) ||
      !_polygon(m['surface']) ||
      m['sidePolygons'] is! Map ||
      !_polygon(m['sidePolygons']['left']) ||
      !_polygon(m['sidePolygons']['right']) ||
      m['regions'] is! List) fail();
  final revision = m['assetRevision'];
  final assetRevision = revision is int ? revision : 1;
  if (assetRevision >= 2) {
    final layers = f['layers'];
    if (layers is! Map ||
        ['left', 'right'].any((side) =>
            layers[side] is! String ||
            !RegExp(r'^(packages/[a-zA-Z0-9_]+/)?assets/')
                .hasMatch(layers[side] as String) ||
            (layers[side] as String).contains('..'))) fail();
  }
  final covered = <String>{};
  for (final r in m['regions'] as List) {
    if (r is! Map ||
        !['air', 'heating', 'massage'].contains(r['kind']) ||
        !['left', 'right'].contains(r['side']) ||
        !_polygon(r['polygon'])) fail();
    final defs = p[r['kind'] == 'air' ? 'regions' : r['kind']] as List? ?? [];
    if (!defs.any((d) =>
        d['id'] == r['id'] && d['side'] == (r['side'] == 'left' ? 1 : 0)))
      fail();
    if (assetRevision >= 3 && r['kind'] == 'air') {
      // 每一路气囊的 3D 调节光效层：底图像素矩形，以及随包打包的本地图片。
      final g = r['glow'], path = (f['glow'] as Map?)?[r['id']];
      if (g is! Map ||
          !_finite(g['x'], 0, (m['width'] as num) - 1) ||
          !_finite(g['y'], 0, (m['height'] as num) - 1) ||
          !_finite(g['width'], 1, m['width'] as num) ||
          !_finite(g['height'], 1, m['height'] as num) ||
          path is! String ||
          !RegExp(r'^(packages/[a-zA-Z0-9_]+/)?assets/').hasMatch(path) ||
          path.contains('..')) fail();
    }
    if (assetRevision >= 2 && r['kind'] == 'air') {
      final count = (p['airbags'] as List)
          .where((bag) => bag['regionId'] == r['id'])
          .fold<int>(0, (n, bag) => n + (bag['cellCount'] as int? ?? 1));
      if (r['cells'] is! List ||
          r['cells'].length != count ||
          !(r['cells'] as List).every((cell) =>
              cell is Map &&
              _finite(cell['x'], 0, 1) &&
              _finite(cell['y'], 0, 1) &&
              _finite(cell['rx'], 0.00001, 1) &&
              _finite(cell['ry'], 0.00001, 1))) fail();
    }
    covered.add('${r['kind']}/${r['id']}');
  }
  for (final kind in ['air', 'heating', 'massage']) {
    for (final r in p[kind == 'air' ? 'regions' : kind] as List? ?? []) {
      if (!covered.contains('$kind/${r['id']}')) fail();
    }
  }
}
