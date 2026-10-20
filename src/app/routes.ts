import type { NativeStackNavigationOptions, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ComponentType } from 'react';
import type { WorkoutResult } from '../../domain/contract/content.ts';
import type { JournalCreateResult } from '../../domain/contract/social.ts';
import type { DateLabel, MealSlot } from '../../domain/types.ts';
import type { IconName } from '../shared/ui/Icon';

/** Every route of the app and its params, declared once (AR-25). Screens are registered in screens.tsx. */
export type RootParamList = {
  // signed out
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  NewPassword: { email: string };
  // onboarding
  OnbProfile: undefined;
  OnbActivity: undefined;
  OnbArchetype: undefined;
  OnbTargets: undefined;
  // tab roots
  Today: undefined;
  Plan: undefined;
  Guild: undefined;
  Profile: undefined;
  // details (open in the stack of the tab they were opened from)
  QuestBoard: undefined;
  EndOfDay: undefined;
  StatsExplainer: undefined;
  ManualKcal: undefined;
  Targets: undefined;
  MealPlan: undefined;
  MealDetail: { mealSlot: MealSlot };
  MealSwap: { mealSlot: MealSlot };
  WorkoutCatalog: undefined;
  WorkoutDetail: { id: string };
  MoveDemo: { workoutId: string; code: string };
  Journey: undefined;
  DayHistory: { date?: DateLabel } | undefined;
  Levels: undefined;
  Pet: undefined;
  PetStages: undefined;
  Shop: undefined;
  ShopItem: { code: string };
  Inventory: undefined;
  GuildJoin: undefined;
  GuildCreate: undefined;
  /** `focus: 'leave'` opens the screen scrolled to the leave card ("Tìm nhóm khác"). */
  GuildManage: { focus?: 'leave' } | undefined;
  /** `week: 'previous'` opens the closed week (the weekly-result notification is about it). */
  Leaderboard: { week?: 'previous' } | undefined;
  Nudge: { receiverId: string; receiverName: string };
  Inbox: undefined;
  JournalWrite: undefined;
  /** `crisis`: the device's own check of the text that was saved (AR-20); it lives in memory, in this param, and nowhere else. */
  JournalFeedback: { result: JournalCreateResult; crisis: boolean };
  Support: undefined;
  JournalList: undefined;
  JournalEntry: { id: string };
  /** `usedDate`: S78 has just used a ticket for that day; S34 says so. */
  Tickets: { usedDate?: DateLabel } | undefined;
  TicketPreview: { date: DateLabel };
  Settings: undefined;
  NotificationSettings: undefined;
  EditProfile: undefined;
  Display: undefined;
  Help: undefined;
  Privacy: undefined;
  DeleteAccount: undefined;
  // focus flow (full-screen modal above the tabs)
  FocusSession: { id: string };
  WorkoutResult: { result: WorkoutResult };
};

export type RouteName = keyof RootParamList;

// The same names at run time; `satisfies` makes tsc fail when a name is missing here or is not declared above.
const declared = {
  Welcome: true,
  SignIn: true,
  SignUp: true,
  ForgotPassword: true,
  NewPassword: true,
  OnbProfile: true,
  OnbActivity: true,
  OnbArchetype: true,
  OnbTargets: true,
  Today: true,
  Plan: true,
  Guild: true,
  Profile: true,
  QuestBoard: true,
  EndOfDay: true,
  StatsExplainer: true,
  ManualKcal: true,
  Targets: true,
  MealPlan: true,
  MealDetail: true,
  MealSwap: true,
  WorkoutCatalog: true,
  WorkoutDetail: true,
  MoveDemo: true,
  Journey: true,
  DayHistory: true,
  Levels: true,
  Pet: true,
  PetStages: true,
  Shop: true,
  ShopItem: true,
  Inventory: true,
  GuildJoin: true,
  GuildCreate: true,
  GuildManage: true,
  Leaderboard: true,
  Nudge: true,
  Inbox: true,
  JournalWrite: true,
  JournalFeedback: true,
  Support: true,
  JournalList: true,
  JournalEntry: true,
  Tickets: true,
  TicketPreview: true,
  Settings: true,
  NotificationSettings: true,
  EditProfile: true,
  Display: true,
  Help: true,
  Privacy: true,
  DeleteAccount: true,
  FocusSession: true,
  WorkoutResult: true,
} satisfies Record<RouteName, true>;
export const routeNames = Object.keys(declared) as RouteName[];

/** Props of the screen registered under `N`: `function MealDetailScreen({ route, navigation }: ScreenProps<'MealDetail'>)`. */
export type ScreenProps<N extends RouteName> = NativeStackScreenProps<RootParamList, N>;

/** One registry entry. The component takes `ScreenProps` of its own name, or no props. */
export type ScreenEntry = {
  [N in RouteName]: { name: N; component: ComponentType<ScreenProps<N>> | ComponentType; options?: NativeStackNavigationOptions };
}[RouteName];

export type TabRootName = 'Today' | 'Plan' | 'Guild' | 'Profile';
/** A tab root also carries its tab-bar label (`tabLabel` in i18n/vi/nav.ts) and lucide icon. */
export type TabRoot = Extract<ScreenEntry, { name: TabRootName }> & { label: string; icon: IconName };

// `useNavigation()` and `navigation.navigate(...)` are typed against the list above everywhere.
type AppRoutes = RootParamList;
declare global {
  namespace ReactNavigation {
    interface RootParamList extends AppRoutes {}
  }
}
