import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ModelRegistry } from '../src/model-profiles.js';
import { RESOURCE_VERSION, BRIDGE_VERSION } from '../src/webview-bridge.js';
import { exportCatalog } from './export-model-catalog.mjs';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('dist/embed/embed.html', root), 'utf8');
if (/(?:src|href)=["'](?:https?:|\/src\/)/.test(html))
  throw new Error('嵌入产物仍引用外部脚本或资源');
const dir = new URL('flutter/smart_mattress_viewer/assets/', root);
await mkdir(dir, { recursive: true });
await writeFile(new URL('mattress.html', dir), html);
const catalog = await exportCatalog();
const paths = ['mattress.html', 'models/catalog.json'];
for (const model of catalog.models) {
  await mkdir(new URL(`fallback/${model.id}/`, dir), { recursive: true });
  for (const file of ['base.png', 'reveal-left.png', 'reveal-right.png', 'regions.json']) {
    const path = `fallback/${model.id}/${file}`;
    await copyFile(new URL(`src/fallback-assets/${model.id}/${file}`, root), new URL(path, dir));
    paths.push(path);
  }
}
const files = [];
for (const path of paths) {
  const data = await readFile(new URL(path, dir));
  files.push({ path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const runtime = { webgl: 2, chromium: 111, safari: '16.4' };
await writeFile(
  new URL('manifest.json', dir),
  JSON.stringify(
    {
      resourceVersion: RESOURCE_VERSION,
      protocolVersion: BRIDGE_VERSION,
      fallbackSchemaVersion: 1,
      catalogSchemaVersion: 1,
      models: new ModelRegistry().list(),
      sha256: files[0].sha256,
      runtime,
      renderers: {
        threeD: { runtime, presentationBarrier: true },
        twoD: { native: true, webview: false },
        staticImage: { native: true, webview: false, dynamicEffects: false },
      },
      files,
    },
    null,
    2,
  ) + '\n',
);
const fixtureDir = new URL('flutter/smart_mattress_viewer/test/fixtures/', root);
await mkdir(fixtureDir, { recursive: true });
await copyFile(
  new URL('src/fallback-contract-fixtures/canonical.json', root),
  new URL('canonical.json', fixtureDir),
);
const documents = {
  'FLUTTER_INTEGRATION.md': 'INTEGRATION.md',
  'MODEL_SDK_API.md': 'MODEL_SDK_API.md',
  'RENDER_FALLBACK.md': 'RENDER_FALLBACK.md',
  'FALLBACK_ASSETS.md': 'FALLBACK_ASSETS.md',
  'PERFORMANCE.md': 'PERFORMANCE.md',
};
for (const [source, target] of Object.entries(documents)) {
  const text = await readFile(new URL(`docs/${source}`, root), 'utf8');
  const standalone = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (original, label, url) => {
    if (/^(https?:|mailto:|#)/.test(url)) return original;
    const [path, anchor] = url.split('#'),
      name = path.split('/').pop();
    if (documents[name]) return `[${label}](${documents[name]}${anchor ? '#' + anchor : ''})`;
    if (name === 'README.md') return `[${label}](README.md${anchor ? '#' + anchor : ''})`;
    if (name === 'VALIDATION.md') return `[${label}](VALIDATION.md${anchor ? '#' + anchor : ''})`;
    return `${label}（仓库路径：\`${path.startsWith('../') ? path.slice(3) : 'docs/' + path}\`）`;
  });
  await writeFile(new URL(`flutter/smart_mattress_viewer/${target}`, root), standalone);
}
console.log(
  `Flutter resources ${RESOURCE_VERSION}: ${files.length} files, ${files.reduce((n, f) => n + f.bytes, 0)} bytes; documentation synchronized`,
);
