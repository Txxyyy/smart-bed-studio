import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_mattress_viewer/src/controller.dart';
import 'package:smart_mattress_viewer/src/rendering/native_backend.dart';
import 'package:smart_mattress_viewer/src/types.dart';

Map<String, dynamic> catalog() =>
    jsonDecode(File('assets/models/catalog.json').readAsStringSync())
        as Map<String, dynamic>;
Map<String, dynamic> custom() {
  final p = (catalog()['models'] as List).first as Map<String, dynamic>;
  p['id'] = 'custom-local';
  p['fallback']['regions']['modelId'] = 'custom-local';
  return p;
}

class CountBackend extends NativeBackend {
  int registrations = 0;
  CountBackend() : super.fromCatalog(catalog());
  @override
  Future<dynamic> request(String method, List<Object?> args,
      {String? modelToken, Duration? timeout}) {
    if (method == 'registerModel') registrations++;
    return super
        .request(method, args, modelToken: modelToken, timeout: timeout);
  }
}

void main() {
  test(
      'custom registrations replay before ready and same-profile registration is idempotent',
      () async {
    final c = MattressController(), a = CountBackend(), b = CountBackend();
    addTearDown(c.dispose);
    addTearDown(a.dispose);
    c.attachBackend(a);
    await c.ready;
    await c.registerModel(custom());
    await c.registerModel(custom());
    expect(a.registrations, 1);
    c.attachBackend(b, replace: true);
    expect(c.isReady, false);
    await c.ready;
    expect(b.registrations, 1);
    final session = await c.setModel('custom-local');
    expect(session.modelInfo.id, 'custom-local');
    await c.registerModel(custom());
    expect(b.registrations, 1);
    final changed = custom()..['name'] = 'other';
    await expectLater(
        c.registerModel(changed),
        throwsA(isA<MattressException>()
            .having((e) => e.code, 'code', 'INVALID_PROFILE')));
  });
  test('mirror registers once and repeat binding does not duplicate', () async {
    final c = MattressController(), a = CountBackend(), mirror = CountBackend();
    addTearDown(c.dispose);
    addTearDown(mirror.dispose);
    c.attachBackend(a);
    c.setStateMirror(mirror);
    await c.registerModel(custom());
    await c.registerModel(custom());
    await c.setModel('custom-local');
    await c.setModel('custom-local');
    expect(mirror.registrations, 1);
    expect(a.registrations, 1);
  });
  test('auto rejects missing fallback before sending to active backend',
      () async {
    final c = MattressController(), a = CountBackend();
    addTearDown(c.dispose);
    c.attachBackend(a);
    c.setRendererInfo(const RendererInfo(
        requestedPolicy: RenderPolicy.auto, activeMode: RenderMode.threeD));
    final p = custom()..remove('fallback');
    await expectLater(
        c.registerModel(p),
        throwsA(isA<MattressException>()
            .having((e) => e.code, 'code', 'FALLBACK_ASSET_INVALID')));
    expect(a.registrations, 0);
  });
  test('nested synchronous event dispatch and disposal are safe', () async {
    final c = MattressController();
    final a = CountBackend();
    final events = <String>[];
    final sub = c.events.listen((e) {
      events.add(e.name);
      if (e.name == 'renderer.ready')
        c.loadFailed(const MattressException('TEST', 'nested'));
      if (e.name == 'bridge.failed') c.dispose();
    });
    c.attachBackend(a);
    await Future<void>.delayed(Duration.zero);
    expect(events, ['renderer.ready', 'bridge.failed']);
    await sub.cancel();
  });
  test('view ownership rejects another owner and manually attached backend',
      () {
    final c = MattressController(), owner = Object();
    c.claimView(owner);
    c.claimView(owner);
    expect(() => c.claimView(Object()), throwsA(isA<MattressException>()));
    c.releaseView(Object());
    expect(() => c.claimView(Object()), throwsA(isA<MattressException>()));
    c.releaseView(owner);
    c.attachBackend(CountBackend());
    expect(() => c.claimView(Object()), throwsA(isA<MattressException>()));
    c.dispose();
  });
}
