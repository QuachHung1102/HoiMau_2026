/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../src/app/App';

test('renders the placeholder screen', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('Hồi Máu');
  await ReactTestRenderer.act(() => renderer.unmount());
});
