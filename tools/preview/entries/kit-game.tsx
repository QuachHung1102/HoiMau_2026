import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PetMood, PetStage } from '../../../domain/types.ts';
import { stageName } from '../../../src/shared/i18n/vi/pet';
import { AppText } from '../../../src/shared/ui/AppText';
import { CoinChip, FrostDot, LockChip, OfflineBadge, OwnedChip, RewardChip, StreakChip } from '../../../src/shared/ui/Badges';
import { Card, ListRow } from '../../../src/shared/ui/Card';
import { LevelStrip, ProgressBar } from '../../../src/shared/ui/LevelStrip';
import { Mam } from '../../../src/shared/ui/mam/Mam';
import { MilestoneBadge } from '../../../src/shared/ui/MilestoneBadge';
import { OverlayCelebration } from '../../../src/shared/ui/OverlayCelebration';
import { ProgressRing } from '../../../src/shared/ui/ProgressRing';
import { Screen } from '../../../src/shared/ui/Screen';
import { StatBar } from '../../../src/shared/ui/StatBar';
import { withApp, type Entries, type EntryOptions } from '../harness';

const noop = () => undefined;
const STAGES: PetStage[] = ['EGG', 'HATCHLING', 'JUVENILE', 'ADULT', 'MYTHIC'];
const MOODS: [PetMood, string][] = [
  ['HAPPY', 'Vui'],
  ['NEUTRAL', 'Bình thường'],
  ['TIRED', 'Buồn ngủ'],
];
const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  stack: { gap: 14, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  rings: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ringCard: { alignItems: 'center' },
  milestones: { flexDirection: 'row', justifyContent: 'space-around' },
  grid: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  cell: { flex: 1, alignItems: 'center' },
  centered: { textAlign: 'center' },
  sizes: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around' },
  big: { alignItems: 'center' },
  foxGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 8 },
  foxCell: { alignItems: 'center' },
});

// S09 / S21 / S23 / S38 pieces: level strip + coins, the four stats, every chip, the bar.
function Components() {
  return (
    <Screen title="Hôm nay" subtitle="Chào An, mình bắt đầu từ việc nhỏ nhé.">
      <View style={styles.top}>
        <View style={styles.grow}>
          <LevelStrip level={5} title="Người kiên trì" xpIntoLevel={340} xpForNextLevel={1118} onPress={noop} />
        </View>
        <CoinChip coin={250} />
      </View>
      <View style={styles.stack}>
        <StatBar kind="hp" value={26} />
        <StatBar kind="en" value={69} />
        <StatBar kind="str" value={40} />
        <StatBar kind="spd" value={30} />
      </View>
      <View style={[styles.chips, styles.stack]}>
        <StreakChip days={4} />
        <RewardChip text="+50 XP" />
        <LockChip minLevel={8} />
        <OwnedChip equipped={false} />
        <OwnedChip equipped />
        <FrostDot />
        <FrostDot compact />
        <OfflineBadge count={2} />
      </View>
      <ProgressBar value={64} max={100} label="64% tới Chồi non" />
    </Screen>
  );
}

// S19 ring (on the primary card and on a plain surface) and the S21 milestones.
function RingsAndMilestones() {
  return (
    <Screen title="Hành trình của bạn">
      <View style={styles.rings}>
        <Card tone="primary" style={styles.ringCard}>
          <ProgressRing progress={0.42} tone="primary" size={132} accessibilityLabel="Thời gian còn lại">
            <AppText variant="title" color="white">08:42</AppText>
            <AppText variant="caption" color="white">còn lại</AppText>
          </ProgressRing>
        </Card>
        <ProgressRing progress={0.63} size={112} />
      </View>
      <View style={styles.milestones}>
        <MilestoneBadge days={7} achieved />
        <MilestoneBadge days={30} achieved={false} remaining={26} />
        <MilestoneBadge days={100} achieved={false} />
      </View>
    </Screen>
  );
}

// 5 stages x 3 moods, then the fox skin on every stage.
function MamGrid() {
  return (
    <Screen>
      <View style={styles.grid}>
        <View style={styles.row}>
          {MOODS.map(([mood, label]) => (
            <AppText key={mood} variant="caption" weight="semibold" style={[styles.cell, styles.centered]}>
              {label}
            </AppText>
          ))}
        </View>
        {STAGES.map(stage => (
          <View key={stage}>
            <View style={styles.row}>
              {MOODS.map(([mood]) => (
                <View key={mood} style={styles.cell}>
                  <Mam stage={stage} mood={mood} size={96} />
                </View>
              ))}
            </View>
            <AppText variant="caption" style={styles.centered}>{stageName[stage]}</AppText>
          </View>
        ))}
        <View style={styles.row}>
          {STAGES.map(stage => (
            <Mam key={stage} stage={stage} mood="HAPPY" skin="fox" size={68} />
          ))}
        </View>
        <AppText variant="caption" style={styles.centered}>Mũ cáo nhỏ</AppText>
      </View>
    </Screen>
  );
}

