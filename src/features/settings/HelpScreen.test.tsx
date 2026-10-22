import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScrollView } from 'react-native';
import { healthVi } from '../../shared/i18n/vi/health';
import { legalVi } from '../../shared/i18n/vi/legal';
import pkg from '../../../package.json';
import { fetchMock, fireEvent, installTodayTestEnv, openHelp, screen } from './settingsTestKit';

installTodayTestEnv();

const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}\\.`) });
const sheetTitle = (name: string) => screen.findByRole('header', { name });
/** Everything on screen, as text. */
const said = () => JSON.stringify(screen.toJSON());
const close = () => fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
const mentions = (body: string) => said().includes(JSON.stringify(body).slice(1, -1));

describe('S53', () => {
  test('the version the sheet shows is the one the Android app carries (package.json = versionName of build.gradle)', () => {
    const gradle = readFileSync(join(__dirname, '../../../android/app/build.gradle'), 'utf8');
    expect(/versionName "([^"]+)"/.exec(gradle)?.[1]).toBe(pkg.version);
  });

  test('the title, the subtitle and the five rows of the frame, each with its words', async () => {
    const view = await openHelp();
    expect(screen.getByRole('header', { name: 'Trợ giúp & thông tin' })).toBeTruthy();
    expect(screen.getByText('Hiểu ứng dụng và tìm hỗ trợ.')).toBeTruthy();
    for (const name of [
      'Cách giữ nhịp mỗi ngày. Nhiệm vụ, XP và chuỗi',
      'Thông tin sức khỏe. Ước tính không thay thế tư vấn y tế',
      'Điều khoản sử dụng. Quyền và trách nhiệm',
      'Chính sách riêng tư. Dữ liệu nào được lưu và chia sẻ',
      'Gửi phản hồi. Báo lỗi hoặc góp ý cho ứng dụng',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    view.unmount();
  });

  test('"Cách giữ nhịp mỗi ngày" opens a sheet with the quests, the levels, the streak, the 03:00 boundary and the tickets', async () => {
    const view = await openHelp();
    fireEvent.press(row('Cách giữ nhịp mỗi ngày'));
    await sheetTitle('Cách giữ nhịp mỗi ngày');
    for (const part of ['Nhiệm vụ và XP', 'Cấp độ', 'Chuỗi ngày', 'Một ngày của bạn', 'Vé giữ nhịp']) expect(screen.getByText(part)).toBeTruthy();
    expect(screen.getByText('Buổi tập chính: +50 XP và +20 xu.')).toBeTruthy();
    expect(screen.getByText('Từ cấp 5 lên cấp 6 cần 1.118 XP.')).toBeTruthy();
    expect(screen.getByText('Mốc 30 ngày: một huy hiệu và +200 xu.')).toBeTruthy();
    expect(screen.getByText(/bắt đầu lúc 03:00 và kết thúc lúc 02:59/)).toBeTruthy();
    expect(screen.getByText('Bạn giữ tối đa 2 vé, hoặc 3 vé khi đã mở tiện ích tăng chỗ chứa vé.')).toBeTruthy();
    view.unmount();
  });

  test('"Thông tin sức khỏe": the disclaimer of spec 9.2, then every paragraph of the reviewed copy, the safety floors included', async () => {
    const view = await openHelp();
    fireEvent.press(row('Thông tin sức khỏe'));
    await sheetTitle('Thông tin sức khỏe');
    expect(screen.getByText(healthVi.disclaimer)).toBeTruthy();
    for (const paragraph of healthVi.info.paragraphs) {
      expect(screen.getByText(paragraph.title)).toBeTruthy();
      expect(screen.getByText(paragraph.body)).toBeTruthy();
    }
    expect(screen.getByText(/Mục tiêu năng lượng không xuống dưới 1\.200 kcal mỗi ngày với nữ, 1\.500 kcal mỗi ngày với nam/)).toBeTruthy();
    view.unmount();
  });

  test('"Điều khoản sử dụng" and "Chính sách riêng tư" split the summary of legalVi between them, each section in exactly one', async () => {
    const view = await openHelp();
    fireEvent.press(row('Điều khoản sử dụng'));
    await sheetTitle('Điều khoản sử dụng');
    expect(legalVi.sections.filter(section => mentions(section.body)).map(section => section.heading)).toEqual(['Ai có thể dùng Hồi Máu', 'Không phải tư vấn y tế']);
    expect(screen.getByText(legalVi.intro)).toBeTruthy();
    close();
    fireEvent.press(row('Chính sách riêng tư'));
    await sheetTitle('Chính sách riêng tư');
    expect(legalVi.sections.filter(section => mentions(section.body)).map(section => section.heading)).toEqual([
      'Hồi Máu lưu gì',
      'Bài viết nhật ký',
      'Điều thành viên tổ đội thấy',
      'Dữ liệu của bạn',
      'Quyền của bạn',
    ]);
    view.unmount();
  });

  test('"Gửi phản hồi": the version of the app and the sentence that the distributor will announce the channel; no address, no form, no link', async () => {
    const view = await openHelp();
    fireEvent.press(row('Gửi phản hồi'));
    await sheetTitle('Gửi phản hồi');
    expect(screen.getByText(`Phiên bản ứng dụng: ${pkg.version}`)).toBeTruthy();
    expect(screen.getByText(/Kênh nhận phản hồi sẽ do đơn vị phát hành thông báo\./)).toBeTruthy();
    // no address in any word of the screen
    expect(screen.getAllByText(/./).map(node => String(node.props.children)).join(' ')).not.toMatch(/@|mailto|https?:|tel:|www./);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Gửi|Gửi đi|Mở thư)$/ })).toBeNull();
    view.unmount();
  });

  test('each sheet closes with "Đóng"; nothing was requested for any of them', async () => {
    const view = await openHelp();
    const asked = fetchMock.mock.calls.length;
    for (const title of ['Cách giữ nhịp mỗi ngày', 'Thông tin sức khỏe', 'Điều khoản sử dụng', 'Chính sách riêng tư', 'Gửi phản hồi']) {
      fireEvent.press(row(title));
      await sheetTitle(title);
      close();
      expect(screen.queryByRole('header', { name: title })).toBeNull();
    }
    expect(fetchMock.mock.calls.length).toBe(asked);
    view.unmount();
  });

  test('the sheet scrolls: its text is in a scroll view of its own, so nothing is clipped at a large font', async () => {
    const view = await openHelp();
    const before = screen.UNSAFE_getAllByType(ScrollView).length;
    fireEvent.press(row('Cách giữ nhịp mỗi ngày'));
    await sheetTitle('Cách giữ nhịp mỗi ngày');
    expect(screen.UNSAFE_getAllByType(ScrollView).length).toBe(before + 1);
    view.unmount();
  });
});
