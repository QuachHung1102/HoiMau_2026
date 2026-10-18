import { screen } from '@testing-library/react-native';
import { PET_STAGES } from '../../../domain/pet.ts';
import { formatNumber, stageName } from '../../shared/i18n/vi/pet';
import { installTodayTestEnv, openStages, setPet } from '../shop/shopTestKit';

installTodayTestEnv();

/** The row of a stage as a screen reader reads it (the stage that is current is read part by part). */
const row = (name: string) => screen.queryByLabelText(new RegExp(`^${name}\\.`));

describe('S68: the stages', () => {
  test('the five stages in order; past, current and next are said in words, each with the XP its stage takes', async () => {
    const view = await openStages();
    expect(screen.getByRole('header', { name: 'Hành trình lớn lên' })).toBeTruthy();
    expect(screen.getByText('Giai đoạn đã đạt sẽ không mất đi.')).toBeTruthy();
    // current = HATCHLING (index 1)
    expect(row('Hạt giống')?.props.accessibilityLabel).toBe(`Hạt giống. Đã qua. Cần ${formatNumber(300)} XP trong giai đoạn này`);
    expect(row('Chồi non')?.props.accessibilityLabel).toBe(`Chồi non. Sắp tới. Cần ${formatNumber(4000)} XP trong giai đoạn này`);
    expect(row('Cây xanh')?.props.accessibilityLabel).toBe(`Cây xanh. Sắp tới. Cần ${formatNumber(12000)} XP trong giai đoạn này`);
    expect(row('Cây huyền thoại')?.props.accessibilityLabel).toBe('Cây huyền thoại. Sắp tới. Giai đoạn cuối, không cần thêm XP');
    expect(screen.getAllByText('Đã qua')).toHaveLength(1);
    expect(screen.getAllByText('Hiện tại')).toHaveLength(1);
    expect(screen.getAllByText('Sắp tới')).toHaveLength(3);
    // the current one: its size, and the progress to the next
    expect(screen.getByText(`Cần ${formatNumber(1200)} XP trong giai đoạn này`)).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: '64% tới Chồi non' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 64 });
    // the order of the rows is the order of the stages
    const names = PET_STAGES.map(({ stage }) => stageName[stage]);
    const shown = screen.getAllByText(new RegExp(`^(${names.join('|')})$`)).map(node => node.props.children);
    expect(shown).toEqual(names);
    // the sentence that growth never goes backwards
    expect(screen.getByText('Mầm lớn lên nhờ những việc bạn đã làm, không mua được bằng xu.')).toBeTruthy();
    expect(screen.getByText('Giai đoạn đã đạt sẽ không mất đi.')).toBeTruthy();
    view.unmount();
  });

  test('EGG: nothing is past; MYTHIC: four stages are past and the bar says there is nothing more to grow into', async () => {
    setPet({ stage: 'EGG', stageIndex: 0, growthPercent: 10, nextStage: 'HATCHLING' });
    const first = await openStages();
    expect(screen.queryAllByText('Đã qua')).toHaveLength(0);
    expect(screen.getAllByText('Hiện tại')).toHaveLength(1);
    expect(screen.getAllByText('Sắp tới')).toHaveLength(4);
    expect(screen.getByRole('progressbar', { name: '10% tới Mầm nhú' })).toBeTruthy();
    first.unmount();

    setPet({ stage: 'MYTHIC', stageIndex: 4, growthPercent: 100, nextStage: null });
    const second = await openStages();
    expect(screen.getAllByText('Đã qua')).toHaveLength(4);
    expect(screen.getAllByText('Hiện tại')).toHaveLength(1);
    expect(screen.queryAllByText('Sắp tới')).toHaveLength(0);
    expect(screen.getByRole('progressbar', { name: 'Đã lớn hết cỡ' })).toBeTruthy();
    second.unmount();
  });
});
