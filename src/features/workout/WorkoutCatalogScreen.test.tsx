import { act, fireEvent, screen } from '@testing-library/react-native';
import { fetchMock, hold, refuse, respond, world } from '../dashboard/todayTestKit';
import { api } from '../../shared/api/client';
import { catalog, catalogQueries, detail, gym, installWorkoutTestEnv, openCatalog, serverCatalog } from './workoutTestKit';

// The real registry; `navigate` of the detail screens is recorded on its way to the navigator.
const mockNavigate = jest.fn();
jest.mock('../../app/screens', () => {
  const actual = jest.requireActual('../../app/screens');
  const { createElement } = require('react');
  const spied = (entry: { component: unknown }) => {
    function Spied(props: { navigation: { navigate(...to: unknown[]): void } }) {
      const navigate = (...to: unknown[]) => {
        mockNavigate(...to);
        props.navigation.navigate(...to);
      };
      return createElement(entry.component as never, { ...props, navigation: { ...props.navigation, navigate } } as never);
    }
    return { ...entry, component: Spied };
  };
  return { ...actual, detailScreens: actual.detailScreens.map(spied) };
});

installWorkoutTestEnv();
beforeEach(() => mockNavigate.mockClear());

const ALL = 'tham,ta-tay,day-khang-luc';
const chip = (name: string, selected: boolean) => screen.queryByRole('button', { name, selected });
const pressChip = async (name: string) => {
  fireEvent.press(screen.getByRole('button', { name }));
  await act(async () => undefined);
};
const lastQuery = () => catalogQueries().at(-1);
const rowLabels = async () => (await screen.findAllByRole('button', { name: /kcal \(ước tính\)$/ })).map(item => item.props.accessibilityLabel);

