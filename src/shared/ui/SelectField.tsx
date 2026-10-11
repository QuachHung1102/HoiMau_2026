import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
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
  /** Adds a search box that ignores case, diacritics and the separators _ / - ("ho chi minh" finds "Asia/Ho_Chi_Minh"). */
  searchable?: boolean;
};

// Separators become spaces before the diacritics are folded, on the option and on the query alike.
const fold = (text: string) => normalizeVi(text.replace(/[_/-]/g, ' '));

export function SelectField({ label, value, options, onChange, placeholder = vi.select, error, helper, searchable = false }: Props) {
  const palette = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(o => o.value === value);
  const needle = fold(query.trim());
  const shown = needle ? options.filter(o => fold(o.label).includes(needle)) : options;
  const hint = error ? undefined : helper;
  return (
    <>
      <FieldFrame label={label} error={error} helper={helper} focused={open}>
        <Touchable
          accessibilityRole="combobox"
          accessibilityLabel={`${error ? vi.fieldInvalid(label, error) : label}, ${selected?.label ?? placeholder}`}
          accessibilityHint={hint}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            // reset on open, not on close: the list must not un-filter while the sheet slides out
            setQuery('');
            setOpen(true);
          }}
          style={styles.field}
        >
          <AppText color={selected ? 'ink' : 'muted'} style={styles.value}>
            {selected?.label ?? placeholder}
          </AppText>
          <Icon name="ChevronDown" color={palette.muted} />
        </Touchable>
      </FieldFrame>
      <BottomSheet visible={open} title={label} onDismiss={() => setOpen(false)} scroll={false}>
        {searchable ? <TextField label={vi.search} value={query} onChangeText={setQuery} autoCorrect={false} /> : null}
        <FlatList
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
          data={shown}
          extraData={value}
          keyExtractor={option => option.value}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          ListEmptyComponent={<AppText variant="secondary">{vi.noResults}</AppText>}
          renderItem={({ item }) => {
            const checked = item.value === value;
            return (
              <Touchable
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                style={[styles.option, checked && { backgroundColor: palette.soft }]}
              >
                <AppText weight={checked ? 'semibold' : undefined} style={styles.value}>
                  {item.label}
                </AppText>
                {checked ? <Icon name="Check" color={palette.primary} /> : null}
              </Touchable>
            );
          }}
        />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: sizes.buttonHeight - 2 },
  value: { flex: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.minTouch, paddingHorizontal: 12, borderRadius: radius.button },
});
