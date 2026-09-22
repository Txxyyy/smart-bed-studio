import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_mattress_viewer/smart_mattress_viewer.dart';

class Host {
  final MattressController controller;
  final List<Map<String, dynamic>> calls = [];
  String instance = 'page1';
  int model = 0;
  bool answer = true;
  Host(this.controller) {
    controller.attach(send);
  }
  void ready() => controller.receive(jsonEncode({
        'protocolVersion': 1,
        'instanceId': instance,
        'type': 'event',
        'name': 'bridge.ready',
        'data': {'protocolVersion': 1, 'instanceId': instance}
      }));
  Future<void> send(String script) async {
    if (script.startsWith('window.MattressBridge&&')) return;
    final request = jsonDecode(script.substring(
            'window.MattressBridge.receive('.length, script.length - 2))
        as Map<String, dynamic>;
    calls.add(request);
    if (!answer) return;
    final dynamic result = request['method'] == 'setModel'
        ? {
            'id': request['args'][0],
            'modelToken': 'm${++model}',
            'revision': 8,
            'regions': [],
            'heating': [],
            'massage': [],
            'airbagCount': 126
          }
        : request['method'] == 'bridge.hello'
            ? {'protocolVersion': 1, 'instanceId': instance}
            : null;
    reply(request, result: result);
  }

  void reply(Map<String, dynamic> request, {dynamic result, String? error}) =>
      controller.receive(jsonEncode({
        'protocolVersion': 1,
        'instanceId': instance,
        'type': 'response',
        'requestId': request['requestId'],
        'ok': error == null,
        'result': result,
        'error': {'code': error, 'message': error}
      }));
}

Matcher code(String value) =>
    isA<MattressException>().having((e) => e.code, 'code', value);
void main() {
  test('handshake can recover a missed ready event', () async {
    final c = MattressController();
    Host(c);
    await c.probe();
    await c.ready;
    expect(c.isReady, true);
    c.dispose();
  });
  test('model sessions capture tokens; old callbacks and old motions fail',
      () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final old = await c.setModel('T12');
    final nextLoad = c.setModel('T11+');
    expect(old.isCurrent, false);
    await expectLater(
        old.movePose(back: const PoseTarget(30)), throwsA(code('STALE_MODEL')));
    final next = await nextLoad;
    await next.setAirState(
        regionId: 'left.lumbar', value: 0, status: AirStatus.idle);
    expect(h.calls.last['modelToken'], next.modelInfo.modelToken);
    expect(h.calls.last['args'][1]['value'], 0);
    c.dispose();
  });
  test('responses correlate by ID even when delivered out of order', () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final s = await c.setModel('T12');
    h.answer = false;
    final a = s.focusSide(Side.left),
        b = s.setMassage(side: Side.right, status: MassageStatus.running);
    h.reply(h.calls.last, result: 'massage');
    h.reply(h.calls[h.calls.length - 2], result: 'camera');
    expect(await a, 'camera');
    expect(await b, 'massage');
    c.dispose();
  });
  test('timeout does not retry actions and late replies are ignored', () async {
    final c =
        MattressController(requestTimeout: const Duration(milliseconds: 10));
    final h = Host(c)..ready();
    final s = await c.setModel('T12');
    h.answer = false;
    final count = h.calls.length;
    await expectLater(s.focusSide(Side.left), throwsA(code('REQUEST_TIMEOUT')));
    expect(h.calls.length, count + 1);
    h.reply(h.calls.last);
    c.dispose();
  });
  test('reload rejects pending calls and invalidates sessions', () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final s = await c.setModel('T12');
    h.answer = false;
    final pending = s.getState();
    c.pageStarted();
    await expectLater(pending, throwsA(code('PAGE_RELOADED')));
    expect(s.isCurrent, false);
    h.instance = 'page2';
    h.ready();
    await c.ready;
    c.dispose();
  });
  test('explicit null, absent keys and zero stay distinct; snapshots copied',
      () {
    final json = <String, Object?>{
      'air': {
        'left.circuit4': {'value': null}
      },
      'pose': {'back': 0}
    };
    final state = MattressState.fromJson(json);
    json.clear();
    expect(state.toJson()['air']['left.circuit4'].containsKey('value'), true);
    expect(state.toJson()['air']['left.circuit4']['value'], null);
    expect(state.toJson()['pose']['back'], 0);
    expect(const AirState(status: AirStatus.idle).toJson().containsKey('value'),
        false);
    expect(const AirState.unknown().toJson(), {'value': null, 'status': null});
  });
  test('JSON quoting cannot break out of argument strings', () async {
    final c = MattressController();
    final h = Host(c)..ready();
    const id = "T12');alert(1);//\n型号";
    await c.setModel(id);
    expect(h.calls.last['args'], [id]);
    c.dispose();
  });
  test('snapshot and patches use normalized input and preserve sequence',
      () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final s = await c.setModel('T12');
    await s.applySnapshot(MattressState(online: true), sequence: 10);
    expect(h.calls.last['args'][1],
        {'normalized': true, 'kind': 'snapshot', 'sequence': 10});
    await s.applyPatch(
        MattressState(massage: {
          Side.right: const MassageState(status: MassageStatus.running)
        }),
        sequence: 11);
    expect(h.calls.last['args'][0], {
      'massage': {
        'right': {'status': 'running'}
      }
    });
    c.dispose();
  });
  test('boot errors reach ready callers and event consumers', () async {
    final c = MattressController();
    Host(c);
    final ready = c.ready;
    c.receive(jsonEncode({
      'type': 'event',
      'name': 'bridge.failed',
      'data': {'code': 'UNSUPPORTED_RUNTIME', 'message': 'WebGL2 required'}
    }));
    await expectLater(ready, throwsA(code('UNSUPPORTED_RUNTIME')));
    c.dispose();
  });
  test('only one widget can attach; detach and dispose invalidate work',
      () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final s = await c.setModel('T12');
    expect(() => Host(c), throwsA(code('ALREADY_ATTACHED')));
    c.detach();
    expect(s.isCurrent, false);
    h.reply({'requestId': 'absent'});
    c.dispose();
    await expectLater(s.getState(), throwsA(code('STALE_MODEL')));
  });

  test('wrong-page response cannot complete a current request', () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final session = await c.setModel('T12');
    h.answer = false;
    final pending = session.getState();
    final request = h.calls.last;
    c.receive(jsonEncode({
      'protocolVersion': 1,
      'instanceId': 'old',
      'type': 'response',
      'requestId': request['requestId'],
      'ok': true,
      'result': 'wrong'
    }));
    h.reply(request, result: 'current');
    expect(await pending, 'current');
    c.dispose();
  });
  test('malformed error response settles the future instead of hanging',
      () async {
    final c = MattressController();
    final h = Host(c)..ready();
    final session = await c.setModel('T12');
    h.answer = false;
    final pending = session.getState();
    c.receive(jsonEncode({
      'protocolVersion': 1,
      'instanceId': 'page1',
      'type': 'response',
      'requestId': h.calls.last['requestId'],
      'ok': false
    }));
    await expectLater(pending, throwsA(code('INVALID_RESPONSE')));
    c.dispose();
  });
  test('session escape hatch cannot silently replace the controller model',
      () async {
    final c = MattressController();
    Host(c)..ready();
    final session = await c.setModel('T12');
    await expectLater(
        session.invoke('setModel', ['T11+']), throwsA(code('INVALID_METHOD')));
    c.dispose();
  });
}
