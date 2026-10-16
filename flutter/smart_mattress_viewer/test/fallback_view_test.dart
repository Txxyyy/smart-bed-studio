import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';
import 'package:smart_mattress_viewer/smart_mattress_viewer.dart';
import 'view_test.dart' show FakePlatform, FakeWeb;

class FallbackPlatform extends FakePlatform {
  int creations = 0;
  bool failConstruction = false;
  bool hangConfigure = false;
  Completer<void>? setupGate;
  late BarrierWeb barrier;
  @override
  PlatformWebViewController createPlatformWebViewController(
      PlatformWebViewControllerCreationParams params) {
    creations++;
    if (failConstruction) throw StateError('simulated unsupported platform');
    return web = barrier = BarrierWeb(params,
        hangConfigure: hangConfigure, setup: setupGate?.future);
  }
}

class BarrierWeb extends FakeWeb {
  final bool hangConfigure;
  final Future<void>? setup;
  final List<Map<String, dynamic>> presentations = [];
  BarrierWeb(super.params, {this.hangConfigure = false, this.setup});
  @override
  Future<void> setJavaScriptMode(JavaScriptMode mode) async {
    await setup;
  }

  @override
  Future<void> loadHtmlString(String html, {String? baseUrl}) async {
    loads++;
    navigation!.started!(baseUrl!);
    send({
      'type': 'event',
      'name': 'bridge.ready',
      'data': {
        'protocolVersion': 1,
        'instanceId': 'page$loads',
        'capabilities': {'presentationBarrier': true},
      }
    });
    navigation!.finished!(baseUrl);
  }

  @override
  Future<void> runJavaScript(String script) async {
    const prefix = 'window.MattressBridge.receive(';
    if (script.startsWith(prefix)) {
      final request =
          jsonDecode(script.substring(prefix.length, script.length - 2))
              as Map<String, dynamic>;
      if (request['method'] == 'bridge.present') {
        calls.add(request);
        presentations.add(request);
        return;
      }
      if (hangConfigure && request['method'] == 'bridge.configure') {
        calls.add(request);
        return;
      }
    }
    await super.runJavaScript(script);
  }

  void completePresentation({int? revision, String? token}) {
    final request = presentations.removeAt(0);
    send({
      'type': 'response',
      'requestId': request['requestId'],
      'ok': true,
      'result': {
        'modelToken': token ?? request['modelToken'],
        'presentationRevision':
            revision ?? request['args'][0]['presentationRevision']
      }
    });
  }
}

Future<void> loadAssets(WidgetTester tester) async {
  await tester.runAsync(() async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
  });
  for (var i = 0; i < 8; i++) {
    await tester.pump();
  }
}

Widget app(MattressController controller, RenderPolicy policy,
        Future<void> Function() ready,
        {Duration budget = const Duration(seconds: 6),
        bool visible = true,
        Future<void> Function(MattressSession)? resync}) =>
    MaterialApp(
        home: MattressView(
            controller: controller,
            renderPolicy: policy,
            visible: visible,
            onResyncRequired: resync,
            fallbackOptions: FallbackOptions(threeDAttemptBudget: budget),
            onReady: ready));

