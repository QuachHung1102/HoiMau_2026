import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { normalizeVi } from '../../../domain/language.ts';
import * as vi from '../i18n/vi/common';
import { useTheme } from '../theme/ThemeProvider';
import { radius, sizes } from '../theme/tokens';
import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { FieldFrame, TextField } from './TextField';
import { Touchable } from './Touchable';

type Option = { value: string; label: string };
type Props = {
  label: string;
  value?: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  helper?: string;
  /** Adds a search box that ignores case and diacritics ("ha noi" finds "Hà Nội"). */
  searchable?: boolean;
};

export function SelectField({ label, value, options, onChange, placeholder = vi.select, error, helper, searchable = false }: Props) {
  const palette = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(o => o.value === value);
  const needle = normalizeVi(query.trim());
  const shown = needle ? options.filter(o => normalizeVi(o.label).includes(needle)) : options;
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  return (
    <>
      <FieldFrame label={label} error={error} helper={helper} focused={open}>
        <Touchable
          accessibilityRole="combobox"
          accessibilityLabel={`${error ? vi.fieldInvalid(label, error) : label}, ${selected?.label ?? placeholder}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={styles.field}
        >
          <AppText color={selected ? 'ink' : 'muted'} style={styles.value}>
            {selected?.label ?? placeholder}
          </AppText>
          <Icon name="ChevronDown" color={palette.muted} />
        </Touchable>
      </FieldFrame>
      <BottomSheet visible={open} title={label} onDismiss={close}>
        {searchable ? <TextField label={vi.search} value={query} onChangeText={setQuery} autoCorrect={false} /> : null}
        {/* ponytail: every option is rendered at once; switch to a FlatList if a list ever passes a few hundred rows. */}
        <View accessibilityRole="radiogroup" accessibilityLabel={label}>
          {shown.map(option => {
            const checked = option.value === value;
            return (
              <Touchable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                onPress={() => {
                  onChange(option.value);
                  close();
                }}
                style={[styles.option, checked && { backgroundColor: palette.soft }]}
              >
                <AppText weight={checked ? 'semibold' : undefined} style={styles.value}>
                  {option.label}
                </AppText>
                {checked ? <Icon name="Check" color={palette.primary} /> : null}
              </Touchable>
            );
          })}
        </View>
        {shown.length === 0 ? <AppText variant="secondary">{vi.noResults}</AppText> : null}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: sizes.buttonHeight - 2 },
  value: { flex: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.minTouch, paddingHorizontal: 12, borderRadius: radius.button },
});
