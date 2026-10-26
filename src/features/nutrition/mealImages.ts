import type { MealSlot } from '../../../domain/types.ts';
import type { IconName } from '../../shared/ui/Icon';
import type { ImageSourcePropType } from 'react-native';

// Static requires (Metro needs literal paths). The keys are the `imageKey` values of server/content/meals.ts and the
// files are copies of design/assets/<key>.png; a meal whose key is null, or not here, is drawn with an icon instead.
// Sources and kinds: design/assets/sources.json (the three meal pictures are `stock-unsplash`: licence review).
const images = new Map<string, ImageSourcePropType>([
  ['e1ZpZ', require('../../assets/meals/e1ZpZ.png')],
  ['Fr7yg', require('../../assets/meals/Fr7yg.png')],
  ['xZxDr', require('../../assets/meals/xZxDr.png')],
]);

/** The picture of a meal, or undefined when it has none (the screen then shows an icon). */
export const mealImage = (imageKey: string | null): ImageSourcePropType | undefined => (imageKey === null ? undefined : images.get(imageKey));

/** The picture above the plan (S13): design/assets/b4IYqX.png, `ai-generated`. */
export const planHeaderImage: ImageSourcePropType = require('../../assets/meals/b4IYqX.png');

/** The keys this module can draw. */
export const mealImageKeys = [...images.keys()];

/** What stands in for a picture: one neutral icon per slot. */
export const slotIcon: Record<MealSlot, IconName> = { BREAKFAST: 'Coffee', LUNCH: 'Utensils', DINNER: 'CookingPot', SNACK: 'Apple' };