void main() {
  setUp(() {
    rootBundle.clear();
  });
  for (final policy in [RenderPolicy.twoD, RenderPolicy.staticImage]) {
    testWidgets('$policy never constructs WebView and accepts native state',
        (tester) async {
      final platform = FallbackPlatform()..failConstruction = true;
      WebViewPlatform.instance = platform;
      final controller = MattressController();
      MattressSession? session;
      await tester.pumpWidget(app(controller, policy, () async {
        session = await controller.setModel('t12');
        await session!.applySnapshot(MattressState(online: true));
      }));
      await loadAssets(tester);
      expect(session, isNotNull);
      expect(platform.creations, 0);
      await session!.setPose(back: 23);
      expect((await session!.getState())['observed']['pose']['back'], 23);
      expect(
          controller.rendererInfo.activeMode,
          policy == RenderPolicy.twoD
              ? RenderMode.twoD
              : RenderMode.staticImage);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    });
  }
  testWidgets(
      'auto construction failure keeps native session usable and attempts only once',
      (tester) async {
    final platform = FallbackPlatform()..failConstruction = true;
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    MattressSession? session;
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      session = await controller.setModel('t12');
      await session!.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    expect(platform.creations, 1);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(controller.rendererInfo.phase, 'ready');
    await session!.setPose(leg: 12);
    await tester.pump();
    expect((await session!.getState())['observed']['pose']['leg'], 12);
    await tester.pump(const Duration(seconds: 7));
    expect(platform.creations, 1);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'auto requires matching barrier, rebinds once and invalidates old session',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    final sessions = <MattressSession>[];
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      sessions.add(session);
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    expect(sessions.length, 2);
    expect(sessions.first.isCurrent, false);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(platform.barrier.presentations.length, 1);
    await expectLater(
        sessions.first.setPose(back: 30),
        throwsA(isA<MattressException>()
            .having((e) => e.code, 'code', 'STALE_MODEL')));
    platform.barrier.completePresentation();
    await tester.pump();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    expect(sessions.last.isCurrent, true);
    platform.barrier.send({
      'type': 'event',
      'name': 'bridge.ready',
      'instanceId': 'old-page',
      'data': {
        'protocolVersion': 1,
        'instanceId': 'old-page',
        'capabilities': {'presentationBarrier': true}
      }
    });
    await tester.pump();
    expect(sessions.length, 2);
    expect(sessions.last.isCurrent, true);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'late presentation after timeout cannot reclaim the native renderer',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    final sessions = <MattressSession>[];
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      sessions.add(session);
      await session.applySnapshot(MattressState(online: true));
    }, budget: const Duration(seconds: 1)));
    await loadAssets(tester);
    await loadAssets(tester);
    expect(platform.barrier.presentations.length, 1);
    final oldWeb = platform.barrier;
    await tester.pump(const Duration(seconds: 2));
    await loadAssets(tester);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(sessions.length, 3);
    expect(sessions[1].isCurrent, false);
    oldWeb.completePresentation();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    await sessions.last.setPose(back: 7);
    expect((await sessions.last.getState())['observed']['pose']['back'], 7);
    expect(platform.creations, 1);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'wrong state revision is rejected even when model token is current',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    platform.barrier.completePresentation(revision: 999);
    await tester.pump();
    await loadAssets(tester);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(controller.rendererInfo.reasonCode, 'INVALID_PRESENTATION');
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets('wrong model token cannot promote a prepared WebView',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    platform.barrier.completePresentation(token: 'superseded-model');
    await tester.pump();
    await loadAssets(tester);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(controller.rendererInfo.reasonCode, 'INVALID_PRESENTATION');
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets('late setup failure from timed out attempt cannot cancel retry',
      (tester) async {
    final gate = Completer<void>();
    final platform = FallbackPlatform()..setupGate = gate;
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }, budget: const Duration(seconds: 1)));
    await loadAssets(tester);
    expect(platform.creations, 1);
    await tester.pump(const Duration(seconds: 2));
    expect(controller.rendererInfo.reasonCode, 'THREE_D_TIMEOUT');
    platform.setupGate = null;
    await controller.retryThreeD();
    await loadAssets(tester);
    await loadAssets(tester);
    expect(platform.creations, 2);
    expect(platform.barrier.presentations.length, 1);
    gate.completeError(StateError('late first attempt platform failure'));
    await tester.pump();
    platform.barrier.completePresentation();
    await tester.pump();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets('configure transport wait consumes the shared foreground budget',
      (tester) async {
    final platform = FallbackPlatform()..hangConfigure = true;
    WebViewPlatform.instance = platform;
    final controller =
        MattressController(requestTimeout: const Duration(seconds: 10));
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }, budget: const Duration(seconds: 1)));
    await loadAssets(tester);
    await loadAssets(tester);
    await tester.pump(const Duration(seconds: 2));
    await loadAssets(tester);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(controller.rendererInfo.reasonCode, 'THREE_D_TIMEOUT');
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'context restoration resync callback may submit snapshot without reentrant stream errors',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    var resyncs = 0;
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }, resync: (session) async {
      resyncs++;
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    platform.barrier.completePresentation();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    platform.barrier.send({
      'type': 'event',
      'name': 'viewer.error',
      'modelToken': 'm1',
      'data': {'code': 'CONTEXT_LOST', 'message': 'simulated loss'}
    });
    await tester.pump();
    expect(controller.rendererInfo.phase, 'recovering');
    platform.barrier.send({
      'type': 'event',
      'name': 'state.resyncRequired',
      'modelToken': 'm1',
      'data': {}
    });
    await tester.pump();
    await tester.pump();
    expect(resyncs, 1);
    expect(platform.barrier.presentations.length, 1);
    platform.barrier.completePresentation();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'context loss without restoration falls back after recovery budget',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    final sessions = <MattressSession>[];
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      sessions.add(session);
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    platform.barrier.completePresentation();
    await tester.pump();
    platform.barrier.send({
      'type': 'event',
      'name': 'viewer.error',
      'modelToken': 'm1',
      'data': {'code': 'CONTEXT_LOST', 'message': 'simulated loss'}
    });
    await tester.pump(const Duration(seconds: 3));
    await loadAssets(tester);
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(controller.rendererInfo.reasonCode, 'CONTEXT_LOST');
    expect(sessions.length, 3);
    expect(sessions[1].isCurrent, false);
    expect(platform.creations, 1);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'hidden presentation wait cannot exhaust foreground budget through request timeout',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    Future<void> bind() async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }

    await tester.pumpWidget(app(controller, RenderPolicy.auto, bind,
        budget: const Duration(seconds: 1)));
    await loadAssets(tester);
    await loadAssets(tester);
    expect(platform.barrier.presentations.length, 1);
    await tester.pumpWidget(app(controller, RenderPolicy.auto, bind,
        budget: const Duration(seconds: 1), visible: false));
    await tester.pump(const Duration(seconds: 30));
    await loadAssets(tester);
    expect(controller.rendererInfo.phase, 'probing');
    expect(controller.rendererInfo.reasonCode, isNull);
    await tester.pumpWidget(app(controller, RenderPolicy.auto, bind,
        budget: const Duration(seconds: 1)));
    await tester.pump(const Duration(seconds: 2));
    await loadAssets(tester);
    expect(controller.rendererInfo.reasonCode, 'THREE_D_TIMEOUT');
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'hidden initialization pauses transport timeout and resumes foreground deadline',
      (tester) async {
    final platform = FallbackPlatform()..hangConfigure = true;
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    Future<void> bind() async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }

    await tester.pumpWidget(app(controller, RenderPolicy.auto, bind,
        budget: const Duration(seconds: 1)));
    await loadAssets(tester);
    await loadAssets(tester);
    await tester.pumpWidget(app(controller, RenderPolicy.auto, bind,
        budget: const Duration(seconds: 1), visible: false));
    await tester.pump(const Duration(seconds: 30));
    expect(controller.rendererInfo.phase, 'probing');
    expect(controller.rendererInfo.reasonCode, isNull);
    await tester.pumpWidget(app(controller, RenderPolicy.auto, bind,
        budget: const Duration(seconds: 1)));
    await tester.pump(const Duration(seconds: 2));
    await loadAssets(tester);
    expect(controller.rendererInfo.reasonCode, 'THREE_D_TIMEOUT');
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets('legacy construction failure retains a working reload button',
      (tester) async {
    final platform = FallbackPlatform()..failConstruction = true;
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    MattressSession? session;
    await tester.pumpWidget(app(controller, RenderPolicy.threeD, () async {
      session = await controller.setModel('t12');
      await session!.applySnapshot(MattressState(online: true));
    }));
    await tester.pump();
    expect(find.text('重新加载模型'), findsOneWidget);
    platform.failConstruction = false;
    await tester.tap(find.text('重新加载模型'));
    await loadAssets(tester);
    expect(platform.creations, 2);
    expect(session, isNotNull);
    expect(find.text('重新加载模型'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'rejected second view cannot steal or dispose the first view controller',
      (tester) async {
    WebViewPlatform.instance = FallbackPlatform()..failConstruction = true;
    final controller = MattressController();
    MattressSession? session;
    Widget twoViews(bool second) => MaterialApp(
            home: Column(children: [
          Expanded(
              child: MattressView(
                  key: const ValueKey('first'),
                  controller: controller,
                  renderPolicy: RenderPolicy.twoD,
                  onReady: () async {
                    session = await controller.setModel('t12');
                    await session!.applySnapshot(MattressState(online: true));
                  })),
          if (second)
            Expanded(
                child: MattressView(
                    key: const ValueKey('second'),
                    visible: false,
                    controller: controller,
                    renderPolicy: RenderPolicy.twoD,
                    onReady: () async {})),
        ]));
    await tester.pumpWidget(twoViews(false));
    await loadAssets(tester);
    final firstSession = session!;
    await tester.pumpWidget(twoViews(true));
    expect(
        tester.takeException(),
        isA<MattressException>()
            .having((e) => e.code, 'code', 'ALREADY_ATTACHED'));
    await tester.pumpWidget(twoViews(false));
    await tester.pump();
    expect(firstSession.isCurrent, true);
    expect((await controller.getPerformanceStats())['visible'], true);
    await firstSession.setPose(back: 18);
    expect((await firstSession.getState())['observed']['pose']['back'], 18);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets('newly accepted state requires a newer barrier before promotion',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    final firstRevision = platform.barrier.presentations.single['args'][0]
        ['presentationRevision'];
    await controller.currentSession!.setPose(back: 33);
    await tester.pump();
    platform.barrier.completePresentation();
    await tester.pump();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.twoD);
    expect(platform.barrier.presentations.length, 1);
    expect(
        platform.barrier.presentations.single['args'][0]
            ['presentationRevision'],
        greaterThan(firstRevision as int));
    platform.barrier.completePresentation();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  testWidgets(
      'model switch during pending barrier discards old wait without downgrading new session',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }));
    await loadAssets(tester);
    await loadAssets(tester);
    final previous = controller.currentSession!;
    final next = await controller.setModel('t11-plus');
    await next.applySnapshot(MattressState(online: true));
    platform.barrier.completePresentation();
    await tester.pump();
    await tester.pump();
    expect(previous.isCurrent, false);
    expect(next.isCurrent, true);
    expect(controller.rendererInfo.reasonCode, isNull);
    expect(platform.barrier.presentations.length, 1);
    platform.barrier.completePresentation();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
  for (final failure in ['bridge.failed', 'viewer.error']) {
    testWidgets(
        '$failure after ready disposes transport without reentrant stream failure',
        (tester) async {
      final platform = FallbackPlatform();
      WebViewPlatform.instance = platform;
      final controller = MattressController();
      final sessions = <MattressSession>[];
      await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
        final session = await controller.setModel('t12');
        sessions.add(session);
        await session.applySnapshot(MattressState(online: true));
      }));
      await loadAssets(tester);
      await loadAssets(tester);
      platform.barrier.completePresentation();
      await tester.pump();
      expect(controller.rendererInfo.activeMode, RenderMode.threeD);
      final code = failure == 'bridge.failed' ? 'BOOT_FAILED' : 'RENDER_FAILED';
      platform.barrier.send({
        'type': 'event',
        'name': failure,
        'modelToken': 'm1',
        'data': {'code': code, 'message': 'simulated runtime failure'}
      });
      await tester.pump();
      await loadAssets(tester);
      expect(tester.takeException(), isNull);
      expect(controller.rendererInfo.activeMode, RenderMode.twoD);
      expect(controller.rendererInfo.reasonCode, code);
      expect(sessions.length, 3);
      expect(sessions[1].isCurrent, false);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    });
  }
  testWidgets(
      'waiting for App snapshot reports awaitingState without consuming budget',
      (tester) async {
    final platform = FallbackPlatform();
    WebViewPlatform.instance = platform;
    final controller = MattressController();
    final gate = Completer<void>();
    var bindings = 0;
    await tester.pumpWidget(app(controller, RenderPolicy.auto, () async {
      bindings++;
      if (bindings == 2) await gate.future;
      final session = await controller.setModel('t12');
      await session.applySnapshot(MattressState(online: true));
    }, budget: const Duration(seconds: 1)));
    await loadAssets(tester);
    await loadAssets(tester);
    expect(bindings, 2);
    expect(controller.rendererInfo.phase, 'awaitingState');
    await tester.pump(const Duration(seconds: 30));
    expect(controller.rendererInfo.phase, 'awaitingState');
    expect(controller.rendererInfo.reasonCode, isNull);
    gate.complete();
    await tester.pump();
    await tester.pump();
    expect(controller.rendererInfo.phase, 'probing');
    expect(platform.barrier.presentations.length, 1);
    platform.barrier.completePresentation();
    await tester.pump();
    expect(controller.rendererInfo.activeMode, RenderMode.threeD);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
}
