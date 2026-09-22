import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';
import 'package:smart_mattress_viewer/smart_mattress_viewer.dart';

class FakePlatform extends WebViewPlatform {
  late FakeWeb web;
  @override
  PlatformWebViewController createPlatformWebViewController(
          PlatformWebViewControllerCreationParams params) =>
      web = FakeWeb(params);
  @override
  PlatformNavigationDelegate createPlatformNavigationDelegate(
          PlatformNavigationDelegateCreationParams params) =>
      FakeNavigation(params);
  @override
  PlatformWebViewWidget createPlatformWebViewWidget(
          PlatformWebViewWidgetCreationParams params) =>
      FakeWidget(params);
}

class FakeNavigation extends PlatformNavigationDelegate {
  PageEventCallback? started, finished;
  FakeNavigation(super.params) : super.implementation();
  @override
  Future<void> setOnPageStarted(PageEventCallback value) async {
    started = value;
  }

  @override
  Future<void> setOnPageFinished(PageEventCallback value) async {
    finished = value;
  }

  @override
  Future<void> setOnNavigationRequest(NavigationRequestCallback value) async {}
  @override
  Future<void> setOnWebResourceError(WebResourceErrorCallback value) async {}
}

class FakeWidget extends PlatformWebViewWidget {
  FakeWidget(super.params) : super.implementation();
  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

class FakeWeb extends PlatformWebViewController {
  FakeWeb(super.params) : super.implementation();
  FakeNavigation? navigation;
  JavaScriptChannelParams? channel;
  final List<Map<String, dynamic>> calls = [];
  int loads = 0;
  @override
  Future<void> setJavaScriptMode(JavaScriptMode mode) async {}
  @override
  Future<void> setBackgroundColor(Color color) async {}
  @override
  Future<void> addJavaScriptChannel(JavaScriptChannelParams params) async {
    channel = params;
  }

  @override
  Future<void> setPlatformNavigationDelegate(
      PlatformNavigationDelegate handler) async {
    navigation = handler as FakeNavigation;
  }

  void send(Map<String, dynamic> data) =>
      channel!.onMessageReceived(JavaScriptMessage(
          message: jsonEncode(
              {'protocolVersion': 1, 'instanceId': 'page$loads', ...data})));
  @override
  Future<void> loadHtmlString(String html, {String? baseUrl}) async {
    loads++;
    navigation!.started!(baseUrl!);
    send({
      'type': 'event',
      'name': 'bridge.ready',
      'data': {'protocolVersion': 1, 'instanceId': 'page$loads'}
    });
    navigation!.finished!(baseUrl);
  }

  @override
  Future<void> runJavaScript(String script) async {
    if (!script.startsWith('window.MattressBridge.receive(')) return;
    final r = jsonDecode(script.substring(
            'window.MattressBridge.receive('.length, script.length - 2))
        as Map<String, dynamic>;
    calls.add(r);
    final dynamic result = r['method'] == 'setModel'
        ? {
            'id': 'T12',
            'modelToken': 'm$loads',
            'revision': 8,
            'regions': [],
            'heating': [],
            'massage': [],
            'airbagCount': 126
          }
        : null;
    send({
      'type': 'response',
      'requestId': r['requestId'],
      'ok': true,
      'result': result
    });
    if (r['method'] == 'setModel')
      send({
        'type': 'event',
        'name': 'model.presented',
        'modelToken': 'm$loads',
        'data': {}
      });
  }
}

void main() {
  testWidgets(
      'rebuild keeps WebView; hidden resume waits for latest snapshot; unmount invalidates session',
      (tester) async {
    final platform = FakePlatform();
    WebViewPlatform.instance = platform;
    final c = MattressController();
    MattressSession? session;
    Completer<void>? sync;
    Widget app(bool visible) => MaterialApp(
        home: SizedBox(
            width: 400,
            height: 600,
            child: MattressView(
                controller: c,
                visible: visible,
                onReady: () async {
                  session = await c.setModel('T12');
                },
                onResyncRequired: (s) async {
                  await sync!.future;
                  await s.applySnapshot(MattressState(online: true));
                })));
    await tester.pumpWidget(app(true));
    // Asset decoding happens outside fake time.
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pump();
    await tester.pump();
    expect(session, isNotNull);
    expect(platform.web.loads, 1);
    await tester.pumpWidget(app(false));
    await tester.pump();
    expect(platform.web.calls.last['method'], 'setVisible');
    expect(platform.web.calls.last['args'], [false]);
    sync = Completer<void>();
    await tester.pumpWidget(app(true));
    await tester.pump();
    expect(platform.web.calls.last['args'], [false]);
    sync.complete();
    await tester.pump();
    await tester.pump();
    final methods = platform.web.calls.map((r) => r['method']).toList();
    expect(methods.sublist(methods.length - 2),
        ['updateDeviceState', 'setVisible']);
    expect(platform.web.calls.last['args'], [true]);
    expect(platform.web.loads, 1);
    await tester.pumpWidget(const SizedBox());
    expect(session!.isCurrent, false);
    c.dispose();
  });
}
