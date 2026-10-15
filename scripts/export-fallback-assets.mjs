// Developer-only capture. PLAYWRIGHT_MODULE can point to a bundled playwright index.mjs.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { BUILTIN_PROFILES } from '../src/model-profiles.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const size = { width: 1200, height: 1400 };
const server = await createServer({ server: { host: '127.0.0.1', port: 5188, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.FALLBACK_BROWSER_CHANNEL || 'chrome', headless: true });

try {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  for (const profile of BUILTIN_PROFILES) {
    await page.goto(`http://127.0.0.1:5188/embed.html?embed=1&model=${profile.id}`);
    await page.waitForFunction(() => window.mattress?.bundle);
    const metadata = await page.evaluate(async ({ width, height }) => {
      const { Vector3, MeshBasicMaterial } = await import('/node_modules/three/build/three.module.js');
      const { mapPoint } = await import('/src/kinematics.js');
      const v = window.mattress, b = v.bundle, p = b.profile;
      v.camera.cancel();
      v.camera.setFollow(false);
      v.animation.setPolicy('app');
      v.controls.target.set(0, .56, -.04);
      v.activeCamera.position.set(0, 2.88, 2.89);
      v.activeCamera.lookAt(v.controls.target);
      v.activeCamera.updateMatrixWorld(true);
      v.grid.visible = false;
      v.scene.background.set('#10191d');
      v.scene.fog.color.set('#10191d');
      v.floor.material = new MeshBasicMaterial({ color: '#10191d', toneMapped: false });
      v.animationPaused = true;
      v.frame(performance.now());

      const project = (x, y, z) => {
        const point = mapPoint(b.bed.spine, x, y, z, null, false, p.airbags);
        const q = new Vector3(point.x, point.y, point.z).project(v.activeCamera);
        return [(q.x + 1) / 2, (1 - q.y) / 2].map(n => Math.round(n * 1e6) / 1e6);
      };
      const rect = (x, z, w, d, y = b.bed.surfaceTop) =>
        [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2],
          [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]]
          .map(([px, pz]) => project(px, y, pz));
      const regions = [];
      for (const r of p.regions) {
        const bags = p.airbags.filter(bag => bag.regionId === r.id);
        const minX = Math.min(...bags.map(bag => bag.x - bag.width / 2));
        const maxX = Math.max(...bags.map(bag => bag.x + bag.width / 2));
        const minZ = Math.min(...bags.map(bag => bag.z - bag.depth / 2));
        const maxZ = Math.max(...bags.map(bag => bag.z + bag.depth / 2));
        const cells = bags.flatMap(bag => {
          const count = bag.shape === 'round-array' ? bag.cellCount : 1;
          const pitch = bag.width / count;
          const y = bag.bottom + bag.minHalfHeight + .5 * bag.halfHeightRange;
          return Array.from({ length: count }, (_, index) => {
            const x = bag.x + (index - (count - 1) / 2) * pitch;
            const rx = pitch * (bag.shape === 'round-array' ? .46 : .44);
            const rz = Math.min(bag.depth, pitch) * .46;
            const [cx, cy] = project(x, y, bag.z);
            const [ex] = project(x + rx, y, bag.z);
            const [, ey] = project(x, y, bag.z + rz);
            return { x: cx, y: cy, rx: Math.abs(ex - cx), ry: Math.abs(ey - cy), shape: bag.shape === 'round-array' ? 'round' : 'pouch' };
          });
        });
        regions.push({ id: r.id, kind: 'air', side: r.side === 1 ? 'left' : 'right',
          polygon: rect((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ), cells });
      }
      for (const h of p.heating) regions.push({ id: h.id, kind: 'heating',
        side: h.side === 1 ? 'left' : 'right', polygon: rect(h.x, h.z, h.width, h.depth) });
      for (const channel of p.massage) for (const pad of channel.pads)
        regions.push({ id: channel.id, kind: 'massage', side: channel.id,
          polygon: rect(pad.x, pad.z, pad.width, pad.depth) });
      return { schemaVersion: 1, modelId: p.id, modelRevision: p.revision,
        assetRevision: 2, appearanceKey: p.appearance.collection, width, height,
        sideConvention: 'supine', fit: 'contain', pose: { back: 0, leg: 0 },
        camera: { position: v.activeCamera.position.toArray(), target: v.controls.target.toArray(), fov: v.activeCamera.fov },
        surface: rect(0, 0, 1.6, 1.9),
        sidePolygons: { left: rect(.4, 0, .8, 1.9), right: rect(-.4, 0, .8, 1.9) }, regions };
    }, size);
    const dir = new URL(`../src/fallback-assets/${profile.id}/`, import.meta.url);
    await mkdir(dir, { recursive: true });
    const capture = async (filename) => {
      const png = await page.locator('canvas').screenshot({ path: new URL(filename, dir).pathname });
      return createHash('sha256').update(png).digest('hex');
    };
    metadata.imageSha256 = await capture('base.png');
    metadata.layerSha256 = {};
    await page.evaluate(() => {
      const v = window.mattress;
      v.bundle.bed.innerFoam.material.color.set('#284451');
      v.bundle.bed.innerFoam.material.roughness = .88;
      v.frame(performance.now());
    });
    for (const side of ['left', 'right']) {
      await page.evaluate(side => {
        const v = window.mattress;
        v.effects.setSideReveal(side, { progress: 1, phase: 'adjust' });
        v.frame(performance.now());
      }, side);
      metadata.layerSha256[side] = await capture(`reveal-${side}.png`);
      await page.evaluate(side => {
        const v = window.mattress;
        v.effects.setSideReveal(side, { phase: 'closed' });
        v.frame(performance.now());
      }, side);
    }
    await writeFile(new URL('regions.json', dir), JSON.stringify(metadata, null, 2) + '\n');
    console.log(`Exported ${profile.id}: ${metadata.regions.length} projected regions`);
  }
} finally {
  await browser.close();
  await server.close();
}
