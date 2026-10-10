import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

test('RNTL renders and finds text by role', () => {
  render(<Text role="heading">Hồi Máu</Text>);
  expect(screen.getByRole('heading', { name: 'Hồi Máu' })).toBeTruthy();
});

test('Jest does not collect server/ or domain/ tests', () => {
  const config = jest.requireActual('../jest.config.js');
  expect(config.testPathIgnorePatterns).toEqual(
    expect.arrayContaining(['/server/', '/domain/']),
  );
  expect(config.modulePathIgnorePatterns).toContain('<rootDir>/server/');
});
