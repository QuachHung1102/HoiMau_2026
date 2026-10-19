import { fireEvent, render, screen } from '@testing-library/react-native';
import type { GuildMember } from '../../../domain/contract/social.ts';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { MemberRow } from './MemberRow';

const member = (more: Partial<GuildMember> = {}): GuildMember => ({
  userId: '00000000-0000-4000-9000-000000000002',
  displayName: 'Minh',
  level: 3,
  role: 'MEMBER',
  isMe: false,
  daysCompletedThisWeek: 4,
  daysCountedThisWeek: 7,
  storyDoneToday: false,
  nudge: { allowed: true, reason: null },
  ...more,
});
const draw = (row: GuildMember, onNudge = jest.fn()) => {
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <MemberRow member={row} onNudge={onNudge} />
    </MotionPreferenceProvider>,
  );
  return { view, onNudge };
};
const texts = () => JSON.stringify(screen.toJSON());

describe('MemberRow', () => {
  test('a member who can be nudged: name, "Cấp L · d/c ngày · có thể nhắc", one button that calls onNudge', () => {
    const { view, onNudge } = draw(member());
    expect(screen.getByText('Minh')).toBeTruthy();
    expect(screen.getByText('Cấp 3 · 4/7 ngày · có thể nhắc')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Minh. Cấp 3 · 4/7 ngày · có thể nhắc' }));
    expect(onNudge).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test.each([
    ['NUDGE_RECEIVER_MUTED', 'Đã tắt nhận nhắc nhở'],
    ['NUDGE_NOT_NEEDED', 'Đã xong việc chính hôm nay, không cần nhắc'],
    ['NUDGE_OUTSIDE_WINDOW', 'Chỉ nhắc được từ 12:00 đến 20:00 theo giờ của bạn ấy'],
    ['NUDGE_RECEIVER_LIMIT', 'Hôm nay bạn ấy đã được nhắc rồi'],
    ['NUDGE_SENDER_LIMIT', 'Hôm nay bạn đã nhắc đủ số lần rồi'],
    ['NOT_IN_GUILD', 'Chưa nhắc được lúc này'],
    ['NUDGE_NOT_SAME_GUILD', 'Chưa nhắc được lúc này'],
  ] as const)('refused with %s: the reason in words in the row, and no button at all', (reason, words) => {
    const { view, onNudge } = draw(member({ nudge: { allowed: false, reason: reason as GuildMember['nudge']['reason'] } }));
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.press(screen.getByText('Minh'));
    fireEvent.press(screen.getByText(words));
    expect(onNudge).not.toHaveBeenCalled();
    view.unmount();
  });

  test('a member who is done today says so and needs no reason; not a button either', () => {
    const { view, onNudge } = draw(member({ storyDoneToday: true, nudge: { allowed: false, reason: 'NUDGE_NOT_NEEDED' } }));
    expect(screen.getByText('Cấp 3 · 4/7 ngày · đã xong hôm nay')).toBeTruthy();
    expect(screen.queryByText('Đã xong việc chính hôm nay, không cần nhắc')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.press(screen.getByText('Minh'));
    expect(onNudge).not.toHaveBeenCalled();
    view.unmount();
  });

  test('the own row is "An · bạn" with no nudge affordance and no reason, whatever the flags say', () => {
    const { view, onNudge } = draw(member({ displayName: 'An', isMe: true, level: 5, daysCompletedThisWeek: 6, nudge: { allowed: false, reason: null } }));
    expect(screen.getByText('An · bạn')).toBeTruthy();
    expect(screen.getByText('Cấp 5 · 6/7 ngày')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Chưa nhắc được lúc này')).toBeNull();
    fireEvent.press(screen.getByText('An · bạn'));
    expect(onNudge).not.toHaveBeenCalled();
    view.unmount();
    // even a row that claims to be allowed is not a nudge to oneself
    const second = draw(member({ displayName: 'An', isMe: true, nudge: { allowed: true, reason: null } }));
    expect(screen.queryByRole('button')).toBeNull();
    second.view.unmount();
  });

  test('the done own row says "đã xong hôm nay"', () => {
    const { view } = draw(member({ displayName: 'An', isMe: true, storyDoneToday: true, nudge: { allowed: false, reason: null } }));
    expect(screen.getByText('Cấp 3 · 4/7 ngày · đã xong hôm nay')).toBeTruthy();
    view.unmount();
  });
});

describe('a member row has no measurement of anyone', () => {
  test('the props have no weight, height or calories: tsc refuses them', () => {
    const none = () => undefined;
    const keep = (element: unknown) => element;
    // @ts-expect-error a member row takes no weight prop
    keep(<MemberRow member={member()} weightKg={77.7} onNudge={none} />);
    // @ts-expect-error nor a height prop
    keep(<MemberRow member={member()} heightCm={177.7} onNudge={none} />);
    // @ts-expect-error nor calories
    keep(<MemberRow member={member()} caloriesIn={1650} onNudge={none} />);
    // @ts-expect-error and the member it takes has no measurement field
    keep(<MemberRow member={{ ...member(), weightKg: 77.7 }} onNudge={none} />);
  });

  test('a member object that carries them anyway is drawn without any of them', () => {
    const leaky = { ...member(), weightKg: 77.7, heightCm: 177.7, caloriesIn: 9876, calorieTarget: 8765, bmr: 1666.5, tdee: 2555.5 };
    const { view } = draw(leaky as unknown as GuildMember);
    const drawn = texts();
    for (const sentinel of ['77.7', '177.7', '9876', '8765', '1666.5', '2555.5']) expect(drawn).not.toContain(sentinel);
    const words = screen
      .queryAllByText(/.*/)
      .map(node => String(node.props.children))
      .join(' | ');
    expect(words).not.toMatch(/kcal|calo|\bkg\b|\bcm\b|cân nặng|chiều cao|BMR|TDEE/i);
    view.unmount();
  });
});
