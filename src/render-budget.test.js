import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderScheduler, renderBudget } from './render-budget.js';
import { MattressViewer } from './mattress-sdk.js';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
test('auto preserves original quality and native refresh on touch and desktop', () => {
  for (const mobile of [true, false])
    assert.deepEqual(renderBudget('auto', mobile), {
      mode: 'native',
      requestedMode: 'auto',
      maxFps: null,
      pixelRatio: 1.35,
      shadows: true,
      shadowSize: 1024,
      anisotropy: 16,
    });
  assert.equal(renderBudget('high', true).maxFps, 60);
  assert.equal(renderBudget('eco', true, 2).pixelRatio, 1);
  for (const args of [['turbo'], ['eco', true, NaN], ['eco', true, 0]])
    assert.throws(() => renderBudget(...args), { code: 'INVALID_PERFORMANCE' });
});
function fixture(maxFps = 30) {
  let now = 0,
    sequence = 0;
  const timers = new Map(),
    rafs = new Map(),
    frames = [];
  const scheduler = new RenderScheduler(
    (t) => {
      frames.push(t);
      scheduler.request();
    },
    maxFps,
    {
      now: () => now,
      raf: (fn) => {
        const id = ++sequence;
        rafs.set(id, fn);
        return id;
      },
      cancelRaf: (id) => rafs.delete(id),
      timer: (fn, ms) => {
        const id = ++sequence;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      cancelTimer: (id) => timers.delete(id),
    },
  );
  const tick = (t) => {
    now = t;
    for (const [id, item] of [...timers])
      if (item.at <= now) {
        timers.delete(id);
        item.fn();
      }
    const batch = [...rafs];
    rafs.clear();
    for (const [, fn] of batch) fn(t);
  };
  return { scheduler, frames, tick, timers, rafs };
}
test('120Hz displays stay within 30fps and hidden/disposed work has no pending wakeups', () => {
  const f = fixture();
  f.scheduler.request();
  f.scheduler.request();
  assert.equal(f.rafs.size, 1);
  for (let i = 0; i <= 120; i++) f.tick((i * 1000) / 120);
  assert.ok(f.frames.length >= 25 && f.frames.length <= 31);
  f.scheduler.setBlocked(true);
  const n = f.frames.length;
  assert.equal(f.rafs.size + f.timers.size, 0);
  f.scheduler.request();
  f.tick(5000);
  assert.equal(f.frames.length, n);
  f.scheduler.setBlocked(false);
  f.scheduler.request();
  f.tick(5001);
  assert.equal(f.frames.length, n + 1);
  f.scheduler.cancel();
  assert.equal(f.rafs.size + f.timers.size, 0);
});
test('visibility pauses presentation clock without cancelling independent motions', () => {
  const v = Object.create(MattressViewer.prototype);
  let blocked = null;
  Object.assign(v, {
    container: { clientWidth: 390, clientHeight: 650 },
    appVisible: true,
    inViewport: true,
    pageHidden: false,
    backgroundAt: null,
    backgroundOffset: 0,
    animationPaused: false,
    timeOffset: 0,
    scheduler: {
      setBlocked(value) {
        blocked = value;
      },
    },
    invalidate() {},
    airMotions: new Map([
      ['left', {}],
      ['right', {}],
    ]),
  });
  v.setVisible(false);
  const hiddenTime = v.activeTime();
  assert.equal(blocked, true);
  assert.equal(v.activeTime(performance.now() + 50000), hiddenTime);
  assert.equal(v.airMotions.size, 2);
  v.setVisible(true);
  assert.equal(blocked, false);
  assert.equal(v.airMotions.size, 2);
  assert.throws(() => v.setVisible('false'), { code: 'INVALID_STATE' });
  // Page visibility alone must not undo an explicit App hide.
  v.setVisible(false);
  v.pageHidden = true;
  v.updateVisibility();
  v.pageHidden = false;
  v.updateVisibility();
  assert.equal(blocked, true);
});

test('native cadence runs every 60/90/120Hz refresh without timer pacing or skipped frames', () => {
  for (const hz of [60, 90, 120]) {
    const f = fixture(null);
    f.scheduler.request();
    for (let i = 0; i < hz; i++) {
      f.tick((i * 1000) / hz);
      assert.equal(f.timers.size, 0);
    }
    assert.equal(f.frames.length, hz);
    f.scheduler.cancel();
    assert.equal(f.rafs.size, 0);
  }
});

test('geometry changed in the frame after a shadow refresh is uploaded in that frame', () => {
  // three.js 主通道在帧号递增前、阴影通道在递增后上传几何；用真实 WebGLObjects 复现这一顺序。
  const info = { render: { frame: 0 } },
    uploads = [],
    geometries = { get: (object, geometry) => geometry, update: (g) => uploads.push(g.version) },
    objects = new WebGLObjects(null, geometries, null, null, info),
    mesh = { geometry: { version: 0 } },
    shadowMap = { enabled: true, needsUpdate: true };
  const v = Object.create(MattressViewer.prototype);
  Object.assign(v, {
    lastFrame: 0,
    frames: 0,
    controls: { update() {}, autoRotate: false },
    renderer: {
      shadowMap,
      info,
      render() {
        objects.update(mesh);
        info.render.frame++;
        if (shadowMap.enabled && shadowMap.needsUpdate) {
          objects.update(mesh);
          shadowMap.needsUpdate = false;
        }
      },
    },
  });
  v.frame(16);
  // 下一帧只有按摩等几何变化、不刷新阴影，且之后不再绘制（例如减少动态效果时停止按摩）。
  mesh.geometry.version = 1;
  v.frame(32);
  assert.equal(uploads.at(-1), 1);
  mesh.geometry.version = 2;
  v.frame(48);
  assert.equal(uploads.at(-1), 2);
});
