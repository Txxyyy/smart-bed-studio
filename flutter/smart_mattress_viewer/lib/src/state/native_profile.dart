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
  void fail(String message) => stateError('INVALID_PROFILE', message);
  if (p['schemaVersion'] != 1 ||
      !_id(p['id']) ||
      p['name'] is! String ||
      (p['name'] as String).isEmpty ||
      p['revision'] is! int ||
      p['revision'] < 1) fail('型号身份或版本无效');
  if (p['template'] != 'articulated-160x190')
    stateError('UNSUPPORTED_TEMPLATE', '不支持的床垫模板');
  final definitions = <String, Map>{};
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
    for (final row in rows as List) {
      if (row is! Map ||
          !_id(row['id']) ||
          !ids.add(row['id']) ||
          ![0, 1].contains(row['side']) ||
          row['name'] is! String) fail('区域身份无效');
      if (kind == 'air' &&
          (row['range'] is! List ||
              row['range'].length != 2 ||
              !(row['range'] as List).every((v) => v is num && v.isFinite) ||
              row['range'][0] >= row['range'][1])) fail('气路范围无效');
      if (kind == 'heating' && !_finite(row['maxLevel'], 1, 100))
        fail('加热档位无效');
      if (kind == 'massage') {
        if (!['left', 'right'].contains(row['id']) ||
            row['side'] != (row['id'] == 'left' ? 1 : 0) ||
            !_finite(row['defaultIntensity'], 0, 1) ||
            !_finite(row['defaultCycleSeconds'], 4, 30) ||
            row['pads'] is! List ||
            row['pads'].isEmpty ||
            row['pads'].length > 6) fail('按摩通道无效');
        for (final pad in row['pads']) {
          if (pad is! Map ||
              !_id(pad['id']) ||
              pad['cells'] is! List ||
              pad['cells'].isEmpty ||
              pad['cells'].length > 8) fail('按摩单元无效');
        }
      }
      definitions['$kind/${row['id']}'] = row;
    }
    if (kind == 'massage') p['massage'] = rows;
  }
  if (p['airbags'] is! List || p['airbags'].length > 48) fail('气囊配置无效');
  final bags = <String>{}, covered = <String>{};
  for (final bag in p['airbags']) {
    if (bag is! Map ||
        !_id(bag['id']) ||
        !bags.add(bag['id']) ||
        definitions['air/${bag['regionId']}']?['side'] != bag['side'] ||
        !definitions.containsKey('air/${bag['regionId']}')) fail('气囊引用无效');
    if (bag['cellCount'] != null &&
        (bag['cellCount'] is! int ||
            bag['cellCount'] < 1 ||
            bag['cellCount'] > 7)) fail('气囊数量无效');
    covered.add(bag['regionId']);
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
    if (input['fields'] is! List || input['fields'].isEmpty) fail('字段映射为空');
    final destinations = <String>{};
    for (final f in input['fields']) {
      if (f is! Map ||
          f['path'] is! List ||
          f['path'].isEmpty ||
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

void validateNativeAssets(Map p) {
  void fail() => stateError('FALLBACK_ASSET_INVALID', '缺少与型号匹配的本地底图或区域元数据');
  final f = p['fallback'];
  if (f is! Map ||
      f['image'] is! String ||
      !RegExp(r'^(packages/[a-zA-Z0-9_]+/)?assets/').hasMatch(f['image']) ||
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
  if (m['assetRevision'] == 2) {
    final layers = f['layers'];
    if (layers is! Map ||
        ['left', 'right'].any((side) =>
            layers[side] is! String ||
            !RegExp(r'^(packages/[a-zA-Z0-9_]+/)?assets/')
                .hasMatch(layers[side]) ||
            (layers[side] as String).contains('..'))) fail();
  }
  final covered = <String>{};
  for (final r in m['regions']) {
    if (r is! Map ||
        !['air', 'heating', 'massage'].contains(r['kind']) ||
        !['left', 'right'].contains(r['side']) ||
        !_polygon(r['polygon'])) fail();
    final defs = p[r['kind'] == 'air' ? 'regions' : r['kind']] as List? ?? [];
    if (!defs.any((d) =>
        d['id'] == r['id'] && d['side'] == (r['side'] == 'left' ? 1 : 0)))
      fail();
    if (m['assetRevision'] == 2 && r['kind'] == 'air') {
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
    for (final r in p[kind == 'air' ? 'regions' : kind] ?? []) {
      if (!covered.contains('$kind/${r['id']}')) fail();
    }
  }
}
