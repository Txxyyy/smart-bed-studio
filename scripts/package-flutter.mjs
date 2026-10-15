import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ModelRegistry } from '../src/model-profiles.js';
import { RESOURCE_VERSION, BRIDGE_VERSION } from '../src/webview-bridge.js';
const html = await readFile(new URL('../dist/embed/embed.html', import.meta.url), 'utf8');
if (/(?:src|href)=["'](?:https?:|\/src\/)/.test(html))
  throw new Error('嵌入产物仍引用外部脚本或资源');
const dir = new URL('../flutter/smart_mattress_viewer/assets/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('mattress.html', dir), html);
await writeFile(
  new URL('manifest.json', dir),
  JSON.stringify(
    {
      resourceVersion: RESOURCE_VERSION,
      protocolVersion: BRIDGE_VERSION,
      models: new ModelRegistry().list(),
      sha256: createHash('sha256').update(html).digest('hex'),
      runtime: { webgl: 2, chromium: 111, safari: '16.4' },
    },
    null,
    2,
  ) + '\n',
);
// 包内文档由 docs/ 生成，只维护 docs/ 一份；包内没有的文档链接回仓库 docs/。
const pkg = new URL('../flutter/smart_mattress_viewer/', import.meta.url);
const docs = { 'MODEL_SDK_API.md': 'MODEL_SDK_API.md', 'FLUTTER_INTEGRATION.md': 'INTEGRATION.md' };
for (const [source, target] of Object.entries(docs)) {
  const text = await readFile(new URL(`../docs/${source}`, import.meta.url), 'utf8');
  const linked = text.replace(/\]\(([A-Z0-9_]+\.md)\)/g, (match, name) =>
    docs[name] ? `](${docs[name]})` : `](../../docs/${name})`,
  );
  await writeFile(new URL(target, pkg), linked);
}
console.log(`Flutter 模型资源已生成 (${Buffer.byteLength(html)} bytes)`);
