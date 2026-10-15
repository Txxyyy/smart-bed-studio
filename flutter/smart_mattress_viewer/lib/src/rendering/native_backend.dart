import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import '../state/device_state.dart';
import '../state/native_profile.dart';
import '../types.dart';
import 'renderer_backend.dart';

class NativeBackend extends ChangeNotifier implements RendererBackend {
  static int _instances = 0;
  @override
  final String instanceId =
      'native-${DateTime.now().microsecondsSinceEpoch}-${++_instances}';
  final Map<String, dynamic> catalog;
  final ValueNotifier<int> frames = ValueNotifier<int>(0);
  final Set<String> _activeSides = {};
  final _events = StreamController<MattressEvent>.broadcast(sync: true);
  final Queue<MattressEvent> _eventQueue = Queue<MattressEvent>();
  bool _emitting = false;
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  Stream<MattressEvent> get events => _events.stream;
  NativeDeviceState? store;
  Map<String, dynamic>? profile;
  String? modelToken;
  String? get modelId => profile?['id'] as String?;
  bool get initialized => store?.initialized ?? false;
  bool staticMode;
  bool visible = true,
      suspended = false,
      animationPaused = false,
      reducedMotion = false;
  bool _disposed = false, _disposing = false;
  String animationPolicy = 'auto';
  int _generation = 0, _actions = 0, presentationRevision = 0;
  double clockSeconds = 0;
  Map<String, int> waist = {'left': 4, 'right': 4};
  Map<String, dynamic> rendered = {
    'air': <String, dynamic>{},
    'pose': <String, dynamic>{'back': 0.0, 'leg': 0.0}
  };
  final Map<String, Map<String, dynamic>> motions = {};
  final Map<String, double> reveals = {};
  List<String>? highlight;
  String? focusedSide, focusedRegion;
  bool heatingMoving = true;
  NativeBackend.fromCatalog(Map<String, dynamic> value,
      {this.staticMode = false})
      : catalog = copyMap(value) {
    if (catalog['schemaVersion'] != 1 || catalog['models'] is! List)
      stateError('FALLBACK_ASSET_INVALID', '型号目录格式不兼容');
  }
  static Future<NativeBackend> load(
      {bool staticMode = false, AssetBundle? bundle}) async {
    try {
      final value = jsonDecode(await (bundle ?? rootBundle).loadString(
          'packages/smart_mattress_viewer/assets/models/catalog.json'));
      return NativeBackend.fromCatalog(Map<String, dynamic>.from(value as Map),
          staticMode: staticMode);
    } on MattressException {
      rethrow;
    } catch (e) {
      throw MattressException('FALLBACK_ASSET_INVALID', '无法加载离线型号目录：$e');
    }
  }

  void setStaticMode(bool value) {
    staticMode = value;
    notifyListeners();
  }

  void reportAssetError(String code) =>
      _emit('viewer.error', {'code': code, 'message': '降级展示资源不可用，已保留状态示意'});
  void _emit(String name, Map<String, dynamic> data) {
    if (_disposed) return;
    _eventQueue.add(MattressEvent(
        name,
        {...data, if (modelToken != null) 'modelToken': modelToken},
        modelToken));
    if (_emitting) return;
    _emitting = true;
    try {
      while (_eventQueue.isNotEmpty && !_disposed) {
        _events.add(_eventQueue.removeFirst());
      }
    } finally {
      _emitting = false;
      if (_disposed) _eventQueue.clear();
    }
  }

