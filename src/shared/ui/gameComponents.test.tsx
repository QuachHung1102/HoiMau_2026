import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, AppState, Text } from 'react-native';
import { formatNumber } from '../i18n/vi/pet';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { colors } from '../theme/tokens';
import { CoinChip, FrostDot, LockChip, OfflineBadge, OwnedChip, RewardChip, StreakChip } from './Badges';
import { LevelStrip, ProgressBar } from './LevelStrip';
import { MilestoneBadge } from './MilestoneBadge';
import { ProgressRing } from './ProgressRing';
import { StatBar } from './StatBar';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const wrap = (node: React.ReactElement, motion: 'REDUCED' | 'FULL' = 'REDUCED') => (
  <MotionPreferenceProvider value={motion}>{node}</MotionPreferenceProvider>
);
const painted = (view: ReturnType<typeof render>) => JSON.stringify(view.toJSON());
const flameColours = [colors.flame, colors.flameSoft];
const goldColours = [colors.gold, colors.goldSoft];
const uses = (text: string, list: string[]) => list.some(c => text.includes(c));

test.each([
  [0, '0'],
  [999, '999'],
  [1118, '1.118'],
  [12000, '12.000'],
  [1234567, '1.234.567'],
])('formatNumber(%d) is "%s" (Vietnamese thousands separator)', (n, text) => {
  expect(formatNumber(n)).toBe(text);
});

describe('StatBar', () => {
  test.each([
    ['hp', 'Sức sống'],
    ['en', 'Năng lượng'],
    ['str', 'Sức mạnh'],
    ['spd', 'Sức bền'],
  ] as const)('%s is a progress bar labelled "%s" with its number as text', (kind, label) => {
    const view = render(wrap(<StatBar kind={kind} value={26} />));
    expect(view.getByText(label)).toBeTruthy();
    expect(view.getByText('26/100')).toBeTruthy();
    const bar = view.getByRole('progressbar', { name: label });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 26 });
    view.unmount();
  });

  test.each([
    [140, 100],
    [-5, 0],
    [Number.NaN, 0],
  ])('value %d clamps to %d', (value, shown) => {
    const view = render(wrap(<StatBar kind="hp" value={value} />));
    expect(view.getByText(`${shown}/100`)).toBeTruthy();
    expect(view.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: shown });
    view.unmount();
  });
});