// The fox skin on every stage, large: only the two HATCHLING combinations have a design render.
function MamFox() {
  return (
    <Screen title="Mũ cáo nhỏ" subtitle="Chỉ Mầm nhú có bản vẽ thiết kế; các giai đoạn khác cần người thiết kế xem.">
      <View style={styles.foxGrid}>
        {STAGES.map(stage => (
          <View key={stage} style={styles.foxCell}>
            <Mam stage={stage} mood={stage === 'ADULT' ? 'TIRED' : stage === 'JUVENILE' ? 'NEUTRAL' : 'HAPPY'} skin="fox" size={150} />
            <AppText variant="caption" style={styles.centered}>{stageName[stage]}</AppText>
          </View>
        ))}
      </View>
    </Screen>
  );
}

// The sizes screens use: 40 dp in a list row, up to 220 dp on the pet screen; the fox skin on every stage.
function MamSizes() {
  return (
    <Screen title="Mầm của bạn">
      <Card>
        <ListRow title="Mầm đang vui" description="40 dp trong một hàng" trailing={<Mam stage="HATCHLING" mood="HAPPY" size={40} decorative />} />
      </Card>
      <View style={styles.sizes}>
        {STAGES.map(stage => (
          <Mam key={stage} stage={stage} mood="TIRED" size={40} />
        ))}
        <Mam stage="MYTHIC" mood="HAPPY" size={64} />
      </View>
      <View style={styles.sizes}>
        {STAGES.map(stage => (
          <Mam key={stage} stage={stage} mood="HAPPY" skin="fox" size={64} />
        ))}
      </View>
      <Card tone="soft" style={styles.big}>
        <Mam stage="JUVENILE" mood="HAPPY" size={220} animation="idle" />
      </Card>
      <Card tone="primary" style={styles.big}>
        <Mam stage="MYTHIC" mood="NEUTRAL" size={128} />
      </Card>
    </Screen>
  );
}

const levelUp = (
  <OverlayCelebration
    kind="LEVEL_UP"
    level={5}
    stage="HATCHLING"
    title="Bạn lên cấp 5"
    subtitle="Người kiên trì"
    body="Bạn nhận 1 điểm tiện ích. Cửa hàng có thêm lựa chọn mới."
    primary={{ label: 'Xem tiện ích', onPress: noop }}
    secondary={{ label: 'Để sau', onPress: noop }}
    onClose={noop}
  />
);
const milestone = (
  <OverlayCelebration
    kind="STREAK_MILESTONE"
    days={7}
    title="7 ngày giữ nhịp"
    body="Huy hiệu Người giữ nhịp đã vào kho đồ. Kỷ lục mới của bạn: 7 ngày."
    primary={{ label: 'Xem huy hiệu', onPress: noop }}
    secondary={{ label: 'Tiếp tục', onPress: noop }}
    onClose={noop}
  />
);
const evolve = (
  <OverlayCelebration
    kind="PET_STAGE_UP"
    stage="JUVENILE"
    title="Mầm đã thành Chồi non"
    body="Công sức những ngày qua đã giúp Mầm lớn lên."
    primary={{ label: 'Xem Mầm', onPress: noop }}
    secondary={{ label: 'Để sau', onPress: noop }}
    onClose={noop}
  />
);

const make = (node: ReactElement, opts?: EntryOptions) => () => withApp(node, opts);
// The overlays are shot as the final card (reduced motion): a screenshot 400 ms into the animation shows a half-faded one.
const still: EntryOptions = { motion: 'REDUCED' };

export const entries: Entries = {
  'kit-game-components': make(<Components />),
  'kit-game-rings': make(<RingsAndMilestones />),
  'kit-mam-grid': make(<MamGrid />),
  'kit-mam-sizes': make(<MamSizes />),
  'kit-mam-fox': make(<MamFox />),
  's65-level-up': make(levelUp, still),
  's66-streak-milestone': make(milestone, still),
  's69-mam-evolve': make(evolve, still),
  's65-level-up-motion': make(levelUp),
  's66-streak-milestone-motion': make(milestone),
  's69-mam-evolve-motion': make(evolve),
};
