import { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { StyleSheet, View } from 'react-native';
import { registry } from './registry';

const styles = StyleSheet.create({ fill: { flex: 1 } });

// The same .ttf files the app bundles; font-family = file base name, as on Android.
const fontFiles = import.meta.glob('../../src/assets/fonts/*.ttf', { query: '?url', import: 'default', eager: true });
const style = document.createElement('style');
style.textContent = Object.entries(fontFiles)
  .map(([file, url]) => `@font-face{font-family:'${file.split('/').pop()!.replace('.ttf', '')}';src:url(${url as string})}`)
  .join('\n');
document.head.appendChild(style);

function Harness() {
  const name = new URLSearchParams(window.location.search).get('screen') ?? '';
  const entry = registry[name];
  // Build the element once: withApp() creates the QueryClient and installs the fetch stub.
  const element = useMemo(() => entry?.(), [entry]);
  useEffect(() => {
    if (!entry) document.body.setAttribute('data-unknown', '1');
    // Fonts load lazily on first use, so touch the weights the app uses before waiting.
    const used = Object.keys(fontFiles).map(f => `16px '${f.split('/').pop()!.replace('.ttf', '')}'`);
    Promise.all(used.map(f => document.fonts.load(f, 'Hồi Máu'))).then(() => document.fonts.ready).then(() => document.body.setAttribute('data-ready', '1'));
  }, [entry]);
  if (!element) {
    return (
      <div className="list">
        <p>{name ? `Unknown screen "${name}".` : 'No ?screen= given.'} Available:</p>
        <ul>
          {Object.keys(registry).map(n => (
            <li key={n}>
              <a href={`?screen=${n}`}>{n}</a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="phone">
      <View style={styles.fill}>{element}</View>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
