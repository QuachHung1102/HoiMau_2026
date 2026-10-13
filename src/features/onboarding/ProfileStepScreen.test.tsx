import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';
import { healthVi } from '../../shared/i18n/vi/health';
import { bornAt, deviceZone, draft, fetchMock, focusLog, installOnboardingTestEnv, mount, never, onStep, press, requests, respond, select, sent, serve, type, watchFocus, ZONES } from './onboardingTestKit';

installOnboardingTestEnv();

const ready = () => onStep('Bắt đầu từ bạn');
const fill = ({ birthYear = bornAt(30), height = '170', weight = '65', sex = 'Nam' as string | null } = {}) => {
  type('Năm sinh', birthYear);
  type('Chiều cao · cm', height);
  type('Cân nặng · kg', weight);
  if (sex) select('Giới tính dùng trong công thức, Chọn', sex);
};
const next = () => press('Tiếp tục');
const onActivity = () => onStep('Nhịp sống của bạn');
const HEIGHT_RANGE = 'Chiều cao cần trong khoảng 120–230 cm.';
const WEIGHT_RANGE = 'Cân nặng cần trong khoảng 30–250 kg.';
const AGE_RANGE = 'Hồi Máu tính mục tiêu cho người từ 16 đến 90 tuổi. Bạn xem lại năm sinh nhé.';

