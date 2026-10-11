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

// Jest's AppState mock has no real state (currentState is a jest.fn), so tests set it and put it back.
const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
const setAppState = (state: string) => {
  mockedAppState.currentState = state;
};
afterEach(() => setAppState(appStateAtLoad as string));

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
  [Number.NaN, '0'],
  [Number.POSITIVE_INFINITY, '0'],
])('formatNumber(%d) is "%s" (Vietnamese thousands separator; never "NaN")', (n, text) => {
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

  test.each([
    ['value above max', 500, 300, { min: 0, max: 300, now: 300 }, '100%'],
    ['negative value', -5, 300, { min: 0, max: 300, now: 0 }, '0%'],
    ['value NaN', Number.NaN, 300, { min: 0, max: 300, now: 0 }, '0%'],
    ['value Infinity', Number.POSITIVE_INFINITY, 300, { min: 0, max: 300, now: 300 }, '100%'],
    ['max NaN', 5, Number.NaN, { min: 0, max: 0, now: 0 }, '0%'],
    ['max negative', 5, -3, { min: 0, max: 0, now: 0 }, '0%'],
    ['max 0', 5, 0, { min: 0, max: 0, now: 0 }, '0%'],
    ['max Infinity', 5, Number.POSITIVE_INFINITY, { min: 0, max: 0, now: 0 }, '0%'],
  ] as const)('ProgressBar with %s reports finite numbers and draws a matching fill', (_, value, max, reported, width) => {
    const view = render(wrap(<ProgressBar value={value} max={max} label="x" />));
    const got = view.getByRole('progressbar').props.accessibilityValue;
    expect(got).toEqual(reported);
    expect(Object.values(got).every(n => Number.isFinite(n))).toBe(true);
    expect(painted(view)).toContain(`"width":"${width}"`);
    view.unmount();
  });

  test.each([
    ['XP above the level size', 2000, 1118, '1.118 / 1.118 XP', { min: 0, max: 1118, now: 1118 }],
    ['XP NaN', Number.NaN, 1118, '0 / 1.118 XP', { min: 0, max: 1118, now: 0 }],
    ['level size NaN', 340, Number.NaN, '0 / 0 XP', { min: 0, max: 0, now: 0 }],
    ['level size negative', 340, -3, '0 / 0 XP', { min: 0, max: 0, now: 0 }],
  ] as const)('LevelStrip with %s writes the same clamped numbers it reports', (_, xp, size, text, reported) => {
    const onPress = jest.fn();
    const view = render(wrap(<LevelStrip level={5} title="Người kiên trì" xpIntoLevel={xp} xpForNextLevel={size} onPress={onPress} />));
    expect(view.getByText(text)).toBeTruthy();
    expect(view.getByRole('button', { name: `Cấp 5 · Người kiên trì. ${text}` })).toBeTruthy();
    expect(view.UNSAFE_getByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue).toEqual(reported);
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
    setAppState('active');
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

  test('without children it shows the percentage as text', () => {
    const view = render(wrap(<ProgressRing progress={0.5} />));
    expect(view.getByText('50%')).toBeTruthy();
    view.unmount();
  });

  test.each([
    [1.4, 100],
    [Number.POSITIVE_INFINITY, 100],
    [-1, 0],
    [Number.NaN, 0],
  ])('progress %d is drawn and reported as %d%%, with a finite arc', (progress, percent) => {
    const view = render(wrap(<ProgressRing progress={progress} />));
    expect(view.getByText(`${percent}%`)).toBeTruthy();
    expect(view.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 100, now: percent });
    // The arc: dash offset = circumference x (1 - progress). JSON prints both 0 and NaN as null, so compare the number.
    const [, dash, offset] = /"strokeDasharray":\["([\d.]+)","[\d.]+"\],"strokeDashoffset":(null|[\d.]+)/.exec(painted(view)) ?? [];
    expect(Number(dash)).toBeGreaterThan(0);
    expect(offset === 'null' ? 0 : Number(offset)).toBeCloseTo(Number(dash) * (1 - percent / 100));
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
