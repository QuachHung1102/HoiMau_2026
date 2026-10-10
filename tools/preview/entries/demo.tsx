import App from '../../../src/app/App';
import type { Entries } from '../harness';
import { KitchenSink } from '../KitchenSink';

export const entries: Entries = {
  'placeholder-app': () => <App />,
  'kitchen-sink': () => <KitchenSink />,
};
