import { Linking } from 'react-native';
import { CRISIS_LINES, healthVi } from '../../shared/i18n/vi/health';
import { fireEvent, installTodayTestEnv, openWrite, saveText, screen } from './journalTestKit';

installTodayTestEnv();

const call = (number: string) => screen.getByRole('button', { name: new RegExp(`^Gọi ${number} · `) });
/** The way a person gets here: a saved page whose words matched. */
async function openSupport() {
  const view = await openWrite();
  await saveText('Mình không thiết sống nữa');
  fireEvent.press(screen.getByRole('button', { name: 'Xem nguồn hỗ trợ' }));
  await screen.findByRole('header', { name: 'Nguồn hỗ trợ' });
  return view;
}

describe('S56', () => {
  let open: jest.SpyInstance;
  beforeEach(() => {
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => open.mockRestore());

  test('the approved words, the two public numbers as rows, the urgent line and the way back; nothing else to call', async () => {
    const view = await openSupport();
    expect(screen.getByText(healthVi.support.sourcesIntro)).toBeTruthy();
    expect(call('115')).toHaveAccessibleName('Gọi 115 · Cấp cứu');
    expect(call('111')).toHaveAccessibleName('Gọi 111 · Tổng đài quốc gia bảo vệ trẻ em');
    expect(screen.getByText('Nếu bạn hoặc ai đó đang gặp nguy hiểm ngay lúc này, hãy gọi 115.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trở lại trang của tôi' })).toBeTruthy();
    expect(screen.getByText(healthVi.support.footer)).toBeTruthy();
    // only the two numbers of CRISIS_LINES appear on the screen: no other phone number, no diagnosis, no claim of watching
    const shown = screen.queryAllByText(/./).map(node => String(node.props.children));
    const numbers = shown.flatMap(text => text.match(/\d{3,}/g) ?? []);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.filter(number => !CRISIS_LINES.some(line => line.number === number))).toEqual([]);
    expect(shown.join('\n')).not.toMatch(/chẩn đoán|theo dõi|giám sát|phân tích/i);
    view.unmount();
  });

  test('each row opens the dialer on its own number and on nothing else', async () => {
    const view = await openSupport();
    fireEvent.press(call('115'));
    expect(open).toHaveBeenLastCalledWith('tel:115');
    fireEvent.press(call('111'));
    expect(open).toHaveBeenLastCalledWith('tel:111');
    expect(open).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  test('a phone that cannot place a call says so, calmly, and the screen stays', async () => {
    const view = await openSupport();
    open.mockRejectedValueOnce(new Error('no dialer'));
    fireEvent.press(call('115'));
    expect(await screen.findByText(/Chưa mở được ứng dụng gọi điện\./)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Nguồn hỗ trợ' })).toBeTruthy();
    // the next press clears it
    fireEvent.press(call('111'));
    expect(screen.queryByText(/Chưa mở được ứng dụng gọi điện\./)).toBeNull();
    view.unmount();
  });

  test('"Trở lại trang của tôi" goes back to the page that was saved', async () => {
    const view = await openSupport();
    fireEvent.press(screen.getByRole('button', { name: 'Trở lại trang của tôi' }));
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    view.unmount();
  });
});