describe('ProgressBar and LevelStrip', () => {
  test('ProgressBar shows its label as text and exposes min, max, now', () => {
    const view = render(wrap(<ProgressBar value={64} max={100} label="64% tới Chồi non" />));
    expect(view.getByText('64% tới Chồi non')).toBeTruthy();
    expect(view.getByRole('progressbar', { name: '64% tới Chồi non' }).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 64 });
    view.unmount();
  });

  test('ProgressBar keeps now inside the range', () => {
    const view = render(wrap(<ProgressBar value={500} max={300} label="x" />));
    expect(view.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 300, now: 300 });
    view.unmount();
  });

  test('the fill animates for 450 ms when the value changes, not on mount', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = render(wrap(<ProgressBar value={26} max={100} label="a" />, 'FULL'));
    expect(timing).not.toHaveBeenCalled();
    view.rerender(wrap(<ProgressBar value={31} max={100} label="a" />, 'FULL'));
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 450, useNativeDriver: true }));
    view.unmount();
  });

  test('under reduced motion the fill is drawn at its final length with no animation', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = render(wrap(<ProgressBar value={26} max={100} label="a" />));
    view.rerender(wrap(<ProgressBar value={31} max={100} label="a" />));
    expect(timing).not.toHaveBeenCalled();
    expect(painted(view)).toContain('"width":"31%"');
    view.unmount();
  });

  test('LevelStrip shows "Cấp 5 · Người kiên trì" and "340 / 1.118 XP", and never the coin colour', () => {
    const view = render(wrap(<LevelStrip level={5} title="Người kiên trì" xpIntoLevel={340} xpForNextLevel={1118} />));
    expect(view.getByText('Cấp 5 · Người kiên trì')).toBeTruthy();
    expect(view.getByText('340 / 1.118 XP')).toBeTruthy();
    expect(view.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 1118, now: 340 });
    expect(view.queryByRole('button')).toBeNull();
    expect(uses(painted(view), goldColours)).toBe(false);
    view.unmount();
  });

  test('LevelStrip with onPress is one button that names the level and the XP', () => {
    const onPress = jest.fn();
    const view = render(wrap(<LevelStrip level={5} title="Người kiên trì" xpIntoLevel={340} xpForNextLevel={1118} onPress={onPress} />));
    fireEvent.press(view.getByRole('button', { name: 'Cấp 5 · Người kiên trì. 340 / 1.118 XP' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe('chips', () => {
  test('CoinChip shows "250 xu" in the coin colours', () => {
    const view = render(wrap(<CoinChip coin={250} />));
    expect(view.getByText('250 xu')).toBeTruthy();
    expect(painted(view)).toContain(colors.gold);
    expect(painted(view)).toContain(colors.goldSoft);
    view.unmount();
  });

  test('CoinChip groups thousands', () => {
    const view = render(wrap(<CoinChip coin={12000} />));
    expect(view.getByText('12.000 xu')).toBeTruthy();
    view.unmount();
  });

  test('CoinChip counts up to a new balance over 600 ms; the label for screen readers is the final value at once', () => {
    jest.useFakeTimers();
    const view = render(wrap(<CoinChip coin={250} />, 'FULL'));
    view.rerender(wrap(<CoinChip coin={300} />, 'FULL'));
    expect(view.getByLabelText('300 xu')).toBeTruthy();
    expect(view.queryByText('300 xu')).toBeNull();
    act(() => jest.advanceTimersByTime(700));
    expect(view.getByText('300 xu')).toBeTruthy();
    view.unmount();
  });

  test('CoinChip shows a new balance at once under reduced motion', () => {
    const view = render(wrap(<CoinChip coin={250} />));
    view.rerender(wrap(<CoinChip coin={300} />));
    expect(view.getByText('300 xu')).toBeTruthy();
    view.unmount();
  });

  test('StreakChip renders nothing for 2 days', () => {
    const view = render(wrap(<StreakChip days={2} />));
    expect(view.toJSON()).toBeNull();
    view.unmount();
  });

  test('StreakChip shows "3 ngày" for 3 days, in the flame colours', () => {
    const view = render(wrap(<StreakChip days={3} />));
    expect(view.getByText('3 ngày')).toBeTruthy();
    expect(painted(view)).toContain(colors.flame);
    expect(painted(view)).toContain(colors.flameSoft);
    view.unmount();
  });

  test('the streak flame does not loop under reduced motion', () => {
    const loop = jest.spyOn(Animated, 'loop');
    const view = render(wrap(<StreakChip days={4} />));
    expect(loop).not.toHaveBeenCalled();
    view.unmount();
  });

  test('the streak flame loops every 2000 ms and stops on unmount and in the background', () => {
    let onChange: (state: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
      onChange = cb;
      return { remove: jest.fn() };
    }) as never);
    const stop = jest.fn();
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
    const timing = jest.spyOn(Animated, 'timing');
    const view = render(wrap(<StreakChip days={4} />, 'FULL'));
    expect(loop).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 2000, useNativeDriver: true }));
    act(() => onChange('background'));
    expect(stop).toHaveBeenCalledTimes(1);
    act(() => onChange('active'));
    expect(loop).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  test('RewardChip, LockChip and OwnedChip say their state in words, without flame or gold', () => {
    const view = render(
      wrap(
        <>
          <RewardChip text="+50 XP" />
          <LockChip minLevel={8} />
          <OwnedChip equipped={false} />
          <OwnedChip equipped />
        </>,
      ),
    );
    expect(view.getByText('+50 XP')).toBeTruthy();
    expect(view.getByText('Cấp 8')).toBeTruthy();
    expect(view.getByText('Đã sở hữu')).toBeTruthy();
    expect(view.getByText('Đang dùng')).toBeTruthy();
    expect(uses(painted(view), [...flameColours, ...goldColours])).toBe(false);
    view.unmount();
  });

  test('FrostDot shows "Đã dùng vé" in the frost colours; compact keeps the words for screen readers', () => {
    const view = render(wrap(<FrostDot />));
    expect(view.getByText('Đã dùng vé')).toBeTruthy();
    expect(painted(view)).toContain(colors.frost);
    view.unmount();
    const compact = render(wrap(<FrostDot compact />));
    expect(compact.queryByText('Đã dùng vé')).toBeNull();
    expect(compact.getByLabelText('Đã dùng vé')).toBeTruthy();
    compact.unmount();
  });

  test('OfflineBadge counts what is waiting, and renders nothing when the queue is empty', () => {
    const view = render(wrap(<OfflineBadge count={2} />));
    expect(view.getByText('2 ghi nhận đang chờ gửi')).toBeTruthy();
    view.unmount();
    const empty = render(wrap(<OfflineBadge count={0} />));
    expect(empty.toJSON()).toBeNull();
    empty.unmount();
  });
});

describe('ProgressRing', () => {
  test('is a progress bar from 0 to 100 and shows its children', () => {
    const view = render(
      wrap(
        <ProgressRing progress={0.634} accessibilityLabel="Thời gian còn lại">
          <Text>08:42</Text>
        </ProgressRing>,
      ),
    );
    expect(view.getByRole('progressbar', { name: 'Thời gian còn lại' }).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 63 });
    expect(view.getByText('08:42')).toBeTruthy();
    view.unmount();
  });

  test('without children it shows the percentage as text; progress clamps to 0-1', () => {
    const view = render(wrap(<ProgressRing progress={0.5} />));
    expect(view.getByText('50%')).toBeTruthy();
    view.rerender(wrap(<ProgressRing progress={1.4} />));
    expect(view.getByText('100%')).toBeTruthy();
    view.rerender(wrap(<ProgressRing progress={-1} />));
    expect(view.getByText('0%')).toBeTruthy();
    view.unmount();
  });
});

describe('MilestoneBadge', () => {
  test('achieved: "Đã đạt" in the flame colours', () => {
    const view = render(wrap(<MilestoneBadge days={7} achieved />));
    expect(view.getByText('7 ngày')).toBeTruthy();
    expect(view.getByText('Đã đạt')).toBeTruthy();
    expect(view.getByLabelText('7 ngày. Đã đạt')).toBeTruthy();
    expect(painted(view)).toContain(colors.flame);
    view.unmount();
  });

  test('not achieved with a distance: "Còn 26 ngày", white with a line border, no flame', () => {
    const view = render(wrap(<MilestoneBadge days={30} achieved={false} remaining={26} />));
    expect(view.getByText('30 ngày')).toBeTruthy();
    expect(view.getByText('Còn 26 ngày')).toBeTruthy();
    expect(view.queryByText('Đã đạt')).toBeNull();
    expect(view.getByLabelText('30 ngày. Còn 26 ngày')).toBeTruthy();
    const json = painted(view);
    expect(uses(json, flameColours)).toBe(false);
    expect(json).toContain(`"backgroundColor":"${colors.white}","borderColor":"${colors.line}"`);
    view.unmount();
  });

  test('not achieved without a distance: "Chưa đạt"', () => {
    const view = render(wrap(<MilestoneBadge days={100} achieved={false} />));
    expect(view.getByText('Chưa đạt')).toBeTruthy();
    view.unmount();
  });
});
