import 'dart:async';
import 'dart:convert';
import 'types.dart';

typedef JavaScriptRunner = Future<void> Function(String script);

class _Pending {
  final Completer<dynamic> result = Completer<dynamic>();
  late final Timer timer;
  final String? instanceId;
  _Pending(this.instanceId) {
    result.future.ignore();
  }
}

/// One controller belongs to one mounted MattressView. State calls use the
/// immutable session returned by setModel, never a mutable global model token.
class MattressController {
  final Duration requestTimeout;
  final Duration loadTimeout;
  final _events = StreamController<MattressEvent>.broadcast(sync: true);
  final Map<String, _Pending> _pending = {};
  JavaScriptRunner? _runner;
  Future<void> Function()? _reload;
  Completer<void> _ready = Completer<void>();
  String? _instanceId;
  int _counter = 0, _generation = 0;
  bool _disposed = false;
  MattressSession? _session;
  MattressController(
      {this.requestTimeout = const Duration(seconds: 10),
      this.loadTimeout = const Duration(seconds: 30)}) {
    _ready.future.ignore();
  }
  Stream<MattressEvent> get events => _events.stream;
  Future<void> get ready => _ready.future.timeout(loadTimeout,
      onTimeout: () =>
          throw const MattressException('READY_TIMEOUT', '模型未能完成初始化'));
  MattressSession? get currentSession => _session;
  bool get isReady => _instanceId != null && !_disposed;

  // View transport hooks are also used by the deterministic protocol tests.
  void attach(JavaScriptRunner runner, {Future<void> Function()? reload}) {
    if (_disposed) throw const MattressException('DISPOSED', '控制器已销毁');
    if (_runner != null)
      throw const MattressException('ALREADY_ATTACHED', '控制器只能绑定一个模型组件');
    _runner = runner;
    _reload = reload;
  }

  void pageStarted() {
    _generation++;
    _session = null;
    _instanceId = null;
    _rejectPending(const MattressException('PAGE_RELOADED', '网页已重新加载'));
    if (!_ready.isCompleted)
      _ready.completeError(const MattressException('PAGE_RELOADED', '网页已重新加载'));
    _ready = Completer<void>();
    _ready.future.ignore();
  }

  Future<void> probe() async {
    // Readiness is queryable: an early one-shot event is not required.
    final result = await _request('bridge.hello', [], handshake: true);
    _acceptReady(Map<String, dynamic>.from(result as Map));
  }

  void _acceptReady(Map<String, dynamic> info) {
    if (_disposed || _runner == null) return;
    if (info['protocolVersion'] != 1) {
      loadFailed(
          const MattressException('PROTOCOL_MISMATCH', '模型与 Dart 包的协议不兼容'));
      return;
    }
    final id = info['instanceId'];
    if (id is! String || id.isEmpty) return;
    if (_instanceId == id) return;
    if (_instanceId != null) pageStarted();
    _instanceId = id;
    if (!_ready.isCompleted) _ready.complete();
    _events.add(MattressEvent('bridge.ready', info, null));
  }

  void receive(String message) {
    if (_disposed || _runner == null) return;
    try {
      final packet = jsonDecode(message) as Map<String, dynamic>;
      if (packet['type'] == 'response') {
        final pending = _pending[packet['requestId']];
        if (pending == null) return;
        if (pending.instanceId != null &&
            pending.instanceId != packet['instanceId']) return;
        _pending.remove(packet['requestId']);
        pending.timer.cancel();
        if (packet['protocolVersion'] != 1) {
          pending.result.completeError(
              const MattressException('PROTOCOL_MISMATCH', '协议不兼容'));
        } else if (packet['ok'] == true) {
          pending.result.complete(packet['result']);
        } else {
          final error = packet['error'];
          if (error is Map &&
              error['code'] is String &&
              error['message'] is String) {
            pending.result.completeError(MattressException(
                error['code'] as String, error['message'] as String));
          } else {
            pending.result.completeError(
                const MattressException('INVALID_RESPONSE', '桥接返回格式无效'));
          }
        }
        return;
      }
      final name = packet['name'];
      final data = Map<String, dynamic>.from(packet['data'] as Map? ?? {});
      if (name == 'bridge.failed') {
        loadFailed(MattressException(data['code'] as String? ?? 'BOOT_FAILED',
            data['message'] as String? ?? '模型加载失败'));
        return;
      }
      if (name == 'bridge.ready') {
        _acceptReady(data);
        return;
      }
      if (packet['protocolVersion'] != 1 || packet['instanceId'] != _instanceId)
        return;
      _events.add(
          MattressEvent(name as String, data, packet['modelToken'] as String?));
    } catch (error) {
      _events.add(MattressEvent(
          'bridge.invalidMessage', {'message': error.toString()}, null));
    }
  }

