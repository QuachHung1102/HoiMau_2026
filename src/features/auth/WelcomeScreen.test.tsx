import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, AppState, Text } from 'react-native';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { WelcomeScreen } from './WelcomeScreen';

const Stack = createNativeStackNavigator();
const SignUp = () => <Text>stub SignUp</Text>;
const SignIn = () => <Text>stub SignIn</Text>;

const welcome = (motion: 'REDUCED' | 'FULL' = 'REDUCED') => (
  <MotionPreferenceProvider value={motion}>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Welcome" component={WelcomeScreen as never} />
        <Stack.Screen name="SignUp" component={SignUp} />
        <Stack.Screen name="SignIn" component={SignIn} />
      </Stack.Navigator>
    </NavigationContainer>
  </MotionPreferenceProvider>
);

// Jest's AppState mock has no real state; the motion tests put the app in the foreground and put the mock back.
const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
afterEach(() => {
  mockedAppState.currentState = appStateAtLoad;
  jest.restoreAllMocks();
});

test('S01 shows the product name, the habit loop and the two ways in', () => {
  render(welcome());
  expect(screen.getByRole('header', { name: 'Hồi Máu' })).toBeTruthy();
  expect(screen.getByText('Mỗi ngày, một chút tốt hơn.')).toBeTruthy();
  expect(screen.getByText('Thói quen nhỏ.\nHành trình của riêng bạn.')).toBeTruthy();
  expect(screen.getByText('Ghi lại việc bạn đã làm, nuôi dưỡng Mầm và cùng bạn bè giữ nhịp mỗi ngày.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tôi đã có tài khoản' })).toBeTruthy();
  // the notice of a deleted account is for the one run that follows the deletion (DeleteAccountScreen.test.tsx)
  expect(screen.queryByText('Tài khoản đã được đóng.')).toBeNull();
});

test('"Bắt đầu hành trình" opens SignUp', async () => {
  render(welcome());
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu hành trình' }));
  expect(await screen.findByText('stub SignUp')).toBeTruthy();
});

test('"Tôi đã có tài khoản" opens SignIn', async () => {
  render(welcome());
  fireEvent.press(screen.getByRole('button', { name: 'Tôi đã có tài khoản' }));
  expect(await screen.findByText('stub SignIn')).toBeTruthy();
});

test('Mầm is a decorative picture: no image is announced, the text carries the message', () => {
  render(welcome());
  expect(screen.queryAllByRole('image')).toEqual([]);
});

test('Mầm idles while the screen is focused and stands still under reduced motion', () => {
  mockedAppState.currentState = 'active';
  const loop = jest.spyOn(Animated, 'loop');
  render(welcome('FULL'));
  expect(loop).toHaveBeenCalledTimes(1);
  screen.unmount();
  loop.mockClear();
  render(welcome('REDUCED'));
  expect(loop).not.toHaveBeenCalled();
});

test('Mầm stops idling when another screen covers Welcome', async () => {
  mockedAppState.currentState = 'active';
  const stop = jest.fn();
  jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
  render(welcome('FULL'));
  expect(stop).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu hành trình' }));
  await screen.findByText('stub SignUp');
  expect(stop).toHaveBeenCalled();
});
