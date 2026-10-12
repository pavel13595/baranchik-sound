import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';
import packageJson from './package.json';

export default defineConfig({
  base: './',
  define: {
    __APP_NAME__: JSON.stringify('Baranchik Sound'),
    __BUILD_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    legacy({
      targets: ['ios >= 12', 'safari >= 12', 'chrome >= 70'],
      renderModernChunks: false,
      polyfills: true,
      modernPolyfills: true,
    }),
    {
      name: 'explicit-es2015-build-target',
      enforce: 'post',
      config: () => ({ build: { target: 'es2015' } }),
    },
  ],
  build: {
    minify: 'terser',
  },
});
