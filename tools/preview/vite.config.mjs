// Dev-only preview: renders src/ with react-native-web. Never imported by the app.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const exts = ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

export default {
  root: here,
  cacheDir: path.join(repo, 'node_modules/.vite-preview'),
  logLevel: 'warn',
  define: { __DEV__: 'true', global: 'globalThis' },
  resolve: {
    extensions: exts,
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      // Native-only modules -> in-memory stubs (app code stays untouched).
      { find: /^react-native-keychain$/, replacement: path.join(here, 'stubs/keychain.ts') },
      { find: '@react-native/assets-registry/registry', replacement: path.join(here, 'stubs/assets-registry.ts') },
    ],
  },
  optimizeDeps: { rolldownOptions: { resolve: { extensions: exts } } },
  server: { fs: { allow: [repo] } },
};
