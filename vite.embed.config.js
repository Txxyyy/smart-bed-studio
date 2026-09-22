import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  plugins:[viteSingleFile()],base:'./',
  build:{outDir:'dist/embed',target:['chrome111','safari16.4'],chunkSizeWarningLimit:1500,rollupOptions:{input:'embed.html'}},
});
