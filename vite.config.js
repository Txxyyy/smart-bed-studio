import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 主页面的二维降级预览按地址加载图片（约 9 MB），不内联进单文件页面，构建时复制到页面旁边。
function copyFallbackAssets() {
  let outDir;
  return {
    name: 'copy-fallback-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await cp('src/fallback-assets', resolve(outDir, 'fallback-assets'), {
        recursive: true,
        filter: (source) => !source.endsWith('.json'),
      });
    },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), copyFallbackAssets()],
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