test('S05 shows the step, the five fields, the privacy card and the action; the only request is the zone list', async () => {
  await mount();
  expect(await ready()).toBeTruthy();
  expect(screen.getByText('Hồ sơ · Bước 1 trong 3')).toBeTruthy();
  for (const label of ['Năm sinh', 'Chiều cao · cm', 'Cân nặng · kg']) expect(screen.getByLabelText(label).props.value).toBe('');
  expect(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Chọn' })).toBeTruthy();
  expect(await screen.findByRole('combobox', { name: 'Múi giờ, Asia/Ho_Chi_Minh' })).toBeTruthy();
  expect(screen.getByText('Số đo chỉ mình bạn thấy')).toBeTruthy();
  expect(screen.getByText('Tổ đội không xem được cân nặng hay mục tiêu năng lượng của bạn.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeTruthy();
  // the first step has nowhere to go back to
  expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  expect(sent().map(r => `${r.method} ${r.path}`).sort()).toEqual(['GET /me', 'GET /meta/timezones']);
});

test('the number fields ask for the right keyboards', async () => {
  await mount();
  await ready();
  expect(screen.getByLabelText('Năm sinh').props).toMatchObject({ keyboardType: 'number-pad', maxLength: 4 });
  expect(screen.getByLabelText('Chiều cao · cm').props).toMatchObject({ keyboardType: 'decimal-pad', inputMode: 'decimal' });
  expect(screen.getByLabelText('Cân nặng · kg').props).toMatchObject({ keyboardType: 'decimal-pad', inputMode: 'decimal' });
});

test('valid values, written with a comma or a dot, move on to S06 and keep what was typed', async () => {
  await mount();
  await ready();
  fill({ height: '170,5', weight: '65.2' });
  next();
  expect(await onActivity()).toBeTruthy();
  press('Quay lại');
  await ready();
  expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe('170,5');
  expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe('65.2');
  expect(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Nam' })).toBeTruthy();
});

describe('S60: a value outside its limit', () => {
  // [field label, value, message]; the limits themselves are LIMITS of domain/validation.ts
  const cases: [string, Parameters<typeof fill>[0], string][] = [
    ['height above the maximum', { height: '230,1' }, HEIGHT_RANGE],
    ['height below the minimum', { height: '119.9' }, HEIGHT_RANGE],
    ['weight above the maximum', { weight: '250.5' }, WEIGHT_RANGE],
    ['weight below the minimum', { weight: '29' }, WEIGHT_RANGE],
    ['an age above the maximum', { birthYear: bornAt(91) }, AGE_RANGE],
    ['no height', { height: '' }, 'Nhập chiều cao của bạn.'],
    ['no weight', { weight: '' }, 'Nhập cân nặng của bạn.'],
    ['no birth year', { birthYear: '' }, 'Nhập năm sinh của bạn.'],
    ['two separators', { height: '1,7,0' }, 'Nhập chiều cao bằng số, trong khoảng 120–230 cm.'],
    ['an exponent', { weight: '6e1' }, 'Nhập cân nặng bằng số, trong khoảng 30–250 kg.'],
    ['a sign', { weight: '-65' }, 'Nhập cân nặng bằng số, trong khoảng 30–250 kg.'],
    ['a space', { height: '17 0' }, 'Nhập chiều cao bằng số, trong khoảng 120–230 cm.'],
    ['a birth year that is not a whole number', { birthYear: '19.9' }, 'Nhập năm sinh bằng số, đủ bốn chữ số.'],
    ['no sex', { sex: null }, 'Chọn giới tính dùng trong công thức.'],
  ];
  test.each(cases)('%s: the message is under its field and the step does not move', async (_name, values, message) => {
    await mount();
    await ready();
    fill(values);
    next();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Bắt đầu từ bạn' })).toBeTruthy();
    // nothing about the person has been sent anywhere
    expect(sent().every(r => r.method === 'GET')).toBe(true);
  });

  test('the limits are accepted themselves', async () => {
    await mount();
    await ready();
    fill({ height: '120', weight: '250', birthYear: bornAt(90) });
    next();
    expect(await onActivity()).toBeTruthy();
  });

  test('every invalid field is marked, the error is part of its label, and focus goes to the first one', async () => {
    await mount();
    await ready();
    fill({ height: '250', weight: '10' });
    const [focusYear, focusHeight, focusWeight] = [watchFocus('Năm sinh'), watchFocus('Chiều cao · cm'), watchFocus('Cân nặng · kg')];
    next();
    expect(await screen.findByLabelText(`Chiều cao · cm, lỗi: ${HEIGHT_RANGE}`)).toBeTruthy();
    expect(screen.getByLabelText(`Cân nặng · kg, lỗi: ${WEIGHT_RANGE}`)).toBeTruthy();
    expect(focusHeight).toHaveBeenCalledTimes(1);
    expect(focusYear).not.toHaveBeenCalled();
    expect(focusWeight).not.toHaveBeenCalled();
  });

  test('editing a field removes its error and does not move focus to the next invalid one', async () => {
    await mount();
    await ready();
    fill({ height: '250', weight: '10' });
    next();
    await screen.findByText(HEIGHT_RANGE);
    const focusWeight = watchFocus(`Cân nặng · kg, lỗi: ${WEIGHT_RANGE}`);
    type(`Chiều cao · cm, lỗi: ${HEIGHT_RANGE}`, '170');
    expect(screen.queryByText(HEIGHT_RANGE)).toBeNull();
    expect(screen.getByText(WEIGHT_RANGE)).toBeTruthy();
    expect(focusWeight).not.toHaveBeenCalled();
  });
});

describe('S61: under 16', () => {
  const blocked = () => screen.findByRole('header', { name: healthVi.under16.title });

  test('a birth year that gives age 15 shows the calm state with the health copy, and nothing is sent', async () => {
    await mount();
    await ready();
    fill({ birthYear: bornAt(15) });
    next();
    expect(await blocked()).toBeTruthy();
    expect(screen.getByText(healthVi.under16.body)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kiểm tra lại năm sinh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tìm hiểu thêm' })).toBeTruthy();
    // the form is not on screen, and no request carried anything
    expect(screen.queryByLabelText('Năm sinh')).toBeNull();
    expect(sent().every(r => r.method === 'GET')).toBe(true);
  });

  test('age 16 is let through', async () => {
    await mount();
    await ready();
    fill({ birthYear: bornAt(16) });
    next();
    expect(await onActivity()).toBeTruthy();
  });

  test('field errors come first: age 15 with an invalid height shows the height error, S61 only once it is fixed', async () => {
    await mount();
    await ready();
    fill({ birthYear: bornAt(15), height: '250' });
    next();
    expect(await screen.findByText(HEIGHT_RANGE)).toBeTruthy();
    expect(screen.queryByText(healthVi.under16.title)).toBeNull();
    type(`Chiều cao · cm, lỗi: ${HEIGHT_RANGE}`, '170');
    next();
    expect(await blocked()).toBeTruthy();
  });

  test('"Kiểm tra lại năm sinh" returns to the form with every value kept and the cursor in the birth year', async () => {
    await mount();
    await ready();
    fill({ birthYear: bornAt(15), height: '168,5' });
    next();
    await blocked();
    const focused = focusLog(); // the form is not mounted now
    press('Kiểm tra lại năm sinh');
    await ready();
    expect(screen.getByLabelText('Năm sinh').props.value).toBe(bornAt(15));
    expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe('168,5');
    expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe('65');
    expect(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Nam' })).toBeTruthy();
    await waitFor(() => expect(focused()).toEqual(['Năm sinh']));
  });

  test('the Back arrow leaves the state with the values kept', async () => {
    await mount('OnbProfile', { draft, block: 'age' });
    await blocked();
    press('Quay lại');
    expect(await ready()).toBeTruthy();
    expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe(draft.weightKg);
  });

  test('hardware Back (Android) leaves the state, not the app', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const listen = jest.spyOn(BackHandler, 'addEventListener');
    await mount('OnbProfile', { draft, block: 'age' });
    await blocked();
    const onBack = listen.mock.calls.filter(([event]) => event === 'hardwareBackPress').at(-1)?.[1] as (() => boolean) | undefined;
    expect(onBack).toBeDefined();
    let handled: boolean | undefined;
    act(() => {
      handled = onBack?.();
    });
    // handled here, so the system does not close the app
    expect(handled).toBe(true);
    expect(await ready()).toBeTruthy();
    expect(screen.getByLabelText('Năm sinh').props.value).toBe(draft.birthYear);
  });

  test('"Tìm hiểu thêm" opens the health information, which closes again', async () => {
    await mount('OnbProfile', { draft, block: 'age' });
    await blocked();
    press('Tìm hiểu thêm');
    expect(screen.getByRole('header', { name: healthVi.info.title })).toBeTruthy();
    for (const paragraph of healthVi.info.paragraphs) expect(screen.getByText(paragraph.body)).toBeTruthy();
    press('Đóng');
    expect(screen.queryByText(healthVi.info.paragraphs[0].body)).toBeNull();
    expect(screen.getByRole('header', { name: healthVi.under16.title })).toBeTruthy();
  });
});

describe('the time zone', () => {
  const zoneField = (zone: string) => screen.findByRole('combobox', { name: `Múi giờ, ${zone}` });

  test('a device zone the server has is the default', async () => {
    deviceZone('Europe/Paris');
    await mount();
    await ready();
    expect(await zoneField('Europe/Paris')).toBeTruthy();
  });

  test.each(['CET', '+07:00', 'Etc/Unknown'])('a device zone the server does not list (%s) falls back to Asia/Ho_Chi_Minh', async zone => {
    deviceZone(zone);
    await mount();
    await ready();
    await waitFor(() => expect(requests('/meta/timezones')).toHaveLength(1));
    expect(await zoneField('Asia/Ho_Chi_Minh')).toBeTruthy();
    fill();
    next();
    expect(await onActivity()).toBeTruthy();
  });

  test('the options are the server list, and search finds a zone by its words', async () => {
    await mount();
    await ready();
    fireEvent.press(await zoneField('Asia/Ho_Chi_Minh'));
    expect(screen.getAllByRole('radio').map(option => option.props.accessibilityState.checked)).toHaveLength(ZONES.length);
    fireEvent.changeText(screen.getByLabelText('Tìm kiếm'), 'ho chi minh');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    fireEvent.changeText(screen.getByLabelText('Tìm kiếm'), 'paris');
    fireEvent.press(screen.getByRole('radio', { name: 'Europe/Paris' }));
    expect(await zoneField('Europe/Paris')).toBeTruthy();
  });

  test('while the list is on its way the field shows the default and the step can be passed', async () => {
    serve({ 'GET /meta/timezones': never });
    deviceZone('Europe/Paris');
    await mount();
    await ready();
    expect(await zoneField('Asia/Ho_Chi_Minh')).toBeTruthy();
    fill();
    next();
    expect(await onActivity()).toBeTruthy();
  });

  test('a list that could not be loaded offers a retry and does not block the step', async () => {
    let fail = true;
    serve({ 'GET /meta/timezones': () => (fail ? respond(500) : respond(200, { zones: ZONES })) });
    deviceZone('Europe/Paris');
    await mount();
    await ready();
    expect(await screen.findByText('Chưa tải được danh sách múi giờ. Bạn vẫn có thể tiếp tục với múi giờ đang hiện.')).toBeTruthy();
    expect(await zoneField('Asia/Ho_Chi_Minh')).toBeTruthy();
    fail = false;
    press('Thử lại');
    expect(await zoneField('Europe/Paris')).toBeTruthy();
    expect(screen.queryByText(/Chưa tải được danh sách múi giờ/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/meta/timezones'))).toHaveLength(2);
  });

  test('the zone request carries the query signal', async () => {
    await mount();
    await ready();
    await waitFor(() => expect(requests('/meta/timezones')).toHaveLength(1));
    expect(requests('/meta/timezones')[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
