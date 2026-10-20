// 网页预览使用的二维降级资源：元数据随脚本打包，图片按地址加载。
// 开发服务器直接读取 src/fallback-assets；npm run build 时由 vite.config.js 复制到 dist/fallback-assets。
const metadataByPath = import.meta.glob('./fallback-assets/*/regions.json', {
  eager: true,
  import: 'default',
});
const ROOT = import.meta.env.DEV ? '/src/fallback-assets/' : './fallback-assets/';

/** @returns {{ metadata: object, assets: object } | null} 型号没有二维资源时返回 null */
export function fallbackWebAssets(modelId) {
  const metadata = metadataByPath[`./fallback-assets/${modelId}/regions.json`];
  if (!metadata) return null;
  const url = (file) => `${ROOT}${modelId}/${file}`;
  return {
    metadata,
    assets: {
      base: url('base.png'),
      reveal: { left: url('reveal-left.png'), right: url('reveal-right.png') },
      glow: Object.fromEntries(
        metadata.regions
          .filter((region) => region.kind === 'air' && region.glow)
          .map((region) => [region.id, url(region.glow.image)]),
      ),
    },
  };
}
