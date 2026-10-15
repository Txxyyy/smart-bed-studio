import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BUILTIN_PROFILES } from '../src/model-profiles.js';
import { MODEL_METHODS } from '../src/model-dispatch.js';
const root = new URL('../', import.meta.url);
export async function createCatalog() {
  const models = [];
  for (const profile of BUILTIN_PROFILES) {
    const dir = new URL(`src/fallback-assets/${profile.id}/`, root);
    const regions = JSON.parse(await readFile(new URL('regions.json', dir), 'utf8'));
    const png = await readFile(new URL('base.png', dir));
    const fail = () => {
      throw new Error(`Invalid fallback asset: ${profile.id}`);
    };
    if (
      regions.schemaVersion !== 1 ||
      regions.modelId !== profile.id ||
      regions.modelRevision !== profile.revision ||
      regions.sideConvention !== 'supine' ||
      regions.fit !== 'contain'
    )
      fail();
    if (regions.imageSha256 !== createHash('sha256').update(png).digest('hex')) fail();
    if (
      png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.readUInt32BE(16) !== regions.width ||
      png.readUInt32BE(20) !== regions.height
    )
      fail();
    const layers = {};
    for (const side of ['left', 'right']) {
      const name = `reveal-${side}.png`,
        data = await readFile(new URL(name, dir));
      if (
        regions.layerSha256?.[side] !== createHash('sha256').update(data).digest('hex') ||
        data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        data.readUInt32BE(16) !== regions.width ||
        data.readUInt32BE(20) !== regions.height
      )
        fail();
      layers[side] = `packages/smart_mattress_viewer/assets/fallback/${profile.id}/${name}`;
    }
    const polygon = (p) =>
      Array.isArray(p) &&
      p.length >= 3 &&
      p.every(
        (v) =>
          Array.isArray(v) &&
          v.length === 2 &&
          v.every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
      );
    if (
      !polygon(regions.surface) ||
      !['left', 'right'].every((s) => polygon(regions.sidePolygons?.[s])) ||
      !Array.isArray(regions.regions)
    )
      fail();
    const expected = { air: profile.regions, heating: profile.heating, massage: profile.massage };
    for (const region of regions.regions) {
      const match = expected[region.kind]?.find((r) => r.id === region.id);
      if (
        !match ||
        region.side !== (match.side === 1 ? 'left' : 'right') ||
        !polygon(region.polygon)
      )
        fail();
      if (region.kind === 'air') {
        const count = profile.airbags
          .filter((b) => b.regionId === region.id)
          .reduce((n, b) => n + (b.cellCount || 1), 0);
        if (
          region.cells?.length !== count ||
          region.cells.some(
            (c) => ![c.x, c.y, c.rx, c.ry].every((n) => Number.isFinite(n) && n > 0 && n < 1),
          )
        )
          fail();
      }
    }
    for (const [kind, entries] of Object.entries(expected))
      for (const entry of entries)
        if (!regions.regions.some((r) => r.kind === kind && r.id === entry.id)) fail();
    models.push({
      ...profile,
      fallback: {
        image: `packages/smart_mattress_viewer/assets/fallback/${profile.id}/base.png`,
        layers,
        regions,
      },
    });
  }
  return {
    schemaVersion: 1,
    aliases: { 'T11+': 't11-plus', T12: 't12' },
    methods: MODEL_METHODS,
    models,
  };
}
export async function exportCatalog() {
  const catalog = await createCatalog();
  const dir = new URL('flutter/smart_mattress_viewer/assets/models/', root);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('catalog.json', dir), JSON.stringify(catalog, null, 2) + '\n');
  return catalog;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await exportCatalog();
  console.log('Validated and exported model catalog');
}
