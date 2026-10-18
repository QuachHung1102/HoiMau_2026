import { fireEvent, screen } from '@testing-library/react-native';
import { fetchMock, installTodayTestEnv, landed, openPet, refuse, setPet, world } from '../shop/shopTestKit';

installTodayTestEnv();

const HEADER = (name: string) => screen.getByRole('header', { name });
const petReads = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/pet')).length;

describe('S22: Mầm', () => {
  test('the stage, the percent and the mood of the server; the way to the stages, the inventory and the shop', async () => {
    const view = await openPet();
    expect(HEADER('Mầm của bạn')).toBeTruthy();
    expect(screen.getByText('Người bạn nhỏ trên một hành trình dài.')).toBeTruthy();
    // the stage chip, and the bar with its words and numbers
    expect(screen.getAllByText('Mầm nhú').length).toBeGreaterThan(0);
    const bar = screen.getByRole('progressbar', { name: '64% tới Chồi non' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 64 });
    expect(HEADER('Mầm đang vui')).toBeTruthy();
    expect(screen.getByText('Những ngày bạn chăm sóc mình cũng nuôi lớn Mầm. Tiến hóa đã đạt sẽ không mất đi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Hành trình lớn lên/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đổi diện mạo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ghé cửa hàng' })).toBeTruthy();
    // the tired action belongs to S70 only
    expect(screen.queryByRole('button', { name: 'Chọn một việc nhỏ' })).toBeNull();
    view.unmount();
  });

  test('the mood is its own line: a NEUTRAL Mầm is "bình thường", whatever the stage', async () => {
    setPet({ mood: 'NEUTRAL' });
    const view = await openPet();
    expect(HEADER('Mầm đang bình thường')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '64% tới Chồi non' })).toBeTruthy();
    view.unmount();
  });

  test('MYTHIC has nothing left to grow into: "Đã lớn hết cỡ", a full bar', async () => {
    setPet({ stage: 'MYTHIC', stageIndex: 4, growthPercent: 100, nextStage: null });
    const view = await openPet();
    const bar = screen.getByRole('progressbar', { name: 'Đã lớn hết cỡ' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    expect(screen.getAllByText('Cây huyền thoại').length).toBeGreaterThan(0);
    expect(screen.queryByText(/tới /)).toBeNull();
    view.unmount();
  });

  test('"Hành trình lớn lên", "Đổi diện mạo" and "Ghé cửa hàng" go to their screens', async () => {
    const view = await openPet();
    fireEvent.press(screen.getByRole('button', { name: /^Hành trình lớn lên/ }));
    expect(await screen.findByRole('header', { name: 'Hành trình lớn lên' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Đổi diện mạo' }));
    expect(await screen.findByRole('header', { name: 'Kho đồ của bạn' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Ghé cửa hàng' }));
    expect(await screen.findByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    view.unmount();
  });

  test('GET /pet cannot be had: the profile has the same Mầm, so the screen stays; with neither, the error state and "Thử lại"', async () => {
    world.answer = request => (request === 'GET /pet' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openPet();
    expect(HEADER('Mầm đang vui')).toBeTruthy();
    view.unmount();

    world.me = { ...world.me, pet: null };
    const second = await openPet();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    world.answer = undefined;
    world.me = { ...world.me, pet: { stage: 'HATCHLING', stageIndex: 1, growthPercent: 64, mood: 'HAPPY', skinCode: 'SKIN_DEFAULT', nextStage: 'JUVENILE' } };
    const reads = petReads();
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Mầm đang vui' })).toBeTruthy();
    expect(petReads()).toBe(reads + 1);
    second.unmount();
  });
});

describe('S70: Mầm is tired', () => {
  test('a sleepy Mầm, the sentence that waits for the person, ONE action; the stage is unchanged and nobody is blamed', async () => {
    setPet({ mood: 'TIRED' });
    const view = await openPet();
    expect(HEADER('Mầm hơi buồn ngủ, đang chờ bạn quay lại')).toBeTruthy();
    expect(screen.getByText('Mầm vẫn ở đây. Một việc nhỏ hôm nay là đủ để bắt đầu lại.')).toBeTruthy();
    // the stage and the growth are what they were
    expect(screen.getByRole('progressbar', { name: '64% tới Chồi non' })).toBeTruthy();
    expect(screen.getAllByText('Mầm nhú').length).toBeGreaterThan(0);
    // exactly one action besides the way back and the stages row
    expect(screen.getByRole('button', { name: 'Chọn một việc nhỏ' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đổi diện mạo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ghé cửa hàng' })).toBeNull();
    expect(screen.queryByText(/ốm|bệnh|lỗi của bạn|bỏ rơi|tội/i)).toBeNull();
    view.unmount();
  });

  test('"Chọn một việc nhỏ" opens the quest board', async () => {
    setPet({ mood: 'TIRED' });
    const view = await openPet();
    fireEvent.press(screen.getByRole('button', { name: 'Chọn một việc nhỏ' }));
    expect(await screen.findByRole('header', { name: 'Nhiệm vụ hôm nay' })).toBeTruthy();
    view.unmount();
  });
});
