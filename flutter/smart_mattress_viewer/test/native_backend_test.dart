import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_mattress_viewer/src/rendering/native_backend.dart';
import 'package:smart_mattress_viewer/src/presentation/static_mattress_view.dart';
import 'package:smart_mattress_viewer/src/types.dart';
import 'package:smart_mattress_viewer/src/controller.dart';

Map<String, dynamic> catalog() =>
    jsonDecode(File('assets/models/catalog.json').readAsStringSync())
        as Map<String, dynamic>;
Matcher code(String code) =>
    isA<MattressException>().having((e) => e.code, 'code', code);
Map<String, dynamic> flatten(Map<dynamic, dynamic> input,
    [String prefix = '']) {
  final out = <String, dynamic>{};
  for (final e in input.entries) {
    final key = prefix.isEmpty ? '${e.key}' : '$prefix.${e.key}';
    if (e.value is Map) {
      out.addAll(flatten(e.value as Map, key));
    } else {
      out[key] = e.value;
    }
  }
  return out;
}

void main() {
  final fixtures =
      jsonDecode(File('test/fixtures/canonical.json').readAsStringSync())
          as Map<String, dynamic>;
  for (final scenario in fixtures['cases'] as List) {
    test('shared contract: ${scenario['name']}', () async {
      final b = NativeBackend.fromCatalog(catalog());
      addTearDown(b.dispose);
      await b.request('setModel', [scenario['model']]);
      for (final step in scenario['steps'] as List) {
        final future =
            b.request('updateDeviceState', [step['payload'], step['options']]);
        if (step['error'] != null) {
          await expectLater(future, throwsA(code(step['error'] as String)));
        } else {
          final result = await future;
          expect(result['ignored'], step['expected']['ignored']);
        }
        final flat = flatten(b.store!.snapshot());
        for (final e in (step['checks'] as Map? ?? {}).entries) {
          expect(flat[e.key], e.value, reason: e.key as String);
        }
      }
    });
  }
  test('mapping is independent from physical state and body changes atomic',
      () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['T12']);
    await b.request('updateDeviceState', [
      {
        'air': {
          'left.circuit3': {'value': 17}
        }
      },
      {'normalized': true}
    ]);
    await b.request('tidal.setWaistCircuit', ['left', 5]);
    expect(b.state['air']['left.circuit3']['value'], 17);
    await b.request('body.setState', [
      'left.back',
      {'value': 33}
    ]);
    for (final id in ['left.circuit2', 'left.circuit3', 'left.circuit4']) {
      expect(b.state['air'][id]['value'], 33);
    }
    expect(b.state['air']['right.circuit3']['value'], null);
  });
  test('instance tokens isolate models and old calls', () async {
    final a = NativeBackend.fromCatalog(catalog()),
        b = NativeBackend.fromCatalog(catalog());
    addTearDown(a.dispose);
    addTearDown(b.dispose);
    await a.request('setModel', ['generic']);
    final token = a.modelToken;
    await a.request('setModel', ['generic']);
    await expectLater(
        a.request(
            'setPose',
            [
              {'back': 1}
            ],
            modelToken: token),
        throwsA(code('STALE_MODEL')));
    expect(a.instanceId, isNot(b.instanceId));
  });
  test('motion preserves observed and pauses while hidden/offline/static',
      () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['T11+']);
    await b.request('setPose', [
      {'back': 5}
    ]);
    await b.request('pose.moveTo', [
      {
        'back': {'angle': 25, 'degreesPerSecond': 10}
      }
    ]);
    b.advance(1);
    expect(b.rendered['pose']['back'], 15);
    expect(b.state['pose']['back'], 5);
    await b.request('setVisible', [false]);
    b.advance(1);
    expect(b.rendered['pose']['back'], 15);
    await b.request('setVisible', [true]);
    await b.request('animation.pause', []);
    b.advance(1);
    expect(b.rendered['pose']['back'], 15);
    await b.request('animation.resume', []);
    b.setStaticMode(true);
    expect(b.needsAnimation, false);
    b.advance(1);
    expect(b.rendered['pose']['back'], 15);
    b.setStaticMode(false);
    b.advance(1);
    expect(b.rendered['pose']['back'], 25);
    expect(b.needsAnimation, false);
    expect(b.state['pose']['back'], 5);
  });
  test('pose validation does not partially start motion', () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['generic']);
    await expectLater(
        b.request('pose.moveTo', [
          {
            'back': {'angle': 10, 'degreesPerSecond': 2},
            'leg': {'angle': 80, 'degreesPerSecond': 2}
          }
        ]),
        throwsA(code('INVALID_MOTION')));
    expect(b.motions, isEmpty);
  });
  test('camera focus becomes region emphasis without camera completion',
      () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['T11+']);
    final names = <String>[];
    final sub = b.events.listen((e) => names.add(e.name));
    addTearDown(sub.cancel);
    final result = await b.request('camera.focusSide', ['left']);
    expect(result['representation'], 'highlight');
    expect(b.focusedSide, 'left');
    expect(names, contains('presentation.completed'));
    expect(names, isNot(contains('camera.completed')));
  });
  test('unsupported geometry rejects explicitly', () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['T12']);
    await expectLater(b.request('view.setMode', ['explode']),
        throwsA(code('UNSUPPORTED_RENDERER_FEATURE')));
  });
  test('custom model requires validated matching local fallback', () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    final p = (catalog()['models'] as List).first as Map<String, dynamic>;
    p['id'] = 'custom-bed';
    p['fallback']['regions']['modelId'] = 'custom-bed';
    await b.request('registerModel', [p]);
    await b.request('setModel', ['custom-bed']);
    expect(b.modelId, 'custom-bed');
    await expectLater(
        b.request('registerModel', [p]), throwsA(code('INVALID_PROFILE')));
    p['id'] = 'missing-assets';
    p.remove('fallback');
    await expectLater(b.request('registerModel', [p]),
        throwsA(code('FALLBACK_ASSET_INVALID')));
  });
  test('automatic scan enters only once per active side', () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['T11+']);
    await b.request('adjustment.begin', [
      ['left.shoulder']
    ]);
    final scan = b.motions['scan:left']!['id'];
    await b.request('adjustment.begin', [
      ['left.lumbar']
    ]);
    expect(b.motions['scan:left']!['id'], scan);
    b.advance(1);
    expect(b.reveals['left'], 1);
    await b.request('adjustment.end', [
      ['left.shoulder', 'left.lumbar']
    ]);
    expect(b.motions['scan:left']!['target'], 0);
  });
  test('non-finite state values reject atomically', () async {
    final b = NativeBackend.fromCatalog(catalog());
    addTearDown(b.dispose);
    await b.request('setModel', ['generic']);
    await expectLater(
        b.request('setPose', [
          {'back': double.nan}
        ]),
        throwsA(code('INVALID_STATE')));
    expect(b.initialized, false);
  });
  test('resume permits immediate snapshot submission from resync listener',
      () async {
    final b = NativeBackend.fromCatalog(catalog()), c = MattressController();
    addTearDown(c.dispose);
    c.attachBackend(b);
    final session = await c.setModel('generic');
    Future<dynamic>? submitted;
    final sub = c.events.listen((e) {
      if (e.name == 'state.resyncRequired')
        submitted = session.applySnapshot(MattressState(pose: {'back': 12}));
    });
    addTearDown(sub.cancel);
    await session.invoke('suspend');
    await session.invoke('resume');
    await submitted;
    expect(b.state['pose']['back'], 12);
  });
  test('native resync listener can dispose controller while event is firing',
      () async {
    final b = NativeBackend.fromCatalog(catalog()), c = MattressController();
    c.attachBackend(b);
    final session = await c.setModel('generic');
    final sub = c.events.listen((e) {
      if (e.name == 'state.resyncRequired') c.dispose();
    });
    await expectLater(
        session.invoke('resume'),
        throwsA(isA<MattressException>()
            .having((e) => e.code, 'code', 'RENDERER_CHANGED')));
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();
    expect(c.isReady, false);
  });
  testWidgets('last completed motion stops the native ticker', (tester) async {
    final b = NativeBackend.fromCatalog(catalog());
    await b.request('setModel', ['generic']);
    await b.request('setPose', [
      {'back': 0, 'leg': 0}
    ]);
    await b.request('pose.moveTo', [
      {
        'back': {'angle': 1, 'degreesPerSecond': 10}
      }
    ]);
    await tester.pumpWidget(MaterialApp(
        home: NativeMattressView(
            backend: b, visible: true, background: Colors.black)));
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pumpAndSettle();
    expect(b.needsAnimation, false);
    final frames = b.frames.value;
    await tester.pump(const Duration(seconds: 2));
    expect(b.frames.value, frames);
    expect(tester.binding.transientCallbackCount, 0);
    await tester.pumpWidget(const SizedBox());
    b.dispose();
  });
  testWidgets('static native view settles without WebView or continuous ticker',
      (tester) async {
    final b = NativeBackend.fromCatalog(catalog(), staticMode: true);
    await b.request('setModel', ['T12']);
    await b.request('massage.setState', [
      'left',
      {'status': 'running', 'intensity': 1, 'cycleSeconds': 4}
    ]);
    await tester.pumpWidget(MaterialApp(
        home: NativeMattressView(
            backend: b, visible: true, background: Colors.black)));
    await tester.pumpAndSettle();
    expect(b.needsAnimation, false);
    expect(find.textContaining('固定姿态示意'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    b.dispose();
  });
}
