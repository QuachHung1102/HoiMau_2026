// Dev-only preview: renders src/ with react-native-web. Never imported by the app.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const exts = ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

// Metro-style `require('./x.png')` in app code becomes the URL of the file (Metro gives an image source; react-native-web takes a URL).
const imageRequire = {
  name: 'rn-image-require',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.tsx?$/.test(id) || !/require\(\s*['"][^'"]+\.png['"]\s*\)/.test(code)) return null;
    return code.replace(/require\(\s*(['"])([^'"]+\.png)\1\s*\)/g, (_match, quote, file) => `new URL(${quote}${file}${quote}, import.meta.url).href`);
  },
};

export default {
  plugins: [imageRequire],
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
      { find: /^\.\/NativeHoiMauNative$/,replacement: path.join(here, 'stubs/native-hoi-mau.ts') },
    ],
  },
  optimizeDeps: { rolldownOptions: { resolve: { extensions: exts } } },
  server: { fs: { allow: [repo] } },
};
