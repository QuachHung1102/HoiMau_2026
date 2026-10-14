import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

// jest.setup.js hands query notifications to React inside act(): a read that finishes after the last await of a test
// (the stand-up reminder reads the day in every onboarded shell) is a normal update, not an act() complaint.
function Reader() {
  const { data } = useQuery({ queryKey: ['late'], queryFn: () => new Promise<string>(resolve => setTimeout(() => resolve('landed'), 20)) });
  return <Text>{data ?? 'waiting'}</Text>;
}

test('a read that lands after the test\'s last await re-renders without an act() complaint', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Reader />
    </QueryClientProvider>,
  );
  expect(screen.getByText('waiting')).toBeTruthy();
  // a plain timer, outside act() and outside testing-library's own waiting: the answer and its notification land here
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(errors.mock.calls.map(call => String(call[0]))).toEqual([]);
  expect(screen.getByText('landed')).toBeTruthy();
  view.unmount();
  client.clear();
  errors.mockRestore();
});