  void loadFailed(MattressException error) {
    if (_disposed) return;
    if (!_ready.isCompleted) _ready.completeError(error);
    _rejectPending(error);
    _events.add(MattressEvent(
        'bridge.failed', {'code': error.code, 'message': error.message}, null));
  }

  Future<dynamic> _request(String method, List<Object?> args,
      {String? token, bool handshake = false, Duration? timeout}) async {
    if (_disposed) throw const MattressException('DISPOSED', '控制器已销毁');
    final runner = _runner;
    if (runner == null)
      throw const MattressException('NOT_ATTACHED', '请先挂载 MattressView');
    if (!handshake && _instanceId == null)
      throw const MattressException('NOT_READY', '桥接尚未就绪');
    final id = 'dart-${++_counter}';
    final request = {
      'protocolVersion': 1,
      'requestId': id,
      'instanceId': _instanceId,
      'modelToken': token,
      'method': method,
      'args': args
    };
    // Encode before registering pending work: non-JSON values must fail cleanly.
    final script = 'window.MattressBridge.receive(${jsonEncode(request)});';
    final pending = _Pending(_instanceId);
    _pending[id] = pending;
    pending.timer = Timer(timeout ?? requestTimeout, () {
      if (_pending.remove(id) != null)
        pending.result.completeError(
            const MattressException('REQUEST_TIMEOUT', '未收到调用结果；结果未知，不自动重试动作'));
    });
    try {
      await runner(script);
    } catch (error) {
      if (_pending.remove(id) != null) {
        pending.timer.cancel();
        pending.result.completeError(
            MattressException('TRANSPORT_ERROR', error.toString()));
      }
    }
    return pending.result.future;
  }

  Future<MattressSession> setModel(String id) async {
    final generation = ++_generation;
    _session = null;
    await ready;
    if (generation != _generation)
      throw const MattressException('MODEL_SUPERSEDED', '已被后续型号请求替代');
    final instance = _instanceId!;
    final result = await _request('setModel', [id], timeout: loadTimeout);
    if (generation != _generation || instance != _instanceId)
      throw const MattressException('MODEL_SUPERSEDED', '已被后续型号请求替代');
    return _session = MattressSession._(this, generation, instance,
        MattressModelInfo(Map<String, dynamic>.from(result as Map)));
  }

  Future<dynamic> configure(
      {String background = '#10191d',
      bool interactionEnabled = true,
      bool followCamera = true}) async {
    await ready;
    return _request('bridge.configure', [
      {
        'background': background,
        'interactionEnabled': interactionEnabled,
        'followCamera': followCamera
      }
    ]);
  }

  Future<dynamic> listModels() async {
    await ready;
    return _request('listModels', []);
  }

  Future<dynamic> registerModel(Map<String, Object?> profile) async {
    await ready;
    return _request('registerModel', [profile]);
  }

  Future<dynamic> setVisible(bool visible) async {
    await ready;
    return _request('setVisible', [visible]);
  }

  Future<dynamic> setPerformanceMode(PerformanceMode mode) async {
    await ready;
    return _request('setPerformanceMode', [mode.name]);
  }

  Future<dynamic> getPerformanceStats() async {
    await ready;
    return _request('getPerformanceStats', []);
  }

  Future<void> reload() async {
    if (_reload == null)
      throw const MattressException('NOT_ATTACHED', '组件尚未挂载');
    await _reload!();
  }

  void _rejectPending(MattressException error) {
    for (final item in _pending.values) {
      item.timer.cancel();
      if (!item.result.isCompleted) item.result.completeError(error);
    }
    _pending.clear();
  }

  void detach() {
    if (_runner == null) return;
    // Best effort only: Flutter may tear down the platform view immediately.
    if (_instanceId != null) {
      final script =
          'window.MattressBridge&&window.MattressBridge.receive(${jsonEncode({
            'protocolVersion': 1,
            'requestId': 'dispose-${++_counter}',
            'instanceId': _instanceId,
            'method': 'dispose',
            'args': []
          })});';
      _runner!(script).ignore();
    }
    pageStarted();
    _runner = null;
    _reload = null;
    if (!_ready.isCompleted)
      _ready.completeError(const MattressException('NOT_ATTACHED', '组件已卸载'));
  }

  void dispose() {
    if (_disposed) return;
    detach();
    _disposed = true;
    if (!_ready.isCompleted)
      _ready.completeError(const MattressException('DISPOSED', '控制器已销毁'));
    _events.close();
  }
}