  Map<String, dynamic> get state => store?.state ?? {};
  bool get dynamicAllowed =>
      !_disposed &&
      !staticMode &&
      !reducedMotion &&
      visible &&
      !suspended &&
      !animationPaused &&
      state['online'] == true;
  bool get needsAnimation =>
      dynamicAllowed &&
      (motions.isNotEmpty ||
          (state['air'] as Map? ?? {}).values.any((r) =>
              ['inflating', 'deflating', 'adjusting'].contains(r['status'])) ||
          heatingMoving &&
              (state['heating'] as Map? ?? {}).values.any((r) =>
                  r['status'] == 'heating' && (r['level'] as num? ?? 0) > 0) ||
          (state['massage'] as Map? ?? {}).values.any((r) =>
              r['status'] == 'running' && (r['intensity'] as num? ?? 0) > 0));
  void advance(double seconds) {
    if (!needsAnimation || seconds <= 0) return;
    clockSeconds += seconds;
    var finished = false;
    for (final entry in motions.entries.toList()) {
      final m = entry.value;
      final value = (m['value'] as num).toDouble(),
          target = (m['target'] as num).toDouble();
      final step = (m['rate'] as num).toDouble() * seconds;
      m['value'] = value +
          (target - value).sign * math.min((target - value).abs(), step);
      if (m['kind'] == 'scan') {
        reveals[m['key']] = m['value'];
      } else {
        rendered[m['kind'] == 'air-motion' ? 'air' : 'pose'][m['key']] =
            m['value'];
      }
      if (m['value'] == target) {
        motions.remove(entry.key);
        finished = true;
        _emit('animation.completed', {'kind': m['kind'], 'actionId': m['id']});
      }
    }
    if (!_disposed) frames.value++;
    if (finished) notifyListeners();
  }

  void _cancel(String key, {String reason = 'cancelled'}) {
    final m = motions.remove(key);
    if (m != null)
      _emit('animation.cancelled',
          {'kind': m['kind'], 'actionId': m['id'], 'reason': reason});
  }

  void _cancelAll(String reason) {
    for (final key in motions.keys.toList()) {
      _cancel(key, reason: reason);
    }
  }

  Map<String, dynamic> _motion(
      String key, String kind, String field, num target, num rate) {
    _cancel(key, reason: 'superseded');
    final id = 'native-action-${++_actions}';
    final num start = kind == 'scan'
        ? reveals[field] ?? 0
        : rendered[kind == 'air-motion' ? 'air' : 'pose'][field] ?? 0;
    final duration = (target - start).abs() / rate * 1000;
    motions[key] = {
      'id': id,
      'kind': kind,
      'key': field,
      'target': target,
      'rate': rate,
      'value': start
    };
    _emit('animation.started', {'kind': kind, 'actionId': id});
    notifyListeners();
    return {
      'actionId': id,
      'durationMs': duration,
      if (staticMode) 'presentation': 'static-target'
    };
  }

  Map<String, dynamic> modelInfo() {
    final p = profile!;
    return copyMap({
      'id': p['id'],
      'name': p['name'],
      'revision': p['revision'],
      'status': p['status'],
      'configurationNote': p['configurationNote'],
      'modelToken': modelToken,
      'input': p['input']['format'],
      'regions': p['regions'],
      'heating': p['heating'],
      'massage': p['massage'] ?? [],
      'airbagCount': (p['airbags'] as List)
          .fold<int>(0, (n, b) => n + (b['cellCount'] as int? ?? 1)),
      'airRowCount': (p['airbags'] as List).length,
      'waistCircuits': p['tidal'] == true ? waist : null,
      'adjustmentGroups': p['tidal'] == true
          ? [..._groups('right'), ..._groups('left')]
          : p['regions'],
      'massageCellCount': (p['massage'] as List? ?? []).fold<int>(
          0,
          (n, c) =>
              n +
              (c['pads'] as List)
                  .fold<int>(0, (m, p) => m + (p['cells'] as List).length))
    });
  }

  List<Map<String, dynamic>> _groups(String side) {
    final w = waist[side]!;
    final groups = {
      'shoulder': [1],
      'back': [
        2,
        ...[3, 4, 5].where((v) => v < w)
      ],
      'lumbar': [w],
      'hip': [
        ...[3, 4, 5].where((v) => v > w),
        6
      ],
      'leg': [7]
    };
    return groups.entries
        .map((e) => {
              'id': '$side.${e.key}',
              'side': side == 'left' ? 1 : 0,
              'range': [0, 100],
              'circuitIds': e.value.map((v) => '$side.circuit$v').toList()
            })
        .toList();
  }

