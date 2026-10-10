import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { colors } from './tokens';

function Probe() {
  const p = useTheme();
  return <Text testID="probe">{JSON.stringify(p)}</Text>;
}
const palette = (theme?: 'forest') => {
  const view = render(
    <ThemeProvider theme={theme}>
      <Probe />
    </ThemeProvider>,
  );
  const value = JSON.parse(view.getByTestId('probe').props.children);
  view.unmount();
  return value;
};

test('forest changes primary, soft and bg and leaves ink, error and gold alone', () => {
  const base = palette();
  const forest = palette('forest');
  expect(base.primary).toBe(colors.primary);
  expect(forest).toMatchObject({ primary: colors.forestPrimary, soft: colors.forestSoft, bg: colors.forestBg });
  expect(forest).toMatchObject({ ink: base.ink, error: base.error, gold: base.gold });
});

test('without a provider the default palette applies', () => {
  const view = render(<Probe />);
  expect(JSON.parse(view.getByTestId('probe').props.children).primary).toBe(colors.primary);
  view.unmount();
});