describe('S17: workouts for what the person has', () => {
  test('asks the server for 15 minutes, a room and no equipment; the first recommended workout is the highlighted card, the rest are rows', async () => {
    const view = await openCatalog();
    expect(screen.getByText('Một buổi phù hợp với thời gian bạn có.')).toBeTruthy();
    expect(await screen.findByRole('header', { name: 'Toàn thân vừa sức' })).toBeTruthy();
    expect(catalogQueries()).toEqual(['duration=15&space=ROOM&equipment=']);

    // what is chosen is said by the chip itself (its state, and a check mark), not by its colour
    expect(chip('15 phút', true)).toBeTruthy();
    expect(chip('5 phút', false)).toBeTruthy();
    expect(chip('Trong phòng', true)).toBeTruthy();
    expect(chip('Không cần', true)).toBeTruthy();
    expect(chip('Tạ tay', false)).toBeTruthy();

    // the highlighted card: the archetype of the profile (TANKER), the kind, and the energy named as an estimate
    expect(screen.getByText('Hợp với Đỡ Đòn')).toBeTruthy();
    expect(screen.getByText('Vận động kháng lực · gợi ý cho bạn')).toBeTruthy();
    expect(screen.getByText('15 phút · khoảng 70 kcal (ước tính)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem hướng dẫn: Toàn thân vừa sức' })).toBeTruthy();
    // the rest, in the order the server gave them
    expect(await rowLabels()).toEqual([
      'Cardio nhẹ trong phòng. Vận động tim mạch · khoảng 80 kcal (ước tính)',
      'Giãn cơ nhẹ toàn thân. Giãn cơ và linh hoạt · khoảng 40 kcal (ước tính)',
      'Ngắt quãng nhẹ. Vận động ngắt quãng · khoảng 100 kcal (ước tính)',
      'Thở chậm trước giờ ngủ. Hít thở và thả lỏng · khoảng 20 kcal (ước tính)',
    ]);
    expect(screen.queryByText('Chưa có bài phù hợp')).toBeNull();
    view.unmount();
  });

  test('every chip asks the server again, with the query the contract names', async () => {
    const view = await openCatalog();
    await screen.findByRole('header', { name: detail.name });

    await pressChip('30 phút');
    expect(lastQuery()).toBe('duration=30&space=ROOM&equipment=');
    // one length at a time
    expect(chip('30 phút', true)).toBeTruthy();
    expect(chip('15 phút', false)).toBeTruthy();

    await pressChip('Ngoài trời');
    expect(lastQuery()).toBe('duration=30&space=OUTDOOR&equipment=');
    expect(chip('Trong phòng', false)).toBeTruthy();

    // equipment is what the person has: several at once, sent as one comma-separated list
    await pressChip('Tạ tay');
    expect(lastQuery()).toBe('duration=30&space=OUTDOOR&equipment=ta-tay');
    expect(chip('Không cần', false)).toBeTruthy();
    await pressChip('Thảm');
    expect(decodeURIComponent(lastQuery() ?? '')).toBe('duration=30&space=OUTDOOR&equipment=tham,ta-tay');
    await pressChip('Tạ tay');
    expect(lastQuery()).toBe('duration=30&space=OUTDOOR&equipment=tham');

    // "Không cần" is the empty selection: it clears the others, and the parameter is still sent, empty
    await pressChip('Dây kháng lực');
    await pressChip('Không cần');
    expect(lastQuery()).toBe('duration=30&space=OUTDOOR&equipment=');
    expect(chip('Không cần', true)).toBeTruthy();
    expect(chip('Thảm', false)).toBeTruthy();
    expect(chip('Dây kháng lực', false)).toBeTruthy();
    view.unmount();
  });

  test('nothing is filtered or reordered on this device: what the server answers is what is shown', async () => {
    // an answer that a filter of the app's own would not let through: it needs dumbbells, and nothing is recommended
    gym.items = () => [
      { ...catalog[1], equipment: ['ta-tay'] },
      { ...catalog[0], recommended: false },
    ];
    const view = await openCatalog();
    expect(await rowLabels()).toEqual(['Cardio nhẹ trong phòng. Vận động tim mạch · khoảng 80 kcal (ước tính)', 'Toàn thân vừa sức. Vận động kháng lực · khoảng 70 kcal (ước tính)']);
    // no workout is recommended: no highlighted card, and no archetype is claimed
    expect(screen.queryByText(/^Hợp với/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xem hướng dẫn/ })).toBeNull();
    view.unmount();
  });

  test('the highlighted card and a row each open their own workout', async () => {
    const view = await openCatalog();
    fireEvent.press(await screen.findByRole('button', { name: 'Xem hướng dẫn: Toàn thân vừa sức' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('WorkoutDetail', { id: catalog[0].id });
    expect(await screen.findByText('3 hiệp · 6 động tác · khoảng 70 kcal (ước tính)')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Ngắt quãng nhẹ. Vận động ngắt quãng · khoảng 100 kcal (ước tính)' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('WorkoutDetail', { id: catalog[3].id });
    await act(async () => undefined);
    view.unmount();
  });
});

describe('the equipment parameter: the server reads "absent" and "empty" differently', () => {
  // one workout that needs nothing, one that needs dumbbells, one that needs dumbbells and a mat
  const withGear = [catalog[0], { ...catalog[1], equipment: ['ta-tay'] }, { ...catalog[2], equipment: ['ta-tay', 'tham'] }];

  test('"Không cần" sends equipment= and shows only what needs nothing; owning things adds what they allow', async () => {
    gym.items = query => serverCatalog(query, withGear);
    const view = await openCatalog();
    expect(await screen.findByRole('header', { name: catalog[0].name })).toBeTruthy();
    expect(catalogQueries()).toEqual(['duration=15&space=ROOM&equipment=']);
    expect(screen.queryAllByRole('button', { name: /kcal \(ước tính\)$/ })).toHaveLength(0);

    await pressChip('Tạ tay');
    expect(lastQuery()).toBe('duration=15&space=ROOM&equipment=ta-tay');
    expect(await rowLabels()).toEqual([expect.stringMatching(/^Cardio nhẹ trong phòng/)]);
    await pressChip('Thảm');
    expect(await screen.findAllByRole('button', { name: /kcal \(ước tính\)$/ })).toHaveLength(2);
    // taking everything away again is "owns nothing", not "no filter"
    await pressChip('Không cần');
    expect(lastQuery()).toBe('duration=15&space=ROOM&equipment=');
    await screen.findByRole('header', { name: catalog[0].name });
    expect(screen.queryAllByRole('button', { name: /kcal \(ước tính\)$/ })).toHaveLength(0);
    view.unmount();
  });

  test('on the wire an empty value stays in the query and a missing one stays out: two different questions', async () => {
    gym.items = query => serverCatalog(query, withGear);
    const view = await openCatalog();
    await screen.findByRole('header', { name: catalog[0].name });
    expect((await api.get<{ items: unknown[] }>('/workout/catalog', { duration: 15, equipment: '' })).items).toHaveLength(1);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(/\/workout\/catalog\?duration=15&equipment=$/);
    expect((await api.get<{ items: unknown[] }>('/workout/catalog', { duration: 15 })).items).toHaveLength(3);
    expect(fetchMock.mock.calls.at(-1)?.[0]).not.toContain('equipment');
    view.unmount();
  });
});

describe('S48: nothing matches', () => {
  test('says so, and "Xóa bớt bộ lọc" takes the equipment filter away first, then the space', async () => {
    // only a person with every piece of equipment and no wish about the space finds something
    gym.items = query => (query.get('equipment') === ALL && !query.has('space') ? catalog : []);
    const view = await openCatalog();
    expect(await screen.findByText('Chưa có bài phù hợp')).toBeTruthy();
    expect(screen.getByText('Bạn có thể chọn thời lượng khác, hoặc bỏ bớt yêu cầu về dụng cụ và không gian.')).toBeTruthy();
    // an empty list is not a failure
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();

    await pressChip('Xóa bớt bộ lọc');
    expect(decodeURIComponent(lastQuery() ?? '')).toBe(`duration=15&space=ROOM&equipment=${ALL}`);
    // the chips say what was changed: every piece of equipment, the space still chosen
    expect(chip('Không cần', false)).toBeTruthy();
    expect(chip('Thảm', true)).toBeTruthy();
    expect(chip('Tạ tay', true)).toBeTruthy();
    expect(chip('Dây kháng lực', true)).toBeTruthy();
    expect(chip('Trong phòng', true)).toBeTruthy();
    expect(await screen.findByText('Chưa có bài phù hợp')).toBeTruthy();

    await pressChip('Xóa bớt bộ lọc');
    expect(decodeURIComponent(lastQuery() ?? '')).toBe(`duration=15&equipment=${ALL}`);
    expect(chip('Trong phòng', false)).toBeTruthy();
    expect(await screen.findByRole('header', { name: detail.name })).toBeTruthy();
    expect(screen.queryByText('Chưa có bài phù hợp')).toBeNull();
    view.unmount();
  });

  test('with nothing left to take away the action is gone: only another length can help', async () => {
    gym.items = () => [];
    const view = await openCatalog();
    await screen.findByText('Chưa có bài phù hợp');
    await pressChip('Xóa bớt bộ lọc');
    await screen.findByText('Chưa có bài phù hợp');
    await pressChip('Xóa bớt bộ lọc');
    expect(await screen.findByText('Chưa có bài phù hợp')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xóa bớt bộ lọc' })).toBeNull();
    expect(catalogQueries()).toHaveLength(3);
    view.unmount();
  });
});

describe('the catalog cannot be loaded', () => {
  test('while it loads: a skeleton, neither "nothing matches" nor an error', async () => {
    const view = await openCatalog();
    await screen.findByRole('header', { name: detail.name });
    const asked = hold('GET /workout/catalog?duration=45&space=ROOM&equipment=');
    await pressChip('45 phút');
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Chưa có bài phù hợp')).toBeNull();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    await act(async () => asked.release(respond(200, { items: catalog })));
    expect(await screen.findByRole('header', { name: detail.name })).toBeTruthy();
    view.unmount();
  });

  test.each([
    ['no network', () => (world.down = true), /^Không kết nối được mạng/],
    ['the server fails', () => (world.answer = () => refuse(500, 'INTERNAL')), /^Hệ thống đang gặp sự cố/],
  ])('%s: the error state with "Thử lại", never "Chưa có bài phù hợp"; the retry loads it', async (_name, breakIt, reason) => {
    const view = await openCatalog();
    await screen.findByRole('header', { name: detail.name });
    const server = world.answer;
    breakIt();
    await pressChip('5 phút');
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByText('Chưa có bài phù hợp')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa bớt bộ lọc' })).toBeNull();
    // the filters stay usable
    expect(chip('5 phút', true)).toBeTruthy();

    world.down = false;
    world.answer = server;
    fireEvent.press(screen.getAllByRole('button', { name: 'Thử lại' }).at(-1) as never);
    // every workout of the fixture lasts 15 minutes: the server's answer for 5 is an empty list, which is an answer
    expect(await screen.findByText('Chưa có bài phù hợp')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    expect(lastQuery()).toBe('duration=5&space=ROOM&equipment=');
    view.unmount();
  });
});