  Map<String, dynamic> _apply(Object? data, Map options) {
    if (options.containsKey('modelToken') &&
        options['modelToken'] != modelToken)
      stateError('STALE_MODEL', '型号会话已失效');
    final result = store!.apply(data, options);
    if (result['ignored'] != true) {
      final snapshot = state;
      for (final entry in (snapshot['air'] as Map).entries) {
        if (entry.value['value'] != null &&
            (!motions.containsKey('air:${entry.key}') ||
                data is Map &&
                    options['normalized'] == true &&
                    (data['air'] as Map? ?? {}).containsKey(entry.key)))
          rendered['air'][entry.key] = entry.value['value'];
      }
      for (final entry in (snapshot['pose'] as Map).entries) {
        if (entry.value != null &&
            (!motions.containsKey('pose:${entry.key}') ||
                data is Map &&
                    options['normalized'] == true &&
                    (data['pose'] as Map? ?? {}).containsKey(entry.key)))
          rendered['pose'][entry.key] = entry.value;
      }
      if (options['normalized'] == true && data is Map) {
        for (final key in (data['air'] as Map? ?? {}).keys) {
          _cancel('air:$key', reason: 'observed-state');
        }
        for (final key in (data['pose'] as Map? ?? {}).keys) {
          _cancel('pose:$key', reason: 'observed-state');
        }
      }
      if (animationPolicy == 'auto') {
        final sides = <String>{};
        for (final r in profile!['regions']) {
          if (['inflating', 'deflating', 'adjusting']
              .contains(state['air'][r['id']]['status']))
            sides.add(r['side'] == 1 ? 'left' : 'right');
        }
        for (final side in ['left', 'right']) {
          if (sides.contains(side) != _activeSides.contains(side)) {
            if (staticMode || reducedMotion) {
              reveals[side] = sides.contains(side) ? 1 : 0;
            } else {
              _motion('scan:$side', 'scan', side, sides.contains(side) ? 1 : 0,
                  1000 / (profile!['presentation']?['scanMs'] ?? 950));
            }
          }
        }
        _activeSides
          ..clear()
          ..addAll(sides);
      }
      presentationRevision++;
      _emit('state.applied', {
        'sequence': store!.sequence,
        'presentationRevision': presentationRevision
      });
      notifyListeners();
    }
    return result;
  }

