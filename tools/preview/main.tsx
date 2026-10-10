import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { StyleSheet, View } from 'react-native';
import { registry } from './registry';

const styles = StyleSheet.create({ fill: { flex: 1 } });

function Harness() {
  const name = new URLSearchParams(window.location.search).get('screen') ?? '';
  const Screen = registry[name];
  useEffect(() => {
    if (!Screen) document.body.setAttribute('data-unknown', '1');
    document.fonts.ready.then(() => document.body.setAttribute('data-ready', '1'));
  }, [Screen]);
  if (!Screen) {
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
      <View style={styles.fill}><Screen /></View>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
