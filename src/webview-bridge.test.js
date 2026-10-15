import test from 'node:test';
import assert from 'node:assert/strict';
import { WebViewBridge } from './webview-bridge.js';
function setup() {
  const messages = [],
    calls = [];
  let fn,
    n = 0;
  const viewer = {
    on: (_, f) => (
      (fn = f),
      () => {
        fn = () => {};
      }
    ),
    setModel: async (id) => {
      const modelToken = `m${++n}`;
      fn({ type: 'model.ready', id, modelToken });
      return { id, modelToken };
    },
    setAirState: (...args) => calls.push(args),
    getState: () => ({}),
    dispose: () => calls.push('dispose'),
    pose: { moveTo: (x) => calls.push(x) },
  };
  const bridge = new WebViewBridge(viewer, { instanceId: 'page1', send: (m) => messages.push(m) });
  let i = 0;
  const call = (method, args = [], extra = {}) =>
    bridge.receive({
      protocolVersion: 1,
      instanceId: 'page1',
      requestId: `r${++i}`,
      method,
      args,
      ...extra,
    });
  return { bridge, viewer, messages, calls, call };
}
test('ready is repeatably queryable; initial model events are forwarded', async () => {
  const { bridge, call, messages } = setup();
  bridge.ready();
  assert.equal((await call('bridge.hello')).result.instanceId, 'page1');
  assert.equal((await call('setModel', ['T12'])).result.modelToken, 'm1');
  assert.ok(messages.some((m) => m.name === 'model.ready' && m.modelToken === 'm1'));
});
test('all session methods reject old tokens, including motion without SDK token options', async () => {
  const { call, calls } = setup();
  await call('setModel', ['T12']);
  await call('setModel', ['T12']);
  assert.equal((await call('pose.moveTo', [{}], { modelToken: 'm1' })).error.code, 'STALE_MODEL');
  assert.equal(
    (await call('setAirState', ['left.circuit4', { value: 20 }], { modelToken: 'm2' })).ok,
    true,
  );
  assert.equal(calls.length, 1);
  assert.equal((await call('getState', [], { instanceId: 'old' })).error.code, 'STALE_INSTANCE');
});
test('duplicate request IDs share in-flight execution; conflicting reuse rejected', async () => {
  const { call, viewer, bridge } = setup();
  let resolve,
    count = 0;
  viewer.setModel = () => {
    count++;
    return new Promise((r) => (resolve = r));
  };
  const request = {
    protocolVersion: 1,
    instanceId: 'page1',
    requestId: 'same',
    method: 'setModel',
    args: ['T12'],
  };
  const a = bridge.receive(request),
    b = bridge.receive(request);
  await Promise.resolve();
  resolve({ modelToken: 'm1' });
  assert.deepEqual(await a, await b);
  assert.equal(count, 1);
  assert.equal(
    (await bridge.receive({ ...request, args: ['T11+'] })).error.code,
    'REQUEST_CONFLICT',
  );
  assert.equal((await call('constructor', [], { modelToken: 'm1' })).error.code, 'INVALID_METHOD');
});
test('switching rejects updates; superseded load cannot install an old session', async () => {
  const { call, viewer } = setup();
  const resolves = [];
  viewer.setModel = () => new Promise((r) => resolves.push(r));
  const a = call('setModel', ['T12']);
  await Promise.resolve();
  assert.equal((await call('getState', [], { modelToken: 'old' })).error.code, 'MODEL_LOADING');
  const b = call('setModel', ['T11+']);
  await Promise.resolve();
  resolves[1]({ modelToken: 'new' });
  await b;
  resolves[0]({ modelToken: 'old' });
  assert.equal((await a).error.code, 'MODEL_SUPERSEDED');
  assert.equal((await call('bridge.hello')).result.modelToken, 'new');
});
test('invalid protocol and disposal produce structured errors', async () => {
  const { call } = setup();
  assert.equal(
    (await call('bridge.hello', [], { protocolVersion: 2 })).error.code,
    'PROTOCOL_MISMATCH',
  );
  await call('dispose');
  assert.equal((await call('setModel', ['T12'])).error.code, 'DISPOSED');
});

test('legacy JSON dispatch retains structured errors for null requests', async () => {
  const { dispatchModel } = await import('./model-dispatch.js');
  assert.equal((await dispatchModel({}, null)).error.code, 'INVALID_METHOD');
});
