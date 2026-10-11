import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Modal } from 'react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { SelectField } from './SelectField';

const options = [
  { value: 'HN', label: 'Hà Nội' },
  { value: 'HCM', label: 'Hồ Chí Minh' },
  { value: 'DN', label: 'Đà Nẵng' },
];

function Harness({ onChange, searchable = false, error }: { onChange: (v: string) => void; searchable?: boolean; error?: string }) {
  const [value, setValue] = useState<string | undefined>('HN');
  return (
    <MotionPreferenceProvider value="REDUCED">
      <SelectField
        label="Địa điểm"
        value={value}
        options={options}
        searchable={searchable}
        error={error}
        onChange={v => {
          setValue(v);
          onChange(v);
        }}
      />
    </MotionPreferenceProvider>
  );
}

test('the field is a combobox that names the label and the current choice', () => {
  const view = render(<Harness onChange={() => undefined} />);
  const field = view.getByRole('combobox', { name: 'Địa điểm, Hà Nội' });
  expect(field.props.accessibilityState).toMatchObject({ expanded: false });
  expect(view.getByText('Địa điểm')).toBeTruthy();
  expect(view.queryByRole('radio')).toBeNull();
  view.unmount();
});

test('opens the sheet with every option, selecting one calls onChange and closes', () => {
  const onChange = jest.fn();
  const view = render(<Harness onChange={onChange} />);
  fireEvent.press(view.getByRole('combobox'));
  expect(view.getAllByRole('radio')).toHaveLength(3);
  expect(view.getByRole('radio', { name: 'Hà Nội' }).props.accessibilityState).toMatchObject({ checked: true });
  expect(view.getByRole('radio', { name: 'Đà Nẵng' }).props.accessibilityState).toMatchObject({ checked: false });
  fireEvent.press(view.getByRole('radio', { name: 'Đà Nẵng' }));
  expect(onChange).toHaveBeenCalledWith('DN');
  expect(view.queryByRole('radio')).toBeNull();
  expect(view.getByRole('combobox', { name: 'Địa điểm, Đà Nẵng' })).toBeTruthy();
  view.unmount();
});

test('Back and the close button dismiss the sheet without changing the value', () => {
  const onChange = jest.fn();
  const view = render(<Harness onChange={onChange} />);
  fireEvent.press(view.getByRole('combobox'));
  fireEvent.press(view.getByRole('button', { name: 'Đóng' }));
  expect(view.queryByRole('radio')).toBeNull();
  fireEvent.press(view.getByRole('combobox'));
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  expect(view.queryByRole('radio')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  view.unmount();
});

test('searchable: typing without diacritics finds the accented option, and says when nothing matches', () => {
  const view = render(<Harness onChange={() => undefined} searchable />);
  fireEvent.press(view.getByRole('combobox'));
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'ha noi');
  expect(view.getAllByRole('radio')).toHaveLength(1);
  expect(view.getByRole('radio', { name: 'Hà Nội' })).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'đà');
  expect(view.getByRole('radio', { name: 'Đà Nẵng' })).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'zzz');
  expect(view.queryByRole('radio')).toBeNull();
  expect(view.getByText('Không có kết quả phù hợp')).toBeTruthy();
  view.unmount();
});

test('an error is shown under the field and added to its accessibility label', () => {
  const view = render(<Harness onChange={() => undefined} error="Chọn một địa điểm." />);
  expect(view.getByText('Chọn một địa điểm.')).toBeTruthy();
  expect(view.getByRole('combobox', { name: 'Địa điểm, lỗi: Chọn một địa điểm., Hà Nội' })).toBeTruthy();
  view.unmount();
});

const zones = [
  { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok' },
  { value: 'America/Port-au-Prince', label: 'America/Port-au-Prince' },
];

test('search treats _ / - as spaces: "ho chi minh" finds Asia/Ho_Chi_Minh, and "port au" finds a hyphenated name', () => {
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <SelectField label="Múi giờ" value="Asia/Bangkok" options={zones} onChange={() => undefined} searchable />
    </MotionPreferenceProvider>,
  );
  fireEvent.press(view.getByRole('combobox'));
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'ho chi minh');
  expect(view.getAllByRole('radio')).toHaveLength(1);
  expect(view.getByRole('radio', { name: 'Asia/Ho_Chi_Minh' })).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'Asia Ho_Chi');
  expect(view.getByRole('radio', { name: 'Asia/Ho_Chi_Minh' })).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'port au');
  expect(view.getByRole('radio', { name: 'America/Port-au-Prince' })).toBeTruthy();
  view.unmount();
});

test('with 419 options only a window of rows is mounted, and search still reaches a row that was not mounted', () => {
  const many = Array.from({ length: 419 }, (_, i) => ({ value: `z${i}`, label: `Vùng ${i}` }));
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <SelectField label="Múi giờ" options={many} onChange={() => undefined} searchable />
    </MotionPreferenceProvider>,
  );
  fireEvent.press(view.getByRole('combobox'));
  const mounted = view.getAllByRole('radio').length;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(60);
  expect(view.queryByRole('radio', { name: 'Vùng 400' })).toBeNull();
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'vung 400');
  expect(view.getByRole('radio', { name: 'Vùng 400' })).toBeTruthy();
  view.unmount();
});

test('the search box keeps its text while the sheet closes, and is empty when it opens again', () => {
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <SelectField label="Địa điểm" options={options} onChange={() => undefined} searchable />
    </MotionPreferenceProvider>,
  );
  fireEvent.press(view.getByRole('combobox'));
  fireEvent.changeText(view.getByLabelText('Tìm kiếm'), 'da');
  fireEvent.press(view.getByRole('button', { name: 'Đóng' }));
  fireEvent.press(view.getByRole('combobox'));
  expect(view.getByLabelText('Tìm kiếm').props.value).toBe('');
  expect(view.getAllByRole('radio')).toHaveLength(3);
  view.unmount();
});

test('helper text becomes the accessibility hint when there is no error', () => {
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <SelectField label="Địa điểm" helper="Dùng để tính giờ nhắc" options={options} onChange={() => undefined} />
    </MotionPreferenceProvider>,
  );
  expect(view.getByRole('combobox').props.accessibilityHint).toBe('Dùng để tính giờ nhắc');
  view.unmount();
});
