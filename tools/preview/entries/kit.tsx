import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../src/shared/ui/AppText';
import { Button } from '../../../src/shared/ui/Button';
import { Card, ListRow } from '../../../src/shared/ui/Card';
import { Screen } from '../../../src/shared/ui/Screen';
import { withApp, type Entries, type EntryOptions } from '../harness';

const noop = () => undefined;
const styles = StyleSheet.create({ stack: { gap: 12 }, section: { marginTop: 12 } });

function Primitives() {
  return (
    <Screen title="Cài đặt" subtitle="Điều chỉnh để ứng dụng hợp với bạn." onBack={noop}>
      <AppText variant="title" style={styles.section}>Thành phần cơ bản</AppText>
      <AppText>Body: Ghi lại việc bạn đã làm, nuôi dưỡng Mầm.</AppText>
      <AppText variant="secondary">Secondary: Hôm nay mình bắt đầu từ việc nhỏ nhé.</AppText>
      <AppText variant="caption">Caption: 340 / 1.118 XP</AppText>
      <View style={styles.stack}>
        <Button label="Bắt đầu hành trình" onPress={noop} />
        <Button variant="secondary" label="Tôi đã có tài khoản" onPress={noop} />
        <Button label="Đang lưu" loading onPress={noop} />
        <Button label="Không khả dụng" disabled onPress={noop} />
      </View>
      <View style={styles.stack}>
        <Card tone="soft">
          <AppText weight="bold">Đỗ Đòn · đang giữ nhịp</AppText>
          <AppText variant="caption">Card soft</AppText>
        </Card>
        <Card tone="primary">
          <AppText variant="title" color="white">Uống nước. Giữ nhịp.</AppText>
          <Button variant="onPrimary" label="Ghi nhận nước" onPress={noop} />
        </Card>
        <Card>
          <ListRow icon="User" title="Hồ sơ & mục tiêu" description="Cập nhật số đo hoặc hệ phái" onPress={noop} />
          <ListRow icon="Bell" title="Thông báo" description="Chọn điều bạn muốn nhận" onPress={noop} />
        </Card>
      </View>
    </Screen>
  );
}

const make = (opts?: EntryOptions) => () => withApp(<Primitives />, opts);

export const entries: Entries = {
  'kit-primitives': make(),
  'kit-primitives-forest': make({ theme: 'forest' }),
};
