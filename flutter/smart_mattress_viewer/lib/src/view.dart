import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'controller.dart';
import 'types.dart';

/// The host owns [controller]. Keep it stable across build() calls.
/// Set visible=false for inactive tabs/offscreen PageViews. Route and app
/// visibility are also checked; a resync callback can finish before drawing.
class MattressView extends StatefulWidget {
  final MattressController controller;
  final Future<void> Function() onReady;
  final Future<void> Function(MattressSession session)? onResyncRequired;
  final void Function(MattressException error)? onError;
  final bool visible;
  final bool interactionEnabled;
  final bool followCamera;
  final String background;
  const MattressView(
      {super.key,
      required this.controller,
      required this.onReady,
      this.onResyncRequired,
      this.onError,
      this.visible = true,
      this.interactionEnabled = true,
      this.followCamera = true,
      this.background = '#10191d'});
  @override
  State<MattressView> createState() => _MattressViewState();
}

class _MattressViewState extends State<MattressView>
    with WidgetsBindingObserver {
  late final WebViewController _web;
  StreamSubscription<MattressEvent>? _subscription;
  MattressException? _error;
  bool _loading = true, _appVisible = true, _routeVisible = true;
  bool? _lastVisible;
  int _visibilityGeneration = 0, _pageGeneration = 0;
  bool _gone = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _appVisible = WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _web = WebViewController();
    widget.controller.attach(_web.runJavaScript, reload: _load);
    _subscription = widget.controller.events.listen(_onEvent);
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      await _web.setJavaScriptMode(JavaScriptMode.unrestricted);
      await _web.setBackgroundColor(const Color(0xff10191d));
      await _web.addJavaScriptChannel('MattressHost',
          onMessageReceived: (message) =>
              widget.controller.receive(message.message));
      await _web.setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          widget.controller.pageStarted();
          _lastVisible = null;
          _pageGeneration++;
          _watchReady();
        },
        onPageFinished: (_) async {
          // A failed bootstrap may have run before the channel was available.
          try {
            await _web.runJavaScript(
                'if(window.mattressBootFailure){MattressHost.postMessage(JSON.stringify(window.mattressBootFailure));}');
            if (!widget.controller.isReady) await widget.controller.probe();
          } catch (error) {
            if (!widget.controller.isReady) _showError(error);
          }
        },
        onWebResourceError: (error) {
          if (error.isForMainFrame != false)
            _showError(
                MattressException('WEBVIEW_LOAD_FAILED', error.description));
        },
        onNavigationRequest: (request) => request.url == 'about:blank' ||
                request.url.startsWith('https://mattress.invalid/')
            ? NavigationDecision.navigate
            : NavigationDecision.prevent,
      ));
      await _load();
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _load() async {
    if (_gone) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    final html = await rootBundle
        .loadString('packages/smart_mattress_viewer/assets/mattress.html');
    if (_gone) return;
    await _web.loadHtmlString(html, baseUrl: 'https://mattress.invalid/');
  }

  void _watchReady() {
    final page = _pageGeneration;
    widget.controller.ready.catchError((Object error) {
      if (!_gone && page == _pageGeneration) _showError(error);
    });
  }

  void _onEvent(MattressEvent event) {
    if (_gone) return;
    if (event.name == 'bridge.ready') {
      _startPage();
    } else if (event.name == 'model.presented') {
      setState(() => _loading = false);
    } else if (event.name == 'bridge.failed') {
      _showError(MattressException(
          event.data['code'] as String? ?? 'BOOT_FAILED',
          event.data['message'] as String? ?? '模型加载失败'));
    } else if (event.name == 'state.resyncRequired') {
      final session = widget.controller.currentSession;
      if (session != null) {
        _resync(session).catchError((Object error) {
          _showError(error);
        });
      }
    } else if (event.name == 'viewer.error') {
      widget.onError?.call(MattressException(
          event.data['code'] as String? ?? 'MODEL_ERROR',
          event.data['message'] as String? ?? '模型错误'));
    }
  }

  Future<void> _startPage() async {
    final page = _pageGeneration;
    try {
      await widget.controller.configure(
          background: widget.background,
          interactionEnabled: widget.interactionEnabled,
          followCamera: widget.followCamera);
      if (_gone || page != _pageGeneration) return;
      await _syncVisibility();
      if (!_gone && page == _pageGeneration) await widget.onReady();
    } catch (error) {
      if (!_gone && page == _pageGeneration) _showError(error);
    }
  }

  Future<void> _resync(MattressSession session) async {
    await widget.onResyncRequired?.call(session);
  }

  Future<void> _syncVisibility() async {
    if (_gone || !widget.controller.isReady) return;
    final visible = widget.visible && _appVisible && _routeVisible;
    if (visible == _lastVisible) return;
    final wasVisible = _lastVisible;
    _lastVisible = visible;
    final generation = ++_visibilityGeneration;
    if (visible && wasVisible == false) {
      final session = widget.controller.currentSession;
      if (session != null) await _resync(session);
      if (_gone || generation != _visibilityGeneration) return;
    }
    await widget.controller.setVisible(visible);
  }

  void _updateVisibility() {
    _syncVisibility().catchError((Object error) {
      if (!_gone) _showError(error);
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
    if (oldWidget.controller != widget.controller)
      throw StateError('更换 controller 时请为 MattressView 更换 Key');
    _updateVisibility();
    if (widget.controller.isReady &&
        (oldWidget.background != widget.background ||
            oldWidget.interactionEnabled != widget.interactionEnabled ||
            oldWidget.followCamera != widget.followCamera)) {
      widget.controller
          .configure(
              background: widget.background,
              interactionEnabled: widget.interactionEnabled,
              followCamera: widget.followCamera)
          .catchError((Object error) {
        _showError(error);
        return null;
      });
    }
  }

  void _showError(Object error) {
    if (_gone || !mounted) return;
    final failure = error is MattressException
        ? error
        : MattressException('VIEW_ERROR', error.toString());
    setState(() {
      _error = failure;
      _loading = false;
    });
    widget.onError?.call(failure);
  }

  @override
  void dispose() {
    _gone = true;
    WidgetsBinding.instance.removeObserver(this);
    _subscription?.cancel();
    widget.controller.detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(fit: StackFit.expand, children: [
        WebViewWidget(controller: _web),
        if (_loading)
          const IgnorePointer(
              child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          ColoredBox(
              color: const Color(0xff10191d),
              child: Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                Padding(
                    padding: const EdgeInsets.all(20),
                    child: Text('${_error!.code}\n${_error!.message}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white))),
                TextButton(
                    onPressed: () => _load().catchError((Object error) {
                          _showError(error);
                        }),
                    child: const Text('重新加载模型')),
              ]))),
      ]);
}
