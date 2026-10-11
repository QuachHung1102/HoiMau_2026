// Converted from design/assets/mam/skin-fox.svg (viewBox 0 0 128 128) by a throwaway script; maintained by hand from here.
import { G, Path } from 'react-native-svg';

// The hat's own artwork colours (not the streak "flame" role).
const FUR = '#C2410C';
const INNER_EAR = '#FFF1E6';

/** "Mũ cáo nhỏ": an overlay drawn over a stage inside the same 128 viewBox. */
export function SkinFox() {
  return (
    <>
      <G id="skin">
        <Path d="M44 31L50 9L60 27Z" fill={FUR} />
        <Path d="M48 27L50.5 16L55.5 26Z" fill={INNER_EAR} />
        <Path d="M69 26L79 8L85 30Z" fill={FUR} />
        <Path d="M72.5 25L78.5 15L81.5 27Z" fill={INNER_EAR} />
        <Path d="M37 43C40 21 57 14 64 14C73 14 89 20 92 41L88 44C83 31 73 27 64 27C55 27 45 31 41 46Z" fill={FUR} />
        <Path d="M47 33C52 27 58 25 64 25C70 25 77 27 82 32" fill="none" stroke={INNER_EAR} strokeWidth="1.6" strokeLinecap="round" />
      </G>
    </>
  );
}
