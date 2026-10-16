// Developer-only capture. PLAYWRIGHT_MODULE can point to a bundled playwright index.mjs.
// 二维降级资源直接取自 3D 渲染：完整外罩底图、左右侧揭开后的透视层，以及每一路气囊调节光效层。
// 光效层以中性白色渲染，取“该路点亮”与“未点亮”两帧的逐像素差。两帧都把揭开侧外罩临时
// 调为全透明，避免光叠在浅色外罩上饱和偏色；差值再乘外罩透光率（1 − 0.38）。差值以
// “白色 + alpha = 光量”存储（预乘后即加色光量），运行时按状态着色、以加色叠加在透视层上，
// 遮挡关系与外罩衰减和 3D 一致。
import { createHash } from 'node:crypto';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { createServer } from 'vite';
import { BUILTIN_PROFILES } from '../src/model-profiles.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const size = { width: 1200, height: 1400 };
// 透视层与光效层统一的展示压力（0–100），让气囊高度、刻度环与光效对齐。
const PRESENTATION_PRESSURE = 50;
const server = await createServer({ server: { host: '127.0.0.1', port: 5188, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  channel: process.env.FALLBACK_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

try {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  for (const profile of BUILTIN_PROFILES) {
    await page.goto(`http://127.0.0.1:5188/embed.html?embed=1&model=${profile.id}`);
    await page.waitForFunction(() => window.mattress?.bundle);
    const metadata = await page.evaluate(async ({ width, height }) => {
      const { Vector3, MeshBasicMaterial } =
        await import('/node_modules/three/build/three.module.js');
      const { mapPoint } = await import('/src/kinematics.js');
      const v = window.mattress,
        b = v.bundle,
        p = b.profile;
      v.camera.cancel();
      v.camera.setFollow(false);
      v.animation.setPolicy('app');
      v.controls.target.set(0, 0.56, -0.04);
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
        return [(q.x + 1) / 2, (1 - q.y) / 2].map((n) => Math.round(n * 1e6) / 1e6);
      };
      const rect = (x, z, w, d, y = b.bed.surfaceTop) =>
        [
          [x - w / 2, z - d / 2],
          [x + w / 2, z - d / 2],
          [x + w / 2, z + d / 2],
          [x - w / 2, z + d / 2],
        ].map(([px, pz]) => project(px, y, pz));
      const regions = [];
      for (const r of p.regions) {
        const bags = p.airbags.filter((bag) => bag.regionId === r.id);
        const minX = Math.min(...bags.map((bag) => bag.x - bag.width / 2));
        const maxX = Math.max(...bags.map((bag) => bag.x + bag.width / 2));
        const minZ = Math.min(...bags.map((bag) => bag.z - bag.depth / 2));
        const maxZ = Math.max(...bags.map((bag) => bag.z + bag.depth / 2));
        // cells 为资源契约保留：按气囊中部高度投影的逐囊椭圆，当前二维不再用于绘制。
        const cells = bags.flatMap((bag) => {
          const count = bag.shape === 'round-array' ? bag.cellCount : 1;
          const pitch = bag.width / count;
          const y = bag.bottom + bag.minHalfHeight + 0.5 * bag.halfHeightRange;
          return Array.from({ length: count }, (_, index) => {
            const x = bag.x + (index - (count - 1) / 2) * pitch;
            const rx = pitch * (bag.shape === 'round-array' ? 0.46 : 0.44);
            const rz = Math.min(bag.depth, pitch) * 0.46;
            const [cx, cy] = project(x, y, bag.z);
            const [ex] = project(x + rx, y, bag.z);
            const [, ey] = project(x, y, bag.z + rz);
            return {
              x: cx,
              y: cy,
              rx: Math.abs(ex - cx),
              ry: Math.abs(ey - cy),
              shape: bag.shape === 'round-array' ? 'round' : 'pouch',
            };
          });
        });
        regions.push({
          id: r.id,
          kind: 'air',
          side: r.side === 1 ? 'left' : 'right',
          polygon: rect((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ),
          cells,
        });
      }
      for (const h of p.heating)
        regions.push({
          id: h.id,
          kind: 'heating',
          side: h.side === 1 ? 'left' : 'right',
          polygon: rect(h.x, h.z, h.width, h.depth),
        });
      for (const channel of p.massage)
        for (const pad of channel.pads)
          regions.push({
            id: channel.id,
            kind: 'massage',
            side: channel.id,
            polygon: rect(pad.x, pad.z, pad.width, pad.depth),
          });
      return {
        schemaVersion: 1,
        modelId: p.id,
        modelRevision: p.revision,
        assetRevision: 3,
        appearanceKey: p.appearance.collection,
        width,
        height,
        sideConvention: 'supine',
        fit: 'contain',
        pose: { back: 0, leg: 0 },
        camera: {
          position: v.activeCamera.position.toArray(),
          target: v.controls.target.toArray(),
          fov: v.activeCamera.fov,
        },
        surface: rect(0, 0, 1.6, 1.9),
        sidePolygons: { left: rect(0.4, 0, 0.8, 1.9), right: rect(-0.4, 0, 0.8, 1.9) },
        presentationPressure: null,
        regions,
      };
    }, size);
    const dir = new URL(`../src/fallback-assets/${profile.id}/`, import.meta.url);
    await mkdir(dir, { recursive: true });
    const save = async (filename, data) => {
      await writeFile(new URL(filename, dir), data);
      return sha256(data);
    };
    // 整幅底图用页面截图编码（压缩率明显优于 canvas.toDataURL），像素与刚提交的帧一致。
    const screenshot = async (filename) =>
      save(filename, await page.locator('canvas').screenshot());

    // 画布像素抓取：渲染后同一任务内复制 WebGL 画布，保证与差分所用像素一致。
    await page.evaluate(() => {
      const v = window.mattress,
        canvas = v.renderer.domElement,
        scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      const grab = () => {
        context.clearRect(0, 0, scratch.width, scratch.height);
        context.drawImage(canvas, 0, 0);
        return context.getImageData(0, 0, scratch.width, scratch.height);
      };
      const encode = (image) => {
        const out = document.createElement('canvas');
        out.width = image.width;
        out.height = image.height;
        out.getContext('2d').putImageData(image, 0, 0);
        return out.toDataURL('image/png');
      };
      window.__fallback = { grab, encode };
    });

    await page.evaluate(() => window.mattress.frame(performance.now()));
    metadata.imageSha256 = await screenshot('base.png');

    // 揭开与光效统一使用展示压力，气囊高度、刻度与 3D 调节时一致；材质保持 3D 展示态原样。
    await page.evaluate((pressure) => {
      for (const row of window.mattress.bundle.current.pressures) row.fill(pressure);
    }, PRESENTATION_PRESSURE);
    metadata.presentationPressure = PRESENTATION_PRESSURE;
    metadata.layerSha256 = {};
    for (const side of ['left', 'right']) {
      await page.evaluate((side) => {
        const v = window.mattress;
        v.effects.setHighlight([]);
        v.effects.setSideReveal(side, { progress: 1, phase: 'adjust' });
        v.frame(performance.now());
      }, side);
      metadata.layerSha256[side] = await screenshot(`reveal-${side}.png`);
      for (const region of metadata.regions.filter((r) => r.kind === 'air' && r.side === side)) {
        const glow = await page.evaluate(
          ({ id }) => {
            const v = window.mattress,
              air = v.bundle.air,
              cover = v.bundle.bed.coverReveal.uniforms.revealOpacity,
              opacity = cover.value;
            cover.value = 0;
            v.effects.setHighlight([]);
            v.frame(performance.now());
            const base = window.__fallback.grab();
            v.effects.setHighlight([id]);
            v.frame(performance.now());
            // 以中性白色渲染该路光效，运行时再按充气/放气/保压/故障着色。
            const white = (uniforms) => uniforms?.tint?.value?.setRGB(1, 1, 1);
            for (const row of air.cells?.rows || [])
              if (row.definition.regionId === id)
                for (const object of row.objects) white(object.material.uniforms);
            for (const trace of air.cells?.traces || [])
              if (trace.regionId === id) white(trace.mesh.material.uniforms);
            for (const entry of air.entries)
              if (!entry.cellFx && entry.definition.regionId === id) {
                white(entry.tile.material.uniforms);
                entry.pulse.material.color.setRGB(1, 1, 1);
              }
            v.renderer.render(v.scene, v.activeCamera);
            const lit = window.__fallback.grab(),
              transmit = 1 - opacity,
              { width, height } = lit,
              diff = new ImageData(width, height);
            let minX = width,
              minY = height,
              maxX = -1,
              maxY = -1;
            for (let i = 0; i < width * height; i++) {
              const o = i * 4;
              // 光本身是中性白色；点亮时 3D 会撤掉冷灰的休眠描边，逐通道相减会带出暖色偏差，
              // 因此取三通道均值存为中性灰，颜色在运行时按状态统一着色。
              let sum = 0;
              for (let c = 0; c < 3; c++) sum += Math.max(0, lit.data[o + c] - base.data[o + c]);
              const peak = Math.min(255, Math.round((sum / 3) * transmit));
              diff.data[o] = diff.data[o + 1] = diff.data[o + 2] = 255;
              diff.data[o + 3] = peak;
              if (peak > 2) {
                const x = i % width,
                  y = (i - x) / width;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
              }
            }
            cover.value = opacity;
            v.effects.setHighlight([]);
            if (maxX < 0) return null;
            const pad = 4,
              x = Math.max(0, minX - pad),
              y = Math.max(0, minY - pad),
              w = Math.min(width, maxX + pad + 1) - x,
              h = Math.min(height, maxY + pad + 1) - y,
              crop = new ImageData(w, h);
            for (let row = 0; row < h; row++)
              crop.data.set(
                diff.data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4),
                row * w * 4,
              );
            return { dataUrl: window.__fallback.encode(crop), x, y, width: w, height: h };
          },
          { id: region.id },
        );
        if (!glow) throw new Error(`No adjustment glow captured for ${profile.id} ${region.id}`);
        const image = `glow-${region.id}.png`;
        region.glow = {
          image,
          x: glow.x,
          y: glow.y,
          width: glow.width,
          height: glow.height,
          sha256: await save(image, decode(glow.dataUrl)),
        };
      }
      await page.evaluate((side) => {
        window.mattress.effects.setSideReveal(side, { phase: 'closed' });
        window.mattress.frame(performance.now());
      }, side);
    }
    // 清理已不再对应任何气路的旧光效层。
    const keep = new Set(metadata.regions.filter((r) => r.glow).map((r) => r.glow.image));
    for (const file of await readdir(dir))
      if (file.startsWith('glow-') && !keep.has(file)) await unlink(new URL(file, dir));
    // 与仓库 Prettier 格式一致，重导后 npm run check 不产生格式差异。
    await writeFile(
      new URL('regions.json', dir),
      await format(JSON.stringify(metadata), { parser: 'json' }),
    );
    console.log(
      `Exported ${profile.id}: ${metadata.regions.length} projected regions, ${keep.size} glow layers`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
