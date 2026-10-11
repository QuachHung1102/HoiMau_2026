import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../shared/theme/tokens';

/** The buttons and links under the fields: 24 dp apart, as in the S02 / S03 / S04 / S55 frames. */
export function Actions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

// the same spacing as the Welcome screen: Screen already adds 8 dp between its children
const styles = StyleSheet.create({ actions: { gap: spacing.section, marginTop: spacing.section - 8 } });
