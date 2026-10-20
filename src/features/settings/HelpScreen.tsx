import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { healthVi } from '../../shared/i18n/vi/health';
import { legalVi } from '../../shared/i18n/vi/legal';
import * as vi from '../../shared/i18n/vi/settings';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { ListRow } from '../../shared/ui/Card';
import type { IconName } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import pkg from '../../../package.json';
import { rhythmSections, TERMS_SECTIONS, type HelpSection } from './helpContent';

type Topic = keyof typeof vi.helpRows;
const TOPICS: readonly { key: Topic; icon: IconName }[] = [
  { key: 'rhythm', icon: 'Info' },
  { key: 'health', icon: 'ShieldCheck' },
  { key: 'terms', icon: 'FileText' },
  { key: 'privacy', icon: 'Lock' },
  { key: 'feedback', icon: 'MessageCircle' },
];

const fromLegal = (sections: readonly { heading: string; body: string }[]): HelpSection[] => sections.map(({ heading, body }) => ({ title: heading, lines: [body] }));

/** What a sheet says: an introduction (optional) and sections of text. */
function contentOf(topic: Topic): { intro?: string; sections: HelpSection[] } {
  switch (topic) {
    case 'rhythm':
      return { sections: rhythmSections() };
    case 'health':
      return { intro: healthVi.disclaimer, sections: healthVi.info.paragraphs.map(({ title, body }) => ({ title, lines: [body] })) };
    case 'terms':
      return { intro: legalVi.intro, sections: fromLegal(legalVi.sections.slice(0, TERMS_SECTIONS)) };
    case 'privacy':
      return { intro: legalVi.intro, sections: fromLegal(legalVi.sections.slice(TERMS_SECTIONS)) };
    case 'feedback':
      // There is no approved address: the sheet says who will announce the channel, and names none.
      return { intro: vi.feedbackVersion(pkg.version), sections: [{ title: vi.helpRows.feedback.title, lines: [vi.feedbackBody] }] };
  }
}

/** S53: the five things worth reading, each in a sheet that scrolls. */
export function HelpScreen({ navigation }: ScreenProps<'Help'>) {
  const [open, setOpen] = useState<Topic | null>(null);
  const content = open && contentOf(open);
  return (
    <Screen title={vi.helpTitle} subtitle={vi.helpSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <View style={styles.list}>
        {TOPICS.map(({ key, icon }) => (
          <ListRow key={key} icon={icon} {...vi.helpRows[key]} onPress={() => setOpen(key)} />
        ))}
      </View>
      {open && content ? (
        <BottomSheet title={vi.helpRows[open].title} onDismiss={() => setOpen(null)}>
          {content.intro ? <AppText variant="secondary">{content.intro}</AppText> : null}
          {content.sections.map(section => (
            <View key={section.title} style={styles.section}>
              <AppText weight="semibold">{section.title}</AppText>
              {section.lines.map(line => (
                <AppText key={line} variant="secondary">
                  {line}
                </AppText>
              ))}
            </View>
          ))}
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.section - 8 },
  section: { marginTop: 12, gap: 4 },
});