  @override
  Future<dynamic> request(String method, List<Object?> args,
      {String? modelToken, Duration? timeout}) async {
    if (_disposed) stateError('DISPOSED', '展示已销毁');
    Object? arg(int n) => n < args.length ? args[n] : null;
    Map opts(int n) => arg(n) is Map ? arg(n) as Map : {};
    if (modelToken != null && modelToken != this.modelToken)
      stateError('STALE_MODEL', '型号会话已失效');
    if (method == 'bridge.hello')
      return {'protocolVersion': 1, 'instanceId': instanceId};
    if (method == 'bridge.configure') return {'renderer': 'native'};
    if (method == 'listModels')
      return (catalog['models'] as List)
          .map((p) => {
                'id': p['id'],
                'name': p['name'],
                'revision': p['revision'],
                'status': p['status']
              })
          .toList();
    if (method == 'setModel') {
      final id = (catalog['aliases'] as Map? ?? {})[arg(0)] ?? arg(0);
      final matches = (catalog['models'] as List).where((p) => p['id'] == id);
      if (matches.isEmpty) stateError('MODEL_NOT_FOUND', '未知型号 $id');
      _cancelAll('model-changed');
      profile = copyMap(matches.first as Map);
      store = NativeDeviceState(profile!);
      this.modelToken = '$instanceId-model-${++_generation}';
      waist = {'left': 4, 'right': 4};
      rendered = {
        'air': <String, dynamic>{},
        'pose': <String, dynamic>{'back': 0.0, 'leg': 0.0}
      };
      reveals.clear();
      _activeSides.clear();
      highlight = null;
      focusedSide = null;
      focusedRegion = null;
      presentationRevision = 0;
      _emit('model.ready', modelInfo());
      notifyListeners();
      return modelInfo();
    }
    if (method == 'registerModel') {
      final p = validateNativeProfile(arg(0));
      final aliases = catalog['aliases'] as Map? ?? {};
      if (aliases.containsKey(p['id']) ||
          (catalog['models'] as List).any((m) => m['id'] == p['id']))
        stateError('INVALID_PROFILE', '型号 ID 已存在，不允许覆盖');
      (catalog['models'] as List).add(p);
      return {
        'id': p['id'],
        'name': p['name'],
        'revision': p['revision'],
        'status': p['status']
      };
    }
    if (method == 'getPerformanceStats')
      return {
        'renderMode': staticMode ? 'staticImage' : 'twoD',
        'visible': visible && !suspended,
        'renderCount': frames.value,
        'camera': null,
        'triangles': null,
        'drawCalls': null,
        'maxFps': null
      };
    if (method == 'dispose') {
      dispose();
      return null;
    }
    if (method == 'setVisible') {
      if (arg(0) is! bool) stateError('INVALID_STATE', '可见状态必须为布尔值');
      visible = arg(0) == true;
      notifyListeners();
      return null;
    }
    if (method == 'suspend' || method == 'resume') {
      suspended = method == 'suspend';
      if (method == 'resume' && profile != null)
        _emit('state.resyncRequired', {});
      notifyListeners();
      return null;
    }
    if (method == 'resize') {
      notifyListeners();
      return null;
    }
    if (!(catalog['methods'] as List? ?? []).contains(method) &&
        method != 'bridge.present') stateError('INVALID_METHOD', '不支持的模型接口');
    if (profile == null) stateError('NOT_READY', '请先选择型号');
    try {
      switch (method) {
        case 'getModelInfo':
          return modelInfo();
        case 'getState':
          return copyMap({
            'model': modelInfo(),
            'observed': store!.snapshot(),
            'rendered': rendered,
            'animationPaused': animationPaused,
            'suspended': suspended,
            'presentationRevision': presentationRevision,
            'renderMode': staticMode ? 'staticImage' : 'twoD',
            'motion': {
              'air': motions.values
                  .where((m) => m['kind'] == 'air-motion')
                  .toList(),
              'pose': motions.values
                  .where((m) => m['kind'] == 'pose-motion')
                  .toList()
            },
            'reveal': reveals
          });
        case 'bridge.present':
          return {
            'modelToken': this.modelToken,
            'presentationRevision':
                opts(0)['presentationRevision'] ?? presentationRevision
          };
        case 'updateDeviceState':
          return _apply(arg(0), opts(1));
        case 'setAirState':
          return _apply({
            'air': {arg(0): arg(1)}
          }, {
            ...opts(2),
            'normalized': true
          });
        case 'heating.setState':
          return _apply({
            'heating': {arg(0): arg(1)}
          }, {
            ...opts(2),
            'normalized': true
          });
        case 'massage.setState':
          return _apply({
            'massage': {arg(0): arg(1)}
          }, {
            ...opts(2),
            'normalized': true
          });
        case 'setPose':
          return _apply({'pose': arg(0)}, {...opts(1), 'normalized': true});
        case 'setDataAvailable':
          if (arg(0) is! bool) stateError('INVALID_STATE', '数据可用状态必须为布尔值');
          store!.state['online'] = arg(0);
          presentationRevision++;
          _emit('state.applied', {});
          notifyListeners();
          return null;
        case 'body.setState':
          final groups = modelInfo()['adjustmentGroups'] as List;
          final found = groups.where((g) => g['id'] == arg(0));
          if (found.isEmpty) stateError('UNKNOWN_REGION', '未知人体部位');
          return _apply({
            'air': {
              for (final id in found.first['circuitIds'] ?? [arg(0)]) id: arg(1)
            }
          }, {
            ...opts(2),
            'normalized': true
          });
        case 'tidal.setWaistCircuit':
          if (profile!['tidal'] != true)
            stateError('UNSUPPORTED_TIDAL', '当前型号不支持潮汐腰部');
          if (!['left', 'right'].contains(arg(0)) ||
              ![3, 4, 5].contains(arg(1)))
            stateError('INVALID_TIDAL', '腰部气路必须为 3、4 或 5');
          waist[arg(0) as String] = arg(1) as int;
          presentationRevision++;
          _emit('model.mappingChanged', {'side': arg(0), 'circuit': arg(1)});
          notifyListeners();
          return modelInfo();
        case 'adjustment.begin':
        case 'adjustment.end':
        case 'adjustment.cancel':
          if (arg(0) is! List || (arg(0) as List).isEmpty)
            stateError('UNKNOWN_REGION', '请传入区域 ID 列表');
          return _apply({
            'air': {
              for (final id in arg(0) as List)
                id: {
                  'status': method == 'adjustment.begin' ? 'adjusting' : 'idle'
                }
            }
          }, {
            ...opts(1),
            'normalized': true
          });
        case 'air.moveTo':
          final found =
              (profile!['regions'] as List).where((r) => r['id'] == arg(0));
          final o = opts(1), target = o['target'], rate = o['ratePerSecond'];
          if (found.isEmpty ||
              target is! num ||
              !target.isFinite ||
              rate is! num ||
              !rate.isFinite ||
              rate <= 0 ||
              rate > 1000 ||
              target < found.first['range'][0] ||
              target > found.first['range'][1])
            stateError('INVALID_MOTION', '气囊运动参数无效');
          return _motion(
              'air:${arg(0)}', 'air-motion', arg(0) as String, target, rate);
        case 'pose.moveTo':
          final o = opts(0);
          if (o.isEmpty || o.keys.any((k) => !['back', 'leg'].contains(k)))
            stateError('INVALID_MOTION', '姿态参数无效');
          for (final e in o.entries) {
            final v = e.value;
            if (v is! Map ||
                v['angle'] is! num ||
                !(v['angle'] as num).isFinite ||
                v['angle'] < 0 ||
                v['angle'] > (e.key == 'back' ? 65 : 35) ||
                v['degreesPerSecond'] is! num ||
                !(v['degreesPerSecond'] as num).isFinite ||
                v['degreesPerSecond'] <= 0 ||
                v['degreesPerSecond'] > 30)
              stateError('INVALID_MOTION', '姿态参数无效');
          }
          return {
            for (final e in o.entries)
              e.key: _motion('pose:${e.key}', 'pose-motion', e.key,
                  e.value['angle'], e.value['degreesPerSecond'])
          };
        case 'air.stop':
          _cancel('air:${arg(0)}');
          notifyListeners();
          return null;
        case 'pose.stop':
          for (final p in ['back', 'leg']) {
            if (arg(0) == null || arg(0) == p) _cancel('pose:$p');
          }
          notifyListeners();
          return null;
        case 'animation.pause':
          animationPaused = true;
          notifyListeners();
          return null;
        case 'animation.resume':
          animationPaused = false;
          notifyListeners();
          return null;
        case 'animation.cancel':
          _cancelAll('cancelled');
          reveals.clear();
          highlight = [];
          animationPolicy = 'app';
          notifyListeners();
          return null;
        case 'animation.setPolicy':
          if (!['auto', 'app'].contains(arg(0)))
            stateError('CONTROL_CONFLICT', '编排策略应为 auto 或 app');
          animationPolicy = arg(0) as String;
          if (animationPolicy == 'auto') {
            reveals.clear();
            highlight = null;
          }
          notifyListeners();
          return null;
        case 'camera.focusSide':
        case 'camera.focusRegion':
          if (method == 'camera.focusSide') {
            if (!['left', 'right'].contains(arg(0)))
              stateError('INVALID_CAMERA', '人体侧别无效');
            focusedSide = arg(0) as String;
            focusedRegion = null;
          } else {
            final regions = [...profile!['regions'], ...profile!['heating']];
            if (!regions.any((r) => r['id'] == arg(0)))
              stateError('UNKNOWN_REGION', '未知聚焦区域');
            focusedRegion = arg(0) as String;
            focusedSide = null;
          }
          final id = 'native-highlight-${++_actions}';
          notifyListeners();
          _emit('presentation.completed', {
            'actionId': id,
            'representation': 'highlight',
            'side': focusedSide,
            'regionId': focusedRegion
          });
          return {'actionId': id, 'representation': 'highlight'};
        case 'effects.setHeatingStyle':
          heatingMoving = opts(0)['moving'] != false;
          notifyListeners();
          return null;
        case 'effects.setReveal':
        case 'effects.setSideReveal':
          final o = opts(method == 'effects.setSideReveal' ? 1 : 0),
              side =
                  method == 'effects.setSideReveal' ? arg(0) : opts(0)['side'];
          final progress = o['progress'] ?? 0,
              phase = o['phase'] ??
                  ((o['progress'] ?? 0) > 0 ? 'adjust' : 'closed');
          if (!(method == 'effects.setSideReveal'
                      ? ['left', 'right']
                      : [null, 'left', 'right', 'both'])
                  .contains(side) ||
              progress is! num ||
              !progress.isFinite ||
              progress < 0 ||
              progress > 1 ||
              !['closed', 'scan', 'adjust', 'closing'].contains(phase) ||
              (side == null && phase != 'closed'))
            stateError('INVALID_EFFECT', '扫描参数无效');
          animationPolicy = 'app';
          for (final s in ['left', 'right']) {
            if (side == s || side == 'both' || side == null) {
              _cancel('scan:$s');
              reveals[s] = side == null ? 0 : progress.toDouble();
            }
          }
          notifyListeners();
          return null;
        case 'effects.setHighlight':
          if (arg(0) is! List ||
              (arg(0) as List).any((id) =>
                  !(profile!['regions'] as List).any((r) => r['id'] == id)))
            stateError('UNKNOWN_REGION', '高亮区域无效');
          highlight = (arg(0) as List).cast<String>();
          notifyListeners();
          return null;
        case 'effects.scanIn':
        case 'effects.scanOut':
          final duration = opts(1)['duration'] ?? 950;
          if (!['left', 'right'].contains(arg(0)) ||
              duration is! num ||
              !duration.isFinite ||
              duration < 0 ||
              duration > 5000) stateError('INVALID_EFFECT', '扫描参数无效');
          animationPolicy = 'app';
          if (duration == 0 || staticMode) {
            reveals[arg(0) as String] = method == 'effects.scanIn' ? 1 : 0;
            notifyListeners();
            return {'presentation': 'static'};
          }
          return _motion('scan:${arg(0)}', 'scan', arg(0) as String,
              method == 'effects.scanIn' ? 1 : 0, 1000 / duration);
        default:
          stateError('UNSUPPORTED_RENDERER_FEATURE', '原生二维不支持 $method');
      }
    } on MattressException catch (e) {
      _emit(
          e.code == 'RESYNC_REQUIRED' ? 'state.resyncRequired' : 'viewer.error',
          {'code': e.code, 'message': e.message});
      rethrow;
    }
  }

  @override
  void dispose() {
    if (_disposed || _disposing) return;
    _disposing = true;
    _cancelAll('renderer-changed');
    _disposed = true;
    _eventQueue.clear();
    scheduleMicrotask(() => _events.close());
    frames.dispose();
    super.dispose();
  }
}
