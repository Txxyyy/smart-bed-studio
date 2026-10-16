import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'state/device_state.dart' show copyMap;
import 'state/native_profile.dart';
import 'types.dart';
import 'rendering/renderer_backend.dart';
import 'rendering/webview_backend.dart';
export 'rendering/webview_backend.dart' show JavaScriptRunner;

class MattressController {
  final Duration requestTimeout, loadTimeout;
  final _events = StreamController<MattressEvent>.broadcast(sync: true);
  final Queue<MattressEvent> _eventQueue = Queue<MattressEvent>();
  bool _emitting = false;
  final Map<String, Map<String, dynamic>> _profiles = {};
  final Expando<Map<String, dynamic>> _registered = Expando();
  Future<void> _registrationTail = Future<void>.value();
  int _readyEpoch = 0;
  String? _restoringInstance;
  RendererBackend? _backend, _mirror;
  Object? _viewOwner;
  void claimView(Object owner) {
    if (_disposed) throw const MattressException('DISPOSED', '控制器已销毁');
    if (identical(_viewOwner, owner)) return;
    if (_viewOwner != null || _backend != null)
      throw const MattressException('ALREADY_ATTACHED', '控制器只能绑定一个模型组件');
    _viewOwner = owner;
  }

  void releaseView(Object owner) {
    if (identical(_viewOwner, owner)) _viewOwner = null;
  }

