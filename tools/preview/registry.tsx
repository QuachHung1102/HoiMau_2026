import type { Entries } from './harness';

// Each feature owns tools/preview/entries/<feature>.tsx exporting `entries`; nothing to edit here.
const modules = import.meta.glob<{ entries: Entries }>('./entries/*.tsx', { eager: true });

export const registry: Entries = {};
for (const [file, module] of Object.entries(modules)) {
  for (const [name, entry] of Object.entries(module.entries)) {
    if (name in registry) throw new Error(`Duplicate preview entry "${name}" (second definition in ${file})`);
    registry[name] = entry;
  }
}
