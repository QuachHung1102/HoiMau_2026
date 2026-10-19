// The screen registry (AR-25). A feature task adds one import line and one entry per screen, nothing else.
// A tab root looks like { name: 'Today', component: TodayScreen, label: tabLabel.Today, icon: 'Sun' };
// the icons of the design are Sun (Today), Route (Plan), Users (Guild), User (Profile). The bar order is fixed
// in navigation.tsx, so the order inside `tabRoots` does not matter.
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen';
import { NewPasswordScreen } from '../features/auth/NewPasswordScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import { SignUpScreen } from '../features/auth/SignUpScreen';
import { WelcomeScreen } from '../features/auth/WelcomeScreen';
import { StatsExplainerScreen } from '../features/dashboard/StatsExplainerScreen';
import { TodayScreen } from '../features/dashboard/TodayScreen';
import { GuildCreateScreen } from '../features/guild/GuildCreateScreen';
import { GuildJoinScreen } from '../features/guild/GuildJoinScreen';
import { GuildManageScreen } from '../features/guild/GuildManageScreen';
import { GuildScreen } from '../features/guild/GuildScreen';
import { LeaderboardScreen } from '../features/guild/LeaderboardScreen';
import { NudgeScreen } from '../features/guild/NudgeScreen';
import { InboxScreen } from '../features/notifications/InboxScreen';
import { ActivityStepScreen } from '../features/onboarding/ActivityStepScreen';
import { ArchetypeStepScreen } from '../features/onboarding/ArchetypeStepScreen';
import { ProfileStepScreen } from '../features/onboarding/ProfileStepScreen';
import { stepOptions } from '../features/onboarding/StepScreen';
import { OnbTargetsScreen, TargetsScreen } from '../features/onboarding/TargetsScreen';
import { PetScreen } from '../features/pet/PetScreen';
import { PetStagesScreen } from '../features/pet/PetStagesScreen';
import { InventoryScreen } from '../features/shop/InventoryScreen';
import { ShopItemScreen } from '../features/shop/ShopItemScreen';
import { ShopScreen } from '../features/shop/ShopScreen';
import { ManualKcalScreen } from '../features/nutrition/ManualKcalScreen';
import { MealDetailScreen } from '../features/nutrition/MealDetailScreen';
import { MealPlanScreen } from '../features/nutrition/MealPlanScreen';
import { MealSwapScreen } from '../features/nutrition/MealSwapScreen';
import { DayHistoryScreen } from '../features/progression/DayHistoryScreen';
import { JourneyScreen } from '../features/progression/JourneyScreen';
import { LevelsScreen } from '../features/progression/LevelsScreen';
import { ProfileScreen } from '../features/progression/ProfileScreen';
import { EndOfDayScreen } from '../features/quests/EndOfDayScreen';
import { QuestBoardScreen } from '../features/quests/QuestBoardScreen';
import { FocusSessionScreen } from '../features/workout/FocusSessionScreen';
import { MoveDemoScreen } from '../features/workout/MoveDemoScreen';
import { PlanScreen } from '../features/workout/PlanScreen';
import { WorkoutCatalogScreen } from '../features/workout/WorkoutCatalogScreen';
import { WorkoutDetailScreen } from '../features/workout/WorkoutDetailScreen';
import { WorkoutResultScreen } from '../features/workout/WorkoutResultScreen';
import { tabLabel } from '../shared/i18n/vi/nav';
import type { ScreenEntry, TabRoot } from './routes';

/** Signed out. */
export const authScreens: ScreenEntry[] = [
  { name: 'Welcome', component: WelcomeScreen },
  { name: 'SignIn', component: SignInScreen },
  { name: 'SignUp', component: SignUpScreen },
  { name: 'ForgotPassword', component: ForgotPasswordScreen },
  { name: 'NewPassword', component: NewPasswordScreen },
];

/** Signed in, onboarding not finished. */
export const onboardingScreens: ScreenEntry[] = [
  { name: 'OnbProfile', component: ProfileStepScreen, options: stepOptions },
  { name: 'OnbActivity', component: ActivityStepScreen, options: stepOptions },
  { name: 'OnbArchetype', component: ArchetypeStepScreen, options: stepOptions },
  { name: 'OnbTargets', component: OnbTargetsScreen, options: stepOptions },
];

/** The first screen of each tab. */
export const tabRoots: TabRoot[] = [
  { name: 'Today', component: TodayScreen, label: tabLabel.Today, icon: 'Sun' },
  { name: 'Plan', component: PlanScreen, label: tabLabel.Plan, icon: 'Route' },
  { name: 'Guild', component: GuildScreen, label: tabLabel.Guild, icon: 'Users' },
  { name: 'Profile', component: ProfileScreen, label: tabLabel.Profile, icon: 'User' },
];

/** Screens that open inside the stack of whichever tab they were opened from. */
export const detailScreens: ScreenEntry[] = [
  { name: 'Targets', component: TargetsScreen },
  { name: 'StatsExplainer', component: StatsExplainerScreen },
  { name: 'QuestBoard', component: QuestBoardScreen },
  { name: 'EndOfDay', component: EndOfDayScreen },
  { name: 'ManualKcal', component: ManualKcalScreen },
  { name: 'MealPlan', component: MealPlanScreen },
  { name: 'MealDetail', component: MealDetailScreen },
  { name: 'MealSwap', component: MealSwapScreen },
  { name: 'WorkoutCatalog', component: WorkoutCatalogScreen },
  { name: 'WorkoutDetail', component: WorkoutDetailScreen },
  { name: 'Journey', component: JourneyScreen },
  { name: 'DayHistory', component: DayHistoryScreen },
  { name: 'Levels', component: LevelsScreen },
  { name: 'Pet', component: PetScreen },
  { name: 'PetStages', component: PetStagesScreen },
  { name: 'Shop', component: ShopScreen },
  { name: 'ShopItem', component: ShopItemScreen },
  { name: 'Inventory', component: InventoryScreen },
  { name: 'GuildJoin', component: GuildJoinScreen },
  { name: 'GuildCreate', component: GuildCreateScreen },
  { name: 'GuildManage', component: GuildManageScreen },
  { name: 'Leaderboard', component: LeaderboardScreen },
  // S29 is a sheet over the guild tab: it closes with "Để lúc khác" or Back.
  { name: 'Nudge', component: NudgeScreen, options: { presentation: 'modal' } },
  { name: 'Inbox', component: InboxScreen },
];

/** Full-screen modal flow above the tabs; the tab bar cannot interrupt it. */
export const focusScreens: ScreenEntry[] = [
  { name: 'FocusSession', component: FocusSessionScreen },
  { name: 'WorkoutResult', component: WorkoutResultScreen },
  // Above S18 and above a running S19: the session stays mounted beneath it, its clock running.
  { name: 'MoveDemo', component: MoveDemoScreen },
];
