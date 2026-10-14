import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_STEPS,
  DEMO_STEP_SECONDS,
  sampleShowroomDemo,
  showroomDemoReveal,
} from './showroom-demo.js';
import { sampleAirReveal } from './firmness.js';

const baseline = {
  pressures: [
    [50, 50, 50, 50],
    [50, 50, 50, 50],
  ],
  heating: [
    [0, 0],
    [0, 0],
  ],
};
const at = (index, seconds) => sampleShowroomDemo(index * DEMO_STEP_SECONDS + seconds, baseline);

test('each side has exactly one entrance, four uninterrupted regions, and one exit before heating', () => {
  for (const side of ['left', 'right']) {
    const steps = DEMO_STEPS.filter((s) => s.side === side);
    assert.deepEqual(
      steps.map((s) => s.kind),
      ['enter', 'air', 'air', 'air', 'air', 'exit', 'heat', 'heat'],
    );
    assert.deepEqual(
      steps.filter((s) => s.kind === 'air').map((s) => s.zone),
      [0, 1, 2, 3],
    );
  }
  for (let i = 0; i < DEMO_STEPS.length; i++)
    if (DEMO_STEPS[i].kind === 'air') {
      for (const t of [0.001, 1, 3.999]) {
        const reveal = showroomDemoReveal(at(i, t));
        assert.equal(reveal.phase, 'adjust');
        assert.equal(reveal.progress, 1);
        assert.equal(reveal.ready, true);
      }
    }
});

test('exit scan progressively closes the cover and completes before heat or the other side', () => {
  for (let i = 0; i < DEMO_STEPS.length; i++)
    if (DEMO_STEPS[i].kind === 'exit') {
      const start = showroomDemoReveal(at(i, 0)),
        middle = showroomDemoReveal(at(i, 0.45)),
        end = showroomDemoReveal(at(i, 1));
      assert.equal(start.phase, 'closing');
      assert.equal(start.progress, 1);
      assert.equal(middle.phase, 'closing');
      assert.ok(middle.progress > 0 && middle.progress < 1);
      assert.equal(end.phase, 'closed');
      assert.equal(showroomDemoReveal(at(i, 0), true).phase, 'closed');
      assert.equal(showroomDemoReveal(at(i + 1, 0)).phase, 'closed');
      assert.deepEqual(at(i, 0).pressures, at(i, 3.9).pressures, 'scan does not change air values');
    }
  const transition = { closing: true, side: 'right', start: 0 };
  assert.equal(sampleAirReveal({ kind: 'exit' }, transition, 400).phase, 'closing');
  assert.equal(sampleAirReveal({ kind: 'exit' }, transition, 1000).phase, 'closed');
});