class MattressSession {
  final MattressController _owner;
  final int _generation;
  final String _instance;
  final MattressModelInfo modelInfo;
  MattressSession._(
      this._owner, this._generation, this._instance, this.modelInfo);
  bool get isCurrent =>
      !_owner._disposed &&
      _generation == _owner._generation &&
      _instance == _owner._instanceId;

  /// Escape hatch for the documented SDK whitelist, without JavaScript strings.
  Future<dynamic> invoke(String method, [List<Object?> args = const []]) {
    if (!isCurrent)
      return Future.error(
          const MattressException('STALE_MODEL', '会话已失效，请丢弃旧设备回调'));
    if ([
      'setModel',
      'registerModel',
      'dispose',
      'bridge.hello',
      'bridge.configure'
    ].contains(method))
      return Future.error(
          const MattressException('INVALID_METHOD', '请使用 controller 管理实例和型号'));
    return _owner._request(method, args, token: modelInfo.modelToken);
  }

  Future<dynamic> applySnapshot(MattressState state, {int? sequence}) =>
      invoke('updateDeviceState', [
        state.toJson(),
        {
          'normalized': true,
          'kind': 'snapshot',
          if (sequence != null) 'sequence': sequence
        }
      ]);
  Future<dynamic> applyPatch(MattressState state, {int? sequence}) =>
      invoke('updateDeviceState', [
        state.toJson(),
        {
          'normalized': true,
          'kind': 'patch',
          if (sequence != null) 'sequence': sequence
        }
      ]);
  Future<dynamic> setAirState(
          {required String regionId, num? value, AirStatus? status}) =>
      invoke('setAirState',
          [regionId, AirState(value: value, status: status).toJson()]);
  Future<dynamic> setBodyState(String regionId, AirState state) =>
      invoke('body.setState', [regionId, state.toJson()]);
  Future<dynamic> beginAdjustment(List<String> regions) =>
      invoke('adjustment.begin', [regions]);
  Future<dynamic> endAdjustment(List<String> regions) =>
      invoke('adjustment.end', [regions]);
  Future<dynamic> setWaistCircuit(Side side, int circuit) =>
      invoke('tidal.setWaistCircuit', [side.name, circuit]);
  Future<dynamic> setHeating(
          {required String regionId, int? level, HeatingStatus? status}) =>
      invoke('heating.setState',
          [regionId, HeatingState(level: level, status: status).toJson()]);
  Future<dynamic> setMassage(
          {required Side side,
          MassageStatus? status,
          double? intensity,
          double? cycleSeconds}) =>
      invoke('massage.setState', [
        side.name,
        MassageState(
                status: status,
                intensity: intensity,
                cycleSeconds: cycleSeconds)
            .toJson()
      ]);
  Future<dynamic> setPose({num? back, num? leg}) => invoke('setPose', [
        {if (back != null) 'back': back, if (leg != null) 'leg': leg}
      ]);
  Future<dynamic> movePose({PoseTarget? back, PoseTarget? leg}) =>
      invoke('pose.moveTo', [
        {
          if (back != null) 'back': back.toJson(),
          if (leg != null) 'leg': leg.toJson()
        }
      ]);
  Future<dynamic> moveAir(String regionId,
          {required double target, required double ratePerSecond}) =>
      invoke('air.moveTo', [
        regionId,
        {'target': target, 'ratePerSecond': ratePerSecond}
      ]);
  Future<dynamic> stopAir(String regionId) => invoke('air.stop', [regionId]);
  Future<dynamic> stopPose([String? part]) => invoke('pose.stop', [part]);
  Future<dynamic> focusSide(Side side, {int durationMs = 1000}) =>
      invoke('camera.focusSide', [
        side.name,
        {'duration': durationMs}
      ]);
  Future<dynamic> setCameraPreset(CameraPreset preset) =>
      invoke('camera.setPreset', [preset.name]);
  Future<dynamic> setCameraFollow(bool enabled) =>
      invoke('camera.setFollow', [enabled]);
  Future<dynamic> resetCamera() => invoke('camera.reset');
  Future<dynamic> setDataAvailable(bool available) =>
      invoke('setDataAvailable', [available]);
  Future<dynamic> getState() => invoke('getState');
  Future<MattressModelInfo> getModelInfo() async => MattressModelInfo(
      Map<String, dynamic>.from(await invoke('getModelInfo') as Map));
}
