import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'controller.dart';
import 'types.dart';
import 'rendering/native_backend.dart';
import 'rendering/webview_backend.dart';
import 'rendering/render_coordinator.dart';
import 'presentation/static_mattress_view.dart';

class MattressView extends StatefulWidget {
  final MattressController controller;
  final Future<void> Function() onReady;
  final Future<void> Function(MattressSession session)? onResyncRequired;
  final void Function(MattressException error)? onError;
  final void Function(RendererInfo info)? onRenderModeChanged;
  final RenderPolicy renderPolicy;
  final FallbackOptions fallbackOptions;
  final bool visible, interactionEnabled, followCamera;
  final String background;
  const MattressView(
      {super.key,
      required this.controller,
      required this.onReady,
      this.onResyncRequired,
      this.onError,
      this.onRenderModeChanged,
      this.renderPolicy = RenderPolicy.threeD,
      this.fallbackOptions = const FallbackOptions(),
      this.visible = true,
      this.interactionEnabled = true,
      this.followCamera = true,
      this.background = '#10191d'});
  @override
  State<MattressView> createState() => _MattressViewState();
}

class _MattressViewState extends State<MattressView>
    with WidgetsBindingObserver {
  late final MattressController _controller;
  bool _ownsController = false;
  WebViewController? _web;
  WebViewBackend? _webBackend;
  NativeBackend? _native;
  StreamSubscription<MattressEvent>? _subscription, _candidateSubscription;
  ActiveRenderBudget? _budget;
  MattressException? _error;
  bool _gone = false, _loading = true, _showWeb = false, _attempted = false;
  bool _appVisible = true,
      _routeVisible = true,
      _sized = false,
      _awaitingState = false;
  bool _binding = false,
      _presenting = false,
      _recovering = false,
      _fallingBack = false;
  bool? _lastVisible;
  int _epoch = 0,
      _attempt = 0,
      _bindingGeneration = 0,
      _visibilityGeneration = 0;
  bool get _effectiveVisible =>
      widget.visible && _appVisible && _routeVisible && _sized;
  bool get _auto => widget.renderPolicy == RenderPolicy.auto;
  Color get _background => Color(
      int.tryParse('ff${widget.background.replaceFirst('#', '')}', radix: 16) ??
          0xff10191d);

  @override
  void initState() {
    super.initState();
    _controller = widget.controller;
    _controller.claimView(this);
    _ownsController = true;
    WidgetsBinding.instance.addObserver(this);
    _appVisible = WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _subscription = _controller.events.listen(_onEvent);
    _initialize();
  }

  void _report(Object error) {
    final e = error is MattressException
        ? error
        : MattressException('VIEW_ERROR', error.toString());
    widget.onError?.call(e);
  }

  void _info(RenderMode mode, String phase, [String? reason]) {
    if (_gone) return;
    final info = RendererInfo(
        requestedPolicy: widget.renderPolicy,
        activeMode: mode,
        phase: phase,
        reasonCode: reason,
        attemptId: _attempt);
    _controller.setRendererInfo(info);
    widget.onRenderModeChanged?.call(info);
  }

  void _refresh() {
    if (!_gone && mounted) setState(() {});
  }

  Future<void> _initialize() async {
    _controller.setRetryHandler(_auto ? _retry : null);
    if (widget.renderPolicy == RenderPolicy.threeD) {
      await _startWeb(legacy: true);
    } else {
      await _startNative();
    }
  }

  Future<void> _startNative([String? reason]) async {
    final epoch = _epoch;
    try {
      final next = await NativeBackend.load(
          staticMode: widget.renderPolicy == RenderPolicy.staticImage);
      if (_gone || epoch != _epoch) {
        next.dispose();
        return;
      }
      final previous = _native;
      _native = next;
      _showWeb = false;
      _loading = false;
      _error = null;
      _lastVisible = null;
      _info(next.staticMode ? RenderMode.staticImage : RenderMode.twoD, 'ready',
          reason);
      _controller.setStateMirror(next);
      _controller.attachBackend(next,
          replace: _controller.backend != null, reload: () => _restart());
      if (previous != null && !identical(previous, next)) previous.dispose();
      _refresh();
    } catch (error) {
      if (!_gone && epoch == _epoch) _showError(error);
    }
  }

  Future<void> _retry() async {
    if (!_auto) throw const MattressException('INVALID_POLICY', '仅自动模式支持重试');
    if (_webBackend != null || _showWeb || _fallingBack) return;
    _attempted = false;
    _maybeAttempt();
  }

  void _maybeAttempt() {
    if (_gone ||
        _fallingBack ||
        !_auto ||
        _attempted ||
        !_effectiveVisible ||
        _binding ||
        !(_native?.initialized ?? false)) return;
    _attempted = true;
    _startWeb();
  }

  bool _current(WebViewBackend backend, int epoch) =>
      !_gone && epoch == _epoch && identical(_webBackend, backend);
  Future<void> _startWeb({bool legacy = false}) async {
    final epoch = _epoch;
    final attempt = ++_attempt;
    _awaitingState = false;
    _error = null;
    if (!legacy) {
      _info(RenderMode.twoD, 'probing');
      _budget?.cancel();
      _budget = ActiveRenderBudget(
          widget.fallbackOptions.threeDAttemptBudget,
          () => _fallback(
              const MattressException('THREE_D_TIMEOUT', '3D 未在前台预算内完成加载')));
      _budget!.setActive(_effectiveVisible);
    }
    try {
      // Platform creation can itself throw, before any page callback exists.
      final web = WebViewController();
      final backend = WebViewBackend(web.runJavaScript,
          requestTimeout: _controller.requestTimeout);
      if (_gone || epoch != _epoch) {
        backend.dispose();
        return;
      }
      _web = web;
      _webBackend = backend;
      backend.setTimeoutsActive(!_auto || _effectiveVisible);
      _candidateSubscription = backend.events.listen((event) {
        if (!_current(backend, epoch)) return;
        if (event.name == 'bridge.ready' &&
            !identical(_controller.backend, backend)) {
          final capabilities = backend.info['capabilities'] as Map?;
          if (capabilities?['presentationBarrier'] != true) {
            _fallback(
                const MattressException('PROTOCOL_MISMATCH', '模型资源缺少呈现确认能力'));
            return;
          }
          _lastVisible = null;
          _controller.attachBackend(backend,
              replace: true, reload: () => _reloadWeb(backend, epoch));
        } else if (event.name == 'bridge.failed' &&
            !identical(_controller.backend, backend)) {
          _fallback(MattressException(
              event.data['code'] as String? ?? 'BOOT_FAILED',
              event.data['message'] as String? ?? '模型启动失败'));
        }
      });
      if (legacy) {
        _controller.attachBackend(backend,
            replace: _controller.backend != null,
            reload: () => _reloadWeb(backend, epoch));
        _info(RenderMode.threeD, 'loading');
      }
      _refresh();
      await web.setJavaScriptMode(JavaScriptMode.unrestricted);
      if (!_current(backend, epoch)) return;
      await web.setBackgroundColor(_background);
      await web.addJavaScriptChannel('MattressHost',
          onMessageReceived: (message) {
        if (_current(backend, epoch)) backend.receive(message.message);
      });
      if (!_current(backend, epoch)) return;
      await web.setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (!_current(backend, epoch)) return;
          _lastVisible = null;
          backend.pageStarted();
          if (legacy)
            _controller.ready.catchError((Object error) {
              if (_current(backend, epoch)) _showError(error);
            });
        },
        onPageFinished: (_) async {
          if (!_current(backend, epoch)) return;
          try {
            await web.runJavaScript(
                'if(window.mattressBootFailure){MattressHost.postMessage(JSON.stringify(window.mattressBootFailure));}');
            if (_current(backend, epoch) && backend.instanceId == null)
              await backend.probe();
          } catch (error) {
            if (_current(backend, epoch)) _handleWebFailure(error);
          }
        },
        onWebResourceError: (error) {
          if (_current(backend, epoch) && error.isForMainFrame != false)
            _handleWebFailure(
                MattressException('WEBVIEW_LOAD_FAILED', error.description));
        },
        onNavigationRequest: (request) => request.url == 'about:blank' ||
                request.url.startsWith('https://mattress.invalid/')
            ? NavigationDecision.navigate
            : NavigationDecision.prevent,
      ));
      if (_current(backend, epoch)) await _reloadWeb(backend, epoch);
    } catch (error) {
      if (!_gone && epoch == _epoch && attempt == _attempt)
        _handleWebFailure(error);
    }
  }

  Future<void> _reloadWeb(WebViewBackend backend, int epoch) async {
    if (!_current(backend, epoch)) return;
    final html = await rootBundle
        .loadString('packages/smart_mattress_viewer/assets/mattress.html');
    if (_current(backend, epoch))
      await _web!.loadHtmlString(html, baseUrl: 'https://mattress.invalid/');
  }

  void _onEvent(MattressEvent event) {
    if (_gone) return;
    if (event.name == 'bridge.ready' || event.name == 'renderer.ready') {
      _bind();
    } else if (event.name == 'model.loading' ||
        event.name == 'state.submitting') {
      _awaitingState = false;
      _updateBudget();
    } else if (event.name == 'model.ready') {
      _awaitingState = true;
      _updateBudget();
    } else if (event.name == 'state.accepted') {
      _awaitingState = false;
      _updateBudget();
      if (!_binding) {
        _maybeAttempt();
        _presentWeb();
      }
    } else if (event.name == 'model.presented' && !_auto) {
      _loading = false;
      _showWeb = true;
      _info(RenderMode.threeD, 'ready');
      _refresh();
    } else if (event.name == 'bridge.failed') {
      _handleWebFailure(MattressException(
          event.data['code'] as String? ?? 'BOOT_FAILED',
          event.data['message'] as String? ?? '加载失败'));
    } else if (event.name == 'state.resyncRequired') {
      _resync();
    } else if (event.name == 'viewer.error') {
      final error = MattressException(
          event.data['code'] as String? ?? 'MODEL_ERROR',
          event.data['message'] as String? ?? '模型错误');
      if (_auto && error.code == 'CONTEXT_LOST') {
        _contextLost();
      } else if (_auto &&
          const {
            'RENDER_FAILED',
            'RENDERER_INIT_FAILED',
            'ASSET_LOAD_FAILED',
            'MODEL_LOAD_FAILED'
          }.contains(error.code)) {
        unawaited(_fallback(error));
      } else {
        _report(error);
      }
    }
  }

  Future<void> _bind() async {
    final binding = ++_bindingGeneration,
        epoch = _epoch,
        backend = _controller.backend;
    _binding = true;
    _awaitingState = false;
    _updateBudget();
    try {
      await _controller.configure(
          background: widget.background,
          interactionEnabled: widget.interactionEnabled,
          followCamera: widget.followCamera);
      if (_gone || binding != _bindingGeneration || epoch != _epoch) return;
      await _syncVisibility();
      await _controller.applyPerformancePreference();
      if (_gone || binding != _bindingGeneration || epoch != _epoch) return;
      _awaitingState = true;
      _updateBudget();
      await widget.onReady();
      if (_gone ||
          binding != _bindingGeneration ||
          epoch != _epoch ||
          !identical(backend, _controller.backend)) return;
      _binding = false;
      _awaitingState = _controller.presentationRevision == 0;
      _updateBudget();
      _maybeAttempt();
      await _presentWeb();
    } catch (error) {
      if (_gone || binding != _bindingGeneration || epoch != _epoch) return;
      _binding = false;
      final code = error is MattressException ? error.code : 'APP_BIND_FAILED';
      if (_auto &&
          backend is WebViewBackend &&
          const {
            'REQUEST_TIMEOUT',
            'TRANSPORT_ERROR',
            'RENDERER_INIT_FAILED',
            'ASSET_LOAD_FAILED',
            'MODEL_LOAD_FAILED'
          }.contains(code))
        unawaited(_fallback(error));
      else
        _showError(error);
    }
  }

  Future<void> _presentWeb() async {
    final backend = _webBackend,
        epoch = _epoch,
        session = _controller.currentSession;
    if (!_auto ||
        backend == null ||
        _binding ||
        _presenting ||
        _recovering ||
        _showWeb ||
        !_effectiveVisible ||
        !identical(_controller.backend, backend) ||
        session == null ||
        _controller.presentationRevision == 0) return;
    _presenting = true;
    var repeatPresentation = false;
    try {
      final revision = _controller.presentationRevision;
      final result = await _controller.present();
      if (!_current(backend, epoch)) return;
      if (!session.isCurrent) {
        repeatPresentation = true;
        return;
      }
      if (!_effectiveVisible) return;
      if (result is! Map ||
          result['modelToken'] != session.modelInfo.modelToken ||
          result['presentationRevision'] != revision)
        throw const MattressException('INVALID_PRESENTATION', '首帧提交与当前会话不匹配');
      if (_controller.presentationRevision != revision) {
        repeatPresentation = true;
        return;
      }
      _budget?.cancel();
      _budget = null;
      _recovering = false;
      _showWeb = true;
      _loading = false;
      _error = null;
      _info(RenderMode.threeD, 'ready');
      _refresh();
    } catch (error) {
      if (_current(backend, epoch)) {
        if (session.isCurrent) {
          unawaited(_fallback(error));
        } else {
          repeatPresentation = true;
        }
      }
    } finally {
      if (_current(backend, epoch)) {
        _presenting = false;
        if (repeatPresentation) {
          scheduleMicrotask(() {
            if (_current(backend, epoch)) _presentWeb();
          });
        }
      }
    }
  }

  void _contextLost() {
    if (_recovering) return;
    _recovering = true;
    _showWeb = false;
    _refresh();
    _info(RenderMode.twoD, 'recovering', 'CONTEXT_LOST');
    _budget?.cancel();
    _budget = ActiveRenderBudget(widget.fallbackOptions.contextRestoreBudget,
        () => _fallback(const MattressException('CONTEXT_LOST', '图形上下文未能恢复')));
    _budget!.setActive(_effectiveVisible);
  }

  Future<void> _resync() async {
    final session = _controller.currentSession;
    if (session == null) return;
    try {
      await widget.onResyncRequired?.call(session);
      if (!_gone && session.isCurrent) {
        _recovering = false;
        await _presentWeb();
      }
    } catch (error) {
      if (!_gone && session.isCurrent) _report(error);
    }
  }

  void _handleWebFailure(Object error) {
    if (_auto)
      _fallback(error);
    else
      _showError(error);
  }

  Future<void> _fallback(Object error) async {
    if (_gone || !_auto || _fallingBack) return;
    _fallingBack = true;
    final code =
        error is MattressException ? error.code : 'WEBVIEW_CREATE_FAILED';
    _budget?.cancel();
    _budget = null;
    _recovering = false;
    final failed = _webBackend;
    final needsBinding = identical(_controller.backend, failed);
    unawaited(_candidateSubscription?.cancel());
    _candidateSubscription = null;
    _webBackend = null;
    _web = null;
    _showWeb = false;
    _presenting = false;
    _bindingGeneration++;
    _binding = false;
    _lastVisible = null;
    failed?.dispose();
    _report(error);
    if (needsBinding || _native == null) {
      await _startNative(code);
    } else {
      _loading = false;
      _error = null;
      _info(RenderMode.twoD, 'ready', code);
      _refresh();
    }
    _fallingBack = false;
  }

  void _showError(Object error) {
    if (_gone) return;
    _error = error is MattressException
        ? error
        : MattressException('VIEW_ERROR', error.toString());
    _loading = false;
    _report(_error!);
    _refresh();
  }

  void _updateBudget() {
    if (_auto && _webBackend != null && !_showWeb && !_recovering) {
      final phase = _awaitingState ? 'awaitingState' : 'probing';
      if (_controller.rendererInfo.phase != phase)
        _info(RenderMode.twoD, phase);
    }
    _webBackend?.setTimeoutsActive(!_auto || _effectiveVisible);
    _budget?.setActive(_effectiveVisible && !_awaitingState);
  }

  Future<void> _syncVisibility() async {
    _updateBudget();
    if (!_controller.isReady) return;
    final visible = _effectiveVisible;
    if (_lastVisible == visible) return;
    final previous = _lastVisible;
    _lastVisible = visible;
    final generation = ++_visibilityGeneration;
    if (visible && previous == false) {
      final session = _controller.currentSession;
      if (session != null) await widget.onResyncRequired?.call(session);
      if (_gone || generation != _visibilityGeneration) return;
    }
    await _controller.setVisible(visible);
  }

  void _updateVisibility() {
    if (!_ownsController) return;
    _syncVisibility().then((_) {
      _maybeAttempt();
      _presentWeb();
    }).catchError((Object e) {
      if (!_gone &&
          !(e is MattressException &&
              const {'RENDERER_CHANGED', 'STALE_MODEL', 'NOT_READY'}
                  .contains(e.code))) _report(e);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _routeVisible = ModalRoute.of(context)?.isCurrent ?? true;
    _updateVisibility();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appVisible = state == AppLifecycleState.resumed;
    _updateVisibility();
  }

  @override
  void didUpdateWidget(covariant MattressView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_ownsController) return;
    if (oldWidget.controller != widget.controller)
      throw StateError('更换 controller 时请为 MattressView 更换 Key');
    if (oldWidget.renderPolicy != widget.renderPolicy) {
      _restart();
      return;
    }
    _updateVisibility();
    if (_controller.isReady &&
        (oldWidget.background != widget.background ||
            oldWidget.followCamera != widget.followCamera ||
            oldWidget.interactionEnabled != widget.interactionEnabled)) {
      _controller
          .configure(
              background: widget.background,
              followCamera: widget.followCamera,
              interactionEnabled: widget.interactionEnabled)
          .catchError((Object e) {
        _report(e);
        return null;
      });
    }
  }

  Future<void> _restart() async {
    if (!_ownsController) return;
    _epoch++;
    _bindingGeneration++;
    _visibilityGeneration++;
    _budget?.cancel();
    _budget = null;
    unawaited(_candidateSubscription?.cancel());
    final active = _controller.backend;
    _controller.detach();
    if (!identical(active, _native)) _native?.dispose();
    if (!identical(active, _webBackend)) _webBackend?.dispose();
    _web = null;
    _webBackend = null;
    _native = null;
    _lastVisible = null;
    _binding = false;
    _presenting = false;
    _recovering = false;
    _attempted = false;
    _showWeb = false;
    _loading = true;
    _error = null;
    _refresh();
    await _initialize();
  }

  @override
  void dispose() {
    _gone = true;
    _epoch++;
    _bindingGeneration++;
    WidgetsBinding.instance.removeObserver(this);
    _subscription?.cancel();
    _candidateSubscription?.cancel();
    _budget?.cancel();
    if (!_ownsController) {
      super.dispose();
      return;
    }
    _controller.setRetryHandler(null);
    final active = _controller.backend;
    _controller.detach();
    if (!identical(active, _native)) _native?.dispose();
    if (!identical(active, _webBackend)) _webBackend?.dispose();
    _controller.releaseView(this);
    _ownsController = false;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      LayoutBuilder(builder: (context, constraints) {
        if (!_ownsController) return const SizedBox.shrink();
        final sized = constraints.hasBoundedWidth &&
            constraints.hasBoundedHeight &&
            constraints.maxWidth > 0 &&
            constraints.maxHeight > 0;
        if (sized != _sized) {
          _sized = sized;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!_gone) _updateVisibility();
          });
        }
        return Stack(fit: StackFit.expand, children: [
          ColoredBox(color: _background),
          if (_web != null)
            WebViewWidget(key: ValueKey(_web), controller: _web!),
          if (_native != null && !_showWeb)
            NativeMattressView(
                backend: _native!,
                visible: _effectiveVisible,
                background: _background),
          if (_loading && _native == null)
            const IgnorePointer(
                child: Center(child: CircularProgressIndicator())),
          if (_error != null)
            Align(
                alignment: Alignment.bottomCenter,
                child: Material(
                    color: _background,
                    child: Padding(
                        padding: const EdgeInsets.all(12),
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                          Text('展示暂不可用：${_error!.code}',
                              style: const TextStyle(color: Colors.white)),
                          TextButton(
                              onPressed: () {
                                _restart().catchError((Object error) {
                                  _showError(error);
                                });
                              },
                              child: const Text('重新加载模型')),
                        ])))),
        ]);
      });
}
