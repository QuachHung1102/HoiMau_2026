import { useEffect, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../src/shared/ui/AppText';
import { BottomSheet } from '../../../src/shared/ui/BottomSheet';
import { Button } from '../../../src/shared/ui/Button';
import { Card, ListRow } from '../../../src/shared/ui/Card';
import { Dialog } from '../../../src/shared/ui/Dialog';
import { Icon } from '../../../src/shared/ui/Icon';
import { DisabledReason, InlineError } from '../../../src/shared/ui/Notices';
import { Screen } from '../../../src/shared/ui/Screen';
import { SelectField } from '../../../src/shared/ui/SelectField';
import { useSnackbar } from '../../../src/shared/ui/Snackbar';
import { EmptyState, ErrorState, LoadingState } from '../../../src/shared/ui/States';
import { TextField } from '../../../src/shared/ui/TextField';
import { Checkbox, FilterChip, SegmentedControl, Switch } from '../../../src/shared/ui/Toggles';
import { withApp, type Entries, type EntryOptions } from '../harness';

const noop = () => undefined;
const styles = StyleSheet.create({
  section: { marginTop: 12 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stack: { gap: 12 },
  filler: { gap: 8, paddingTop: 12 },
});

// S03: sign-up fields, password with the eye toggle, helper text, the terms checkbox.
function Fields() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('ban@example.com');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  return (
    <Screen title="Tạo tài khoản" subtitle="Một nơi riêng cho hành trình của bạn." onBack={noop} hasInputs>
      <TextField label="Tên hiển thị" placeholder="Bạn muốn được gọi là gì?" value={name} onChangeText={setName} />
      <TextField label="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextField label="Mật khẩu" placeholder="Tạo mật khẩu" secure helper="Ít nhất 8 ký tự" value={password} onChangeText={setPassword} />
      <Checkbox label="Tôi đồng ý điều khoản" description="Đọc điều khoản và chính sách riêng tư" checked={agreed} onChange={setAgreed} />
      <Button label="Tạo tài khoản" onPress={noop} />
      <Button variant="secondary" label="Đã có tài khoản? Đăng nhập" onPress={noop} />
    </Screen>
  );
}

// S60: field errors under a field, and select fields.
function FieldErrors() {
  const [sex, setSex] = useState('MALE');
  const [zone, setZone] = useState('Asia/Ho_Chi_Minh');
  return (
    <Screen title="Bắt đầu từ bạn" subtitle="Hồ sơ · Bước 1 trong 3" onBack={noop} hasInputs>
      <TextField label="Năm sinh" keyboardType="number-pad" value="1999" onChangeText={noop} />
      <View style={styles.pair}>
        <View style={styles.half}>
          <TextField label="Chiều cao · cm" keyboardType="number-pad" value="250" error="Chiều cao cần trong khoảng 120–230 cm." onChangeText={noop} />
        </View>
        <View style={styles.half}>
          <TextField label="Cân nặng · kg" keyboardType="number-pad" value="65" onChangeText={noop} />
        </View>
      </View>
      <SelectField
        label="Giới tính dùng trong công thức"
        value={sex}
        onChange={setSex}
        options={[
          { value: 'MALE', label: 'Nam' },
          { value: 'FEMALE', label: 'Nữ' },
        ]}
      />
      <SelectField
        label="Múi giờ"
        value={zone}
        onChange={setZone}
        searchable
        options={[
          { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
          { value: 'Asia/Bangkok', label: 'Asia/Bangkok' },
        ]}
      />
      <SelectField label="Khoảng giờ nhắc thói quen" placeholder="Chọn giờ phù hợp" onChange={noop} options={[{ value: 'AM', label: 'Buổi sáng' }]} />
      <Button label="Tiếp tục" onPress={noop} />
    </Screen>
  );
}

// S79, S36, S17, S74: segmented control, switches, chips, checkboxes, a disabled action with its reason.
function Toggles() {
  const [motion, setMotion] = useState('SYSTEM');
  const [hideStreak, setHideStreak] = useState(false);
  const [team, setTeam] = useState(true);
  const [minutes, setMinutes] = useState('15');
  const [places, setPlaces] = useState(['indoor']);
  const [checked, setChecked] = useState(true);
  return (
    <Screen title="Hiển thị & chuyển động" onBack={noop}>
      <SegmentedControl
        accessibilityLabel="Chuyển động"
        value={motion}
        onChange={setMotion}
        options={[
          { value: 'SYSTEM', label: 'Theo hệ thống' },
          { value: 'REDUCED', label: 'Giảm' },
          { value: 'FULL', label: 'Đầy đủ' },
        ]}
      />
      <Switch label="Ẩn số ngày chuỗi" value={hideStreak} onChange={setHideStreak} />
      <Switch label="Nhận lời nhắc từ tổ đội" value={team} onChange={setTeam} />
      <AppText variant="title" style={styles.section}>Chọn buổi tập</AppText>
      <View style={styles.chips}>
        {['5', '15', '30', '45'].map(m => (
          <FilterChip key={m} label={`${m} phút`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      <AppText variant="caption">Không gian</AppText>
      <View style={styles.chips}>
        {[
          ['table', 'Cạnh bàn'],
          ['indoor', 'Trong phòng'],
          ['gym', 'Phòng gym'],
          ['out', 'Ngoài trời'],
        ].map(([id, label]) => (
          <FilterChip
            key={id}
            label={label}
            selected={places.includes(id)}
            onPress={() => setPlaces(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))}
          />
        ))}
      </View>
      <Checkbox label="Mình cùng vận động nhé?" description="Mẫu lời nhắc" checked={checked} onChange={setChecked} />
      <Checkbox label="Nghỉ một chút, uống nước nào." description="Mẫu lời nhắc" checked={false} onChange={noop} />
      <DisabledReason icon="Clock" reason="Lời nhắc gửi được từ 12:00 đến 20:00 theo giờ của Minh." />
      <Button label="Chưa gửi được lúc này" disabled onPress={noop} />
      <InlineError message="Chưa lưu được phần nước vừa ghi. Kiểm tra kết nối rồi thử lại." action={{ label: 'Thử lại', onPress: noop }} />
    </Screen>
  );
}

// S39: skeleton blocks on first load.
function Loading() {
  return (
    <Screen title="Đang lấy hành trình" subtitle="Dữ liệu của bạn đang được tải." onBack={noop}>
      <LoadingState />
      <AppText variant="secondary">Nếu mất kết nối, bạn vẫn có thể xem dữ liệu đã lưu.</AppText>
    </Screen>
  );
}

function LoadFailed() {
  return (
    <Screen title="Đang lấy hành trình" subtitle="Dữ liệu của bạn đang được tải." onBack={noop}>
      <ErrorState message="Kiểm tra kết nối rồi thử lại. Những ghi nhận đã lưu vẫn còn." onRetry={noop} />
    </Screen>
  );
}

// S75: nothing here yet. The sprout stands in for Mầm (Task 12).
function Empty() {
  return (
    <Screen title="Hộp thư" subtitle="Lời nhắc và những cột mốc của bạn." onBack={noop}>
      <EmptyState
        illustration={<Icon name="Sprout" size={96} />}
        title="Chưa có thư mới"
        body="Lời nhắc từ tổ đội và cột mốc của bạn sẽ xuất hiện ở đây."
        secondary={{ label: 'Cài đặt thông báo', onPress: noop }}
      />
    </Screen>
  );
}

// S57: the snackbar with Undo and its countdown (a long window, so the shot catches it on screen).
function ShowUndo() {
  const { show } = useSnackbar();
  useEffect(() => {
    show({
      message: 'Đã lưu thêm một phần nước · +10 XP · còn 3 giây để hoàn tác',
      action: { label: 'Hoàn tác', onPress: noop },
      countdown: true,
      durationMs: 60000,
    });
  }, [show]);
  return null;
}

function SnackbarScreen() {
  return (
    <Screen title="Hôm nay" subtitle="Chào An, mình bắt đầu từ việc nhỏ nhé.">
      <Card tone="primary">
        <AppText variant="title" color="white">Uống nước. Giữ nhịp.</AppText>
        <Button variant="onPrimary" label="Ghi nhận nước" onPress={noop} />
      </Card>
      <View style={styles.filler}>
        <ListRow icon="Droplet" title="Nước hôm nay" description="4 / 8 phần · đã lưu" />
      </View>
      <ShowUndo />
    </Screen>
  );
}

// S63: the dialog, open on mount over a screen.
function DialogScreen() {
  const [open, setOpen] = useState(true);
  return (
    <Screen title="Đang tập" subtitle="Toàn thân vừa sức · đang diễn ra" onBack={noop}>
      <Card tone="soft">
        <AppText>Hiệp 2 / 3 · Động tác 4 / 6</AppText>
      </Card>
      <Dialog
        visible={open}
        title="Kết thúc buổi tập bây giờ?"
        body="Bạn đã tập 06:18 trên 15:00. Phần đã tập vẫn được lưu."
        primary={{ label: 'Tập tiếp', onPress: () => setOpen(false) }}
        secondary={{ label: 'Kết thúc và lưu', onPress: () => setOpen(false) }}
        onDismiss={() => setOpen(false)}
      />
    </Screen>
  );
}

// S43 / S36: the bottom sheet, open on mount, with a list inside.
function SheetScreen() {
  const [open, setOpen] = useState(true);
  return (
    <Screen title="Thông báo" subtitle="Nhắc vừa đủ, vào lúc bạn muốn." onBack={noop}>
      <SelectField label="Khoảng giờ nhắc thói quen" placeholder="Chọn giờ phù hợp" onChange={noop} options={[]} />
      <BottomSheet visible={open} title="Khoảng giờ nhắc thói quen" onDismiss={() => setOpen(false)}>
        <ListRow title="Buổi sáng" description="07:00 – 09:00" onPress={() => setOpen(false)} />
        <ListRow title="Buổi trưa" description="11:30 – 13:00" onPress={() => setOpen(false)} />
        <ListRow title="Buổi tối" description="19:00 – 21:00" onPress={() => setOpen(false)} />
      </BottomSheet>
    </Screen>
  );
}

const make = (node: ReactElement, opts?: EntryOptions) => () => withApp(node, opts);

export const entries: Entries = {
  'kit-fields': make(<Fields />),
  'kit-field-errors': make(<FieldErrors />),
  'kit-toggles': make(<Toggles />),
  'kit-states-loading': make(<Loading />),
  'kit-states-error': make(<LoadFailed />),
  'kit-states-empty': make(<Empty />),
  'kit-snackbar-undo': make(<SnackbarScreen />),
  'kit-snackbar-undo-reduced': make(<SnackbarScreen />, { motion: 'REDUCED' }),
  'kit-dialog': make(<DialogScreen />),
  'kit-sheet': make(<SheetScreen />),
};
