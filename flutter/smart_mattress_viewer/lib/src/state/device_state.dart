import '../types.dart';

Map<String, dynamic> copyMap(Map value) {
  dynamic copy(dynamic item) {
    if (item is Map)
      return item.map((key, value) => MapEntry(key.toString(), copy(value)));
    if (item is List) return item.map(copy).toList();
    return item;
  }

  return Map<String, dynamic>.from(copy(value) as Map);
}

Never stateError(String code, String message) =>
    throw MattressException(code, message);

/// Canonical state reducer. Validation commits once, after every field passes.
class NativeDeviceState {
  final Map<String, dynamic> profile;
  late Map<String, dynamic> state;
  bool initialized = false;
  int? sequence;
  NativeDeviceState(this.profile) {
    state = emptyState();
  }
  Map<String, dynamic> emptyState() => {
        'air': {
          for (final r in profile['regions'])
            r['id']: <String, dynamic>{'value': null, 'status': null}
        },
        'heating': {
          for (final r in profile['heating'])
            r['id']: <String, dynamic>{'level': null, 'status': null}
        },
        'massage': {
          for (final r in profile['massage'] ?? [])
            r['id']: <String, dynamic>{
              'status': null,
              'intensity': null,
              'cycleSeconds': null
            }
        },
        'pose': <String, dynamic>{'back': null, 'leg': null},
        'online': true,
      };
  Map<String, dynamic> snapshot() =>
      copyMap({...state, 'initialized': initialized, 'sequence': sequence});
  Map<String, dynamic> apply(Object? payload, [Map options = const {}]) {
    final kind = options['kind'] ?? (initialized ? 'patch' : 'snapshot');
    if (!['patch', 'snapshot'].contains(kind))
      stateError('INVALID_STATE', '更新类型无效');
    if (kind == 'patch' && !initialized)
      stateError('SNAPSHOT_REQUIRED', '请先提交完整状态');
    final seq = options['sequence'];
    if (options.containsKey('sequence')) {
      if (seq is! int || seq < 0 || seq > 9007199254740991)
        stateError('INVALID_STATE', '序号必须为非负整数');
      if (sequence != null && seq <= sequence!)
        return {'ignored': true, 'reason': 'stale'};
      if (kind == 'patch' && sequence != null && seq != sequence! + 1)
        stateError('RESYNC_REQUIRED', '增量序号断开，请提交完整状态');
    }
    if (payload is! Map) stateError('INVALID_STATE', '状态必须为对象');
    var data = copyMap(payload);
    if (options['normalized'] != true &&
        profile['input']['format'] == 'mapped-v1') {
      final mapped = <String, dynamic>{};
      var matches = 0;
      for (final field in profile['input']['fields']) {
        dynamic value = data;
        var found = true;
        for (final key in field['path']) {
          if (value is Map && value.containsKey(key)) {
            value = value[key];
          } else if (value is List &&
              key is int &&
              key >= 0 &&
              key < value.length) {
            value = value[key];
          } else {
            found = false;
            break;
          }
        }
        if (!found) continue;
        matches++;
        if (value != null) {
          if (field['values'] != null) {
            if (!(field['values'] as Map).containsKey('$value'))
              stateError('INVALID_STATE', '未定义的上报枚举值');
            value = field['values']['$value'];
          }
          if (field.containsKey('scale') || field.containsKey('offset')) {
            if (value is! num || !value.isFinite)
              stateError('INVALID_STATE', '映射换算要求数字');
            value = value * (field['scale'] ?? 1) + (field['offset'] ?? 0);
          }
        }
        final section =
            mapped.putIfAbsent(field['kind'], () => <String, dynamic>{}) as Map;
        if (field['kind'] == 'pose') {
          section[field['field']] = value;
        } else {
          (section.putIfAbsent(field['id'], () => <String, dynamic>{})
              as Map)[field['field']] = value;
        }
      }
      if (matches == 0) stateError('NO_MAPPED_FIELDS', '消息中没有当前型号可识别的字段');
      data = mapped;
    }
    if (data.isEmpty ||
        data.keys.any((k) =>
            !['air', 'heating', 'massage', 'pose', 'online'].contains(k)))
      stateError('INVALID_STATE', '未知或空状态更新');
    final next = kind == 'snapshot' ? emptyState() : copyMap(state);
    for (final kind in ['air', 'heating', 'massage']) {
      if (!data.containsKey(kind)) continue;
      final records = data[kind];
      if (records is! Map) stateError('INVALID_STATE', '$kind 必须为对象');
      for (final entry in records.entries) {
        final id = entry.key;
        final definitions =
            profile[kind == 'air' ? 'regions' : kind] as List? ?? [];
        final matches = definitions.where((r) => r['id'] == id);
        if (matches.isEmpty)
          stateError(
              kind == 'massage' ? 'UNSUPPORTED_MASSAGE' : 'UNKNOWN_REGION',
              '未知区域 $id');
        final def = matches.first;
        final record = entry.value;
        if (record is! Map || (kind == 'massage' && record.isEmpty))
          stateError('INVALID_STATE', '区域状态必须为对象');
        for (final field in record.entries) {
          final key = field.key, value = field.value;
          if (key == 'status') {
            final statuses = kind == 'air'
                ? ['idle', 'inflating', 'deflating', 'adjusting', 'fault']
                : kind == 'heating'
                    ? ['off', 'heating', 'holding', 'fault']
                    : ['off', 'running', 'paused', 'fault'];
            if (value != null && !statuses.contains(value))
              stateError('INVALID_STATE', '工作状态无效');
          } else {
            num low = 0, high;
            if (kind == 'air' && key == 'value') {
              low = def['range'][0];
              high = def['range'][1];
            } else if (kind == 'heating' && key == 'level') {
              high = def['maxLevel'];
            } else if (kind == 'massage' && key == 'intensity') {
              high = 1;
            } else if (kind == 'massage' && key == 'cycleSeconds') {
              low = 4;
              high = 30;
            } else {
              stateError('INVALID_STATE', '未知区域字段 $key');
            }
            if (value != null &&
                (value is! num ||
                    !value.isFinite ||
                    value < low ||
                    value > high)) stateError('INVALID_STATE', '$id 数值超出范围');
          }
          next[kind][id][key] = value;
        }
      }
    }
    if (data.containsKey('pose')) {
      if (data['pose'] is! Map) stateError('INVALID_STATE', '姿态必须为对象');
      for (final entry in (data['pose'] as Map).entries) {
        final v = entry.value;
        if (!['back', 'leg'].contains(entry.key) ||
            (v != null &&
                (v is! num ||
                    !v.isFinite ||
                    v < 0 ||
                    v > (entry.key == 'back' ? 65 : 35))))
          stateError('INVALID_STATE', '姿态角度无效');
        next['pose'][entry.key] = v;
      }
    }
    if (data.containsKey('online')) {
      if (data['online'] is! bool) stateError('INVALID_STATE', 'online 必须为布尔值');
      next['online'] = data['online'];
    }
    state = next;
    initialized = true;
    if (options.containsKey('sequence')) sequence = seq as int;
    return {'ignored': false, 'state': snapshot()};
  }
}