  void _emit(MattressEvent event) {
    if (_disposed) return;
    _eventQueue.add(event);
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

  String _profileKey(Map<dynamic, dynamic> value) {
    dynamic sorted(dynamic v) {
      if (v is Map) {
        final keys = v.keys.map((k) => k.toString()).toList()..sort();
        return {for (final k in keys) k: sorted(v[k])};
      }
      if (v is List) return v.map(sorted).toList();
      return v;
    }

    return jsonEncode(sorted(value));
  }

  Future<dynamic> _registerOn(
      RendererBackend target, Map<String, dynamic> profile) async {
    var tracked = _registered[target];
    if (tracked == null || tracked['instanceId'] != target.instanceId) {
      tracked = {
        'instanceId': target.instanceId,
        'results': <String, dynamic>{}
      };
      _registered[target] = tracked;
    }
    final results = tracked['results'] as Map;
    final id = profile['id'] as String;
    if (results.containsKey(id)) return results[id];
    final result = await target.request('registerModel', [copyMap(profile)],
        timeout: requestTimeout);
    results[id] = result;
    return result;
  }

  Future<void> _restoreProfiles(RendererBackend target) async {
    for (final profile in _profiles.values.toList()) {
      await _registerOn(target, profile);
    }
  }

  String? _mirrorToken, _instanceId;
  StreamSubscription<MattressEvent>? _subscription;
  Future<void> Function()? _reload, _retry;
  Completer<void> _ready = Completer<void>();
  int _generation = 0, presentationRevision = 0;
  bool _disposed = false;
  MattressSession? _session;
  PerformanceMode _performance = PerformanceMode.auto;
  RendererInfo _rendererInfo = const RendererInfo(
      requestedPolicy: RenderPolicy.threeD,
      activeMode: RenderMode.threeD,
      phase: 'loading');
  MattressController(
      {this.requestTimeout = const Duration(seconds: 10),
      this.loadTimeout = const Duration(seconds: 30)}) {
    _ready.future.ignore();
  }
  Stream<MattressEvent> get events => _events.stream;
  Future<void> get ready => _ready.future.timeout(loadTimeout,
      onTimeout: () =>
          throw const MattressException('READY_TIMEOUT', '展示后端未能完成初始化'));
  MattressSession? get currentSession => _session;
  bool get isReady => _instanceId != null && !_disposed;
  RendererInfo get rendererInfo => _rendererInfo;
  RendererBackend? get backend => _backend;

  void attach(JavaScriptRunner runner, {Future<void> Function()? reload}) =>
      attachBackend(WebViewBackend(runner, requestTimeout: requestTimeout),
          reload: reload);
  // View hooks; inactive poster/candidate lifetimes belong to the View.
  void attachBackend(RendererBackend backend,
      {Future<void> Function()? reload, bool replace = false}) {
    if (_disposed) throw const MattressException('DISPOSED', '控制器已销毁');
    if (_backend != null && !replace)
      throw const MattressException('ALREADY_ATTACHED', '控制器只能绑定一个模型组件');
    _subscription?.cancel();
    if (_backend != null)
      _invalidate(const MattressException('RENDERER_CHANGED', '展示后端已切换'));
    else if (_ready.isCompleted) _newReady();
    _backend = backend;
    _reload = reload;
    _subscription = backend.events.listen((event) {
      if (_disposed || !identical(_backend, backend)) return;
      if (event.name == 'bridge.pageStarted') {
        _invalidate(const MattressException('PAGE_RELOADED', '网页已重新加载'));
      } else if (event.name == 'bridge.ready' ||
          event.name == 'renderer.ready') {
        _acceptReady(backend, event);
      } else if (event.name == 'bridge.failed') {
        loadFailed(MattressException(
            event.data['code'] as String? ?? 'BOOT_FAILED',
            event.data['message'] as String? ?? '模型加载失败'));
      } else {
        if (event.modelToken != null &&
            _session != null &&
            event.modelToken != _session!.modelInfo.modelToken) return;
        _emit(event);
      }
    });
    if (backend.instanceId != null)
      _acceptReady(
          backend,
          MattressEvent(
              backend is WebViewBackend ? 'bridge.ready' : 'renderer.ready',
              backend is WebViewBackend
                  ? backend.info
                  : {'instanceId': backend.instanceId},
              null));
  }

  void _acceptReady(RendererBackend backend, MattressEvent event) {
    final instance = backend.instanceId;
    if (instance == null ||
        (_instanceId == instance && _ready.isCompleted) ||
        _restoringInstance == instance) return;
    if (_instanceId != null)
      _invalidate(const MattressException('PAGE_RELOADED', '展示实例已重新创建'));
    if (_profiles.isEmpty) {
      _instanceId = instance;
      if (!_ready.isCompleted) _ready.complete();
      _emit(event);
      return;
    }
    final epoch = _readyEpoch;
    _restoringInstance = instance;
    () async {
      try {
        await _restoreProfiles(backend);
        if (_disposed ||
            !identical(backend, _backend) ||
            epoch != _readyEpoch ||
            instance != backend.instanceId) return;
        _restoringInstance = null;
        _instanceId = instance;
        if (!_ready.isCompleted) _ready.complete();
        _emit(event);
      } catch (error) {
        if (_disposed || !identical(backend, _backend) || epoch != _readyEpoch)
          return;
        _restoringInstance = null;
        loadFailed(error is MattressException
            ? error
            : MattressException('MODEL_REGISTRATION_FAILED', error.toString()));
      }
    }();
  }

  void _newReady() {
    _ready = Completer<void>();
    _ready.future.ignore();
  }

  void _invalidate(MattressException error) {
    _readyEpoch++;
    _restoringInstance = null;
    _generation++;
    _session = null;
    _instanceId = null;
    if (!_ready.isCompleted) _ready.completeError(error);
    _newReady();
  }

  void setStateMirror(RendererBackend? mirror) {
    _mirror = mirror;
    _mirrorToken = null;
  }

  void setRendererInfo(RendererInfo info) {
    _rendererInfo = info;
    scheduleMicrotask(() {
      if (!_disposed && identical(info, _rendererInfo))
        _emit(MattressEvent(
            'renderer.modeChanged',
            {
              'requestedPolicy': info.requestedPolicy.name,
              'activeMode': info.activeMode.name,
              'phase': info.phase,
              'reasonCode': info.reasonCode,
              'attemptId': info.attemptId,
              'capabilities': info.capabilities
            },
            _session?.modelInfo.modelToken));
    });
  }

  void setRetryHandler(Future<void> Function()? handler) {
    _retry = handler;
  }

  Future<void> retryThreeD() async {
    if (_disposed) throw const MattressException('DISPOSED', '控制器已销毁');
    if (_retry == null)
      throw const MattressException('INVALID_POLICY', '仅自动模式支持重试 3D');
    await _retry!();
  }

  void pageStarted() {
    final b = _backend;
    if (b is WebViewBackend) b.pageStarted();
  }

  void receive(String message) {
    final b = _backend;
    if (b is WebViewBackend) b.receive(message);
  }

  Future<void> probe() async {
    final b = _backend;
    if (b is WebViewBackend) await b.probe();
  }

  void loadFailed(MattressException error) {
    if (_disposed) return;
    if (!_ready.isCompleted) _ready.completeError(error);
    _emit(MattressEvent(
        'bridge.failed', {'code': error.code, 'message': error.message}, null));
  }

  static const _stateMethods = {
    'updateDeviceState',
    'setAirState',
    'setPose',
    'setDataAvailable',
    'adjustment.begin',
    'adjustment.end',
    'adjustment.cancel',
    'heating.setState',
    'massage.setState',
    'body.setState',
    'tidal.setWaistCircuit'
  };
  Future<dynamic> _request(String method, List<Object?> args,
      {String? token, Duration? timeout}) async {
    if (_disposed) throw const MattressException('DISPOSED', '控制器已销毁');
    final backend = _backend, generation = _generation;
    if (backend == null)
      throw const MattressException('NOT_ATTACHED', '请先挂载 MattressView');
    if (_instanceId == null)
      throw const MattressException('NOT_READY', '展示尚未就绪');
    if (_stateMethods.contains(method))
      _emit(MattressEvent('state.submitting', {}, token));
    if (method == 'setModel')
      _emit(const MattressEvent('model.loading', {}, null));
    final result = await backend.request(method, args,
        modelToken: token, timeout: timeout ?? requestTimeout);
    if (!identical(backend, _backend) || generation != _generation)
      throw const MattressException('RENDERER_CHANGED', '请求属于已切换的展示会话');
    if (method == 'setModel') {
      presentationRevision = 0;
      if (_mirror != null && !identical(_mirror, backend)) {
        await _restoreProfiles(_mirror!);
        final info = await _mirror!.request('setModel', args);
        _mirrorToken = info['modelToken'] as String;
      } else {
        _mirrorToken = (result as Map)['modelToken'] as String;
      }
    } else if (_stateMethods.contains(method) &&
        !(result is Map && result['ignored'] == true)) {
      if (_mirror != null && !identical(_mirror, backend))
        await _mirror!.request(method, args, modelToken: _mirrorToken);
      if (!identical(backend, _backend) || generation != _generation)
        throw const MattressException('RENDERER_CHANGED', '状态属于已切换的展示会话');
      presentationRevision++;
      _emit(MattressEvent('state.accepted',
          {'presentationRevision': presentationRevision}, token));
    }
    return result;
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

  Future<dynamic> registerModel(Map<String, Object?> profile) {
    final submitted = copyMap(profile);
    final completer = Completer<dynamic>();
    _registrationTail = _registrationTail.then((_) async {
      try {
        await ready;
        final active = _backend!;
        final id = submitted['id'];
        if (id is! String || id.isEmpty)
          throw const MattressException('INVALID_PROFILE', '型号 ID 无效');
        final prior = _profiles[id];
        if (prior != null && _profileKey(prior) != _profileKey(submitted))
          throw const MattressException('INVALID_PROFILE', '同一型号 ID 不允许注册不同配置');
        if (rendererInfo.requestedPolicy != RenderPolicy.threeD ||
            (_mirror != null && !identical(_mirror, active)))
          validateNativeProfile(submitted);
        final result = await _registerOn(active, submitted);
        if (_disposed || !identical(active, _backend))
          throw const MattressException('RENDERER_CHANGED', '注册请求属于旧展示后端');
        // Retain a successfully accepted definition even if a subsequent mirror
        // transport fails, so retries and backend changes remain idempotent.
        _profiles[id] = submitted;
        final mirror = _mirror;
        if (mirror != null && !identical(mirror, active))
          await _registerOn(mirror, submitted);
        if (_disposed || !identical(active, _backend))
          throw const MattressException('RENDERER_CHANGED', '注册请求属于旧展示后端');
        completer.complete(result);
      } catch (error, stack) {
        completer.completeError(error, stack);
      }
    });
    return completer.future;
  }

  Future<dynamic> setVisible(bool visible) async {
    await ready;
    return _request('setVisible', [visible]);
  }

  Future<dynamic> setPerformanceMode(PerformanceMode mode) async {
    _performance = mode;
    await ready;
    if (_backend is! WebViewBackend)
      return {
        'configured': mode.name,
        'applied': false,
        'renderMode': rendererInfo.activeMode.name
      };
    return _request('setPerformanceMode', [mode.name]);
  }

  Future<void> applyPerformancePreference() async {
    if (_backend is WebViewBackend && _performance != PerformanceMode.auto)
      await setPerformanceMode(_performance);
  }

  Future<dynamic> getPerformanceStats() async {
    await ready;
    return _request('getPerformanceStats', []);
  }

  Future<dynamic> present() async {
    final session = _session;
    if (session == null || !session.isCurrent)
      throw const MattressException('MODEL_NOT_READY', '请先提交型号与快照');
    return _request(
        'bridge.present',
        [
          {'presentationRevision': presentationRevision}
        ],
        token: session.modelInfo.modelToken);
  }

  Future<void> reload() async {
    if (_reload == null)
      throw const MattressException('NOT_ATTACHED', '组件尚未挂载');
    await _reload!();
  }

  void detach() {
    final old = _backend;
    if (old == null) return;
    _subscription?.cancel();
    _subscription = null;
    _backend = null;
    _reload = null;
    _mirror = null;
    _mirrorToken = null;
    _invalidate(const MattressException('NOT_ATTACHED', '组件已卸载'));
    if (!_ready.isCompleted)
      _ready.completeError(const MattressException('NOT_ATTACHED', '组件已卸载'));
    old.dispose();
  }

  void dispose() {
    if (_disposed) return;
    detach();
    _disposed = true;
    if (!_ready.isCompleted)
      _ready.completeError(const MattressException('DISPOSED', '控制器已销毁'));
    _eventQueue.clear();
    scheduleMicrotask(() => _events.close());
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
