import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Biometrics, Me } from '../../../domain/contract/core.ts';
import { localParts } from '../../../domain/logicalDate.ts';
import type { Archetype } from '../../../domain/types.ts';
import { allowedArchetypes } from '../../../domain/validation.ts';
import { healthVi } from '../../shared/i18n/vi/health';
import { archetypes } from '../../shared/i18n/vi/onboarding';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/Card';
import { Dialog } from '../../shared/ui/Dialog';
import { InlineError } from '../../shared/ui/Notices';
import { RadioRow } from '../../shared/ui/Toggles';
import { ARCHETYPE_ICON } from '../onboarding/TargetsView';
import { useChangeArchetype } from './api';
import { ARCHETYPE_COOLDOWN_DAYS } from './rules';

const DAY_MS = 24 * 60 * 60 * 1000;
const DIRECTIONS: readonly Archetype[] = ['TANKER', 'ASSASSIN', 'SUPPORTER'];

/** "14:05 ngày 21/10/2026" in the person's own zone: the moment the cooldown ends. */
function whenText(iso: string, timeZone: string) {
  const { date, hour, minute } = localParts(Date.parse(iso), timeZone);
  return vi.clockAndDate(hour, minute, Number(date.slice(8, 10)), Number(date.slice(5, 7)), Number(date.slice(0, 4)));
}

type Props = { user: Me['user']; biometrics: Biometrics };

/**
 * The direction row of S37, the sheet that changes it, and S81 (the 14 days between two changes). When `Me` already says the
 * date is in the future the dialog opens with no request at all; the server's `409 ARCHETYPE_COOLDOWN` opens the same dialog
 * with the server's date. Nothing of XP, level or streak is touched by a change.
 */
export function ArchetypeChange({ user, biometrics }: Props) {
  const [sheet, setSheet] = useState(false);
  const [waitUntil, setWaitUntil] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Archetype | null>(null);
  const [error, setError] = useState<string>();
  const [change, changing] = useChangeArchetype();
  const current = user.archetype;
  // What the latest numbers allow, as the server judges it (BMI rule); the others are listed with the reason.
  const allowed = allowedArchetypes(biometrics.heightCm, biometrics.weightKg);

  const opensAt = user.archetypeChangeAvailableAt;
  const daysLeft = opensAt !== null && Date.parse(opensAt) > Date.now() ? Math.ceil((Date.parse(opensAt) - Date.now()) / DAY_MS) : null;
  const open = () => {
    if (opensAt !== null && daysLeft !== null) return setWaitUntil(opensAt);
    setChosen(null);
    setError(undefined);
    setSheet(true);
  };
  const confirm = async () => {
    if (!chosen) return;
    setError(undefined);
    const outcome = await change({ archetype: chosen });
    if (!outcome) return;
    if (outcome.state === 'done') return setSheet(false);
    if (outcome.code === 'ARCHETYPE_COOLDOWN' && typeof outcome.details?.availableAt === 'string') {
      setSheet(false);
      return setWaitUntil(outcome.details.availableAt);
    }
    // The numbers rule the direction out: the server has said so, whatever this screen thought.
    if (outcome.code === 'ARCHETYPE_NOT_ALLOWED') return setError(healthVi.blockedArchetype.body);
    setError(vi.archetypeFailed(failureText(outcome.code)));
  };

  return (
    <>
      {current ? (
        <ListRow icon={ARCHETYPE_ICON[current]} title={archetypes[current].name} description={vi.archetypeRowHint(daysLeft)} onPress={open} />
      ) : null}
      {sheet ? (
        <BottomSheet title={vi.archetypeSheetTitle} onDismiss={() => setSheet(false)}>
          <AppText variant="secondary">{vi.archetypeSheetIntro}</AppText>
          <View accessibilityRole="radiogroup" accessibilityLabel={vi.archetypeSheetTitle} style={styles.group}>
            {DIRECTIONS.map(direction => {
              const ruledOut = !allowed.includes(direction);
              const text = direction === current ? vi.archetypeCurrent : ruledOut ? healthVi.blockedArchetype.body : archetypes[direction].focus;
              return (
                <RadioRow
                  key={direction}
                  label={archetypes[direction].name}
                  description={text}
                  selected={(chosen ?? current) === direction}
                  disabled={ruledOut}
                  onPress={() => setChosen(direction)}
                />
              );
            })}
          </View>
          {error ? <InlineError message={error} /> : null}
          <View style={styles.actions}>
            <Button label={vi.archetypeConfirm} loading={changing} disabled={!chosen || chosen === current} onPress={confirm} />
            <Button variant="secondary" label={vi.archetypeNotNow} onPress={() => setSheet(false)} />
          </View>
        </BottomSheet>
      ) : null}
      {waitUntil ? (
        <Dialog
          title={vi.cooldownTitle}
          body={vi.cooldownBody(whenText(waitUntil, user.timezone))}
          note={vi.cooldownNote(ARCHETYPE_COOLDOWN_DAYS)}
          primary={{ label: vi.understood, onPress: () => setWaitUntil(null) }}
          onDismiss={() => setWaitUntil(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: 8, gap: 4 },
  actions: { gap: 12, marginVertical: 16 },
});
