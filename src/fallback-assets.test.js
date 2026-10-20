import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../scripts/export-model-catalog.mjs';
import { BUILTIN_PROFILES } from './model-profiles.js';
import { MODEL_METHODS } from './model-dispatch.js';
test('offline assets share the centered foot camera and cover every profile capability', async () => {
  const c = await createCatalog();
  assert.deepEqual(c.methods, MODEL_METHODS);
  assert.equal(c.aliases['T11+'], 't11-plus');
  assert.equal(c.models.length, 3);
  for (const p of BUILTIN_PROFILES) {
    const m = c.models.find((m) => m.id === p.id),
      f = m.fallback;
    assert.equal(f.regions.modelRevision, p.revision);
    assert.equal(f.regions.width, 1200);
    assert.equal(f.regions.height, 1400);
    assert.equal(f.regions.assetRevision, 3);
    assert.equal(f.regions.camera.position[0], 0);
    assert.ok(f.layers.left.endsWith('reveal-left.png'));
    assert.ok(f.layers.right.endsWith('reveal-right.png'));
    for (const side of ['left', 'right']) {
      const polygon = f.regions.sidePolygons[side];
      assert.equal(polygon.length, 4);
    }
    assert.ok(f.regions.regions.filter((r) => r.kind === 'air').every((r) => r.cells.length > 0));
    // 每一路气囊都有取自 3D 渲染的调节光效层，位于所属半侧（床中线在画面正中）。
    for (const region of f.regions.regions.filter((r) => r.kind === 'air')) {
      assert.ok(f.glow[region.id].endsWith(region.glow.image));
      const g = region.glow,
        center = f.regions.width / 2;
      if (region.side === 'left') assert.ok(g.x + g.width > center && g.x >= center - 40);
      else assert.ok(g.x < center && g.x + g.width <= center + 40);
    }
    assert.deepEqual(m.regions, p.regions);
  }
});
test('T11 has no leg air region; T12 retains all seven physical circuits per side', async () => {
  const c = await createCatalog(),
    t11 = c.models.find((p) => p.id === 't11-plus'),
    t12 = c.models.find((p) => p.id === 't12');
  assert.equal(t11.fallback.regions.regions.filter((r) => r.kind === 'air').length, 6);
  assert.ok(t11.fallback.regions.regions.some((r) => r.id === 'left.leg' && r.kind === 'heating'));
  assert.equal(t12.fallback.regions.regions.filter((r) => r.kind === 'air').length, 14);
  assert.equal(t12.fallback.regions.regions.filter((r) => r.kind === 'massage').length, 6);
});
