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
import { ActivityStepScreen } from '../features/onboarding/ActivityStepScreen';
import { ArchetypeStepScreen } from '../features/onboarding/ArchetypeStepScreen';
import { ProfileStepScreen } from '../features/onboarding/ProfileStepScreen';
import { stepOptions } from '../features/onboarding/StepScreen';
import { OnbTargetsScreen, TargetsScreen } from '../features/onboarding/TargetsScreen';
import { ManualKcalScreen } from '../features/nutrition/ManualKcalScreen';
import { EndOfDayScreen } from '../features/quests/EndOfDayScreen';
import { QuestBoardScreen } from '../features/quests/QuestBoardScreen';
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
export const tabRoots: TabRoot[] = [{ name: 'Today', component: TodayScreen, label: tabLabel.Today, icon: 'Sun' }];

/** Screens that open inside the stack of whichever tab they were opened from. */
export const detailScreens: ScreenEntry[] = [
  { name: 'Targets', component: TargetsScreen },
  { name: 'StatsExplainer', component: StatsExplainerScreen },
  { name: 'QuestBoard', component: QuestBoardScreen },
  { name: 'EndOfDay', component: EndOfDayScreen },
  { name: 'ManualKcal', component: ManualKcalScreen },
];

/** Full-screen modal flow above the tabs; the tab bar cannot interrupt it. */
export const focusScreens: ScreenEntry[] = [];
