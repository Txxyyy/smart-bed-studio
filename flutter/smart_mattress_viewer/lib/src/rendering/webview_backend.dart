import 'dart:async';
import 'dart:convert';
import '../types.dart';
import 'renderer_backend.dart';
import 'render_coordinator.dart';

typedef JavaScriptRunner = Future<void> Function(String script);

class _Pending {
  final result = Completer<dynamic>();
  final String? instance;
  late ActiveRenderBudget timer;
  _Pending(this.instance) {
    result.future.ignore();
  }
}

/// The WebView transport is independent of selection policy and device state.
class WebViewBackend implements RendererBackend {
  final JavaScriptRunner runner;
  final Duration requestTimeout;
  final _events = StreamController<MattressEvent>.broadcast(sync: true);
  final Map<String, _Pending> _pending = {};
  String? _instance;
  final Set<String> _retiredInstances = {};
  int _counter = 0;
  bool _disposed = false;
  bool _timeoutsActive = true;
  Map<String, dynamic> info = {};
  WebViewBackend(this.runner,
      {this.requestTimeout = const Duration(seconds: 10)});
  @override
  String? get instanceId => _instance;
  @override
  Stream<MattressEvent> get events => _events.stream;

  /// Auto selection uses foreground time for transport waits as well as loading.
  /// No request is replayed; responses can still settle while timers are paused.
  void setTimeoutsActive(bool active) {
    if (_disposed || _timeoutsActive == active) return;
    _timeoutsActive = active;
    for (final pending in _pending.values) {
      pending.timer.setActive(active);
    }
  }

  void pageStarted() {
    if (_disposed) return;
    if (_instance != null) _retiredInstances.add(_instance!);
    _instance = null;
    info = {};
    _reject(const MattressException('PAGE_RELOADED', '网页已重新加载'));
    _events.add(const MattressEvent('bridge.pageStarted', {}, null));
  }

  void _ready(Map<String, dynamic> data) {
    if (data['protocolVersion'] != 1) {
      fail(const MattressException('PROTOCOL_MISMATCH', '模型与 Dart 包协议不兼容'));
      return;
    }
    final id = data['instanceId'];
    if (id is! String ||
        id.isEmpty ||
        id == _instance ||
        _retiredInstances.contains(id)) return;
    if (_instance != null) return;
    _instance = id;
    info = data;
    _events.add(MattressEvent('bridge.ready', data, null));
  }

  Future<void> probe() async {
    final result = await request('bridge.hello', []);
    if (!_disposed) _ready(Map<String, dynamic>.from(result as Map));
  }

  void receive(String message) {
    if (_disposed) return;
    try {
      final packet = jsonDecode(message) as Map<String, dynamic>;
      if (packet['type'] == 'response') {
        final pending = _pending[packet['requestId']];
        if (pending == null ||
            pending.instance != null &&
                pending.instance != packet['instanceId']) return;
        _pending.remove(packet['requestId']);
        pending.timer.cancel();
        if (packet['protocolVersion'] != 1) {
          pending.result.completeError(
              const MattressException('PROTOCOL_MISMATCH', '协议不兼容'));
        } else if (packet['ok'] == true) {
          pending.result.complete(packet['result']);
        } else {
          final error = packet['error'];
          pending.result.completeError(error is Map &&
                  error['code'] is String &&
                  error['message'] is String
              ? MattressException(
                  error['code'] as String, error['message'] as String)
              : const MattressException('INVALID_RESPONSE', '桥接返回格式无效'));
        }
        return;
      }
      final name = packet['name'];
      final data = Map<String, dynamic>.from(packet['data'] as Map? ?? {});
      if (name == 'bridge.failed') {
        // The owning View gates even pre-handshake messages by attempt identity.
        if (packet['instanceId'] != null &&
            _instance != null &&
            packet['instanceId'] != _instance) return;
        fail(MattressException(data['code'] as String? ?? 'BOOT_FAILED',
            data['message'] as String? ?? '模型加载失败'));
        return;
      }
      if (name == 'bridge.ready') {
        _ready(data);
        return;
      }
      if (packet['protocolVersion'] != 1 || packet['instanceId'] != _instance)
        return;
      _events.add(
          MattressEvent(name as String, data, packet['modelToken'] as String?));
    } catch (error) {
      _events.add(MattressEvent(
          'bridge.invalidMessage', {'message': error.toString()}, null));
    }
  }

  void fail(MattressException error) {
    if (_disposed) return;
    _reject(error);
    _events.add(MattressEvent(
        'bridge.failed', {'code': error.code, 'message': error.message}, null));
  }

  @override
  Future<dynamic> request(String method, List<Object?> args,
      {String? modelToken, Duration? timeout}) {
    if (_disposed)
      return Future.error(const MattressException('DISPOSED', '后端已销毁'));
    if (method != 'bridge.hello' && _instance == null)
      return Future.error(const MattressException('NOT_READY', '桥接尚未就绪'));
    final id = 'dart-${++_counter}';
    // Encoding must succeed before a pending request is registered.
    final script = 'window.MattressBridge.receive(${jsonEncode({
          'protocolVersion': 1,
          'requestId': id,
          'instanceId': _instance,
          'modelToken': modelToken,
          'method': method,
          'args': args,
        })});';
    final pending = _Pending(_instance);
    _pending[id] = pending;
    pending.timer = ActiveRenderBudget(timeout ?? requestTimeout, () {
      if (_pending.remove(id) != null)
        pending.result.completeError(
            const MattressException('REQUEST_TIMEOUT', '未收到调用结果；结果未知，不自动重试动作'));
    });
    pending.timer.setActive(_timeoutsActive);
    // A hung platform Future must not defeat the independent request timeout.
    Future<void>.sync(() => runner(script)).catchError((Object error) {
      if (_pending.remove(id) != null) {
        pending.timer.cancel();
        pending.result.completeError(
            MattressException('TRANSPORT_ERROR', error.toString()));
      }
    });
    return pending.result.future;
  }

  void _reject(MattressException error) {
    for (final pending in _pending.values) {
      pending.timer.cancel();
      if (!pending.result.isCompleted) pending.result.completeError(error);
    }
    _pending.clear();
  }

  @override
  void dispose() {
    if (_disposed) return;
    if (_instance != null) {
      Future<void>.sync(() => runner(
              'window.MattressBridge&&window.MattressBridge.receive(${jsonEncode({
                'protocolVersion': 1,
                'requestId': 'dispose-${++_counter}',
                'instanceId': _instance,
                'method': 'dispose',
                'args': [],
              })});')).catchError((Object _) {});
    }
    _disposed = true;
    _reject(const MattressException('RENDERER_CHANGED', '展示后端已切换或销毁'));
    // Disposal can originate in a synchronous bridge event listener.
    scheduleMicrotask(() {
      _events.close();
    });
  }
}
