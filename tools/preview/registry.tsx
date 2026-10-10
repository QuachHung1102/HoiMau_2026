import type { ReactElement } from 'react';
import App from '../../src/app/App';
import { KitchenSink } from './KitchenSink';

// One line per screen/state: name -> () => element (wrap in providers + fixtures inside the thunk).
export const registry: Record<string, () => ReactElement> = {
  'placeholder-app': () => <App />,
  'kitchen-sink': () => <KitchenSink />,
};
