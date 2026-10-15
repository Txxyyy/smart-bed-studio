import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, PATTERN_OPTIONS } from './cmf.js';

test('reference collection is additive and all textile assignments remain valid', () => {
  assert.equal(COLLECTIONS.length, 13);
  assert.equal(new Set(COLLECTIONS.map((c) => c.id)).size, 13);
  for (const id of [
    'ivory',
    'oat',
    'sage',
    'clay',
    'mocha',
    'midnight',
    'basalt',
    'mist',
    'charcoal',
    'merlot',
    'saddle',
    'blush',
  ])
    assert.ok(COLLECTIONS.some((c) => c.id === id));
  const reference = COLLECTIONS.find((c) => c.id === 'indigoWeave');
  assert.equal(reference.headboard, 'channel');
  assert.equal(reference.waistband, true);
  assert.deepEqual(reference.patterns, ['performance', 'microMesh', 'grain']);
  for (const c of COLLECTIONS) {
    for (const [i, part] of ['fabric', 'side', 'leather', 'surround'].entries())
      assert.ok(PATTERN_OPTIONS[part].includes(c.patterns[Math.min(i, 2)]));
    for (const color of c.colors) assert.match(color, /^#[0-9a-f]{6}$/i);
  }
});
