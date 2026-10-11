import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  CommonActions,
  DefaultTheme,
  NavigationContainer,
  StackActions,
  useIsFocused,
  useNavigation,
  useNavigationContainerRef,
  type InitialState,
  type NavigationAction,
  type NavigationState,
  type PartialState,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMe } from '../features/auth/api';
import { ApiError } from '../shared/api/client';
import { useSession } from '../shared/api/session';
import * as authVi from '../shared/i18n/vi/auth';
import * as commonVi from '../shared/i18n/vi/common';
import * as navVi from '../shared/i18n/vi/nav';
import { useTheme } from '../shared/theme/ThemeProvider';
import { spacing } from '../shared/theme/tokens';
import { Button } from '../shared/ui/Button';
import type { IconName } from '../shared/ui/Icon';
import { Screen } from '../shared/ui/Screen';
import { SnackbarProvider } from '../shared/ui/Snackbar';
import { EmptyState, ErrorState, LoadingState } from '../shared/ui/States';
import { routeNames, type RouteName, type ScreenEntry, type TabRootName } from './routes';
import { authScreens, detailScreens, focusScreens, onboardingScreens, tabRoots } from './screens';
import { TAB_BAR_HEIGHT, TabBar } from './TabBar';

// Structure (PLAN P1.6): one root stack whose content follows the session.
//   signed out                -> the auth screens
//   signed in, not onboarded  -> the onboarding screens
//   signed in, onboarded      -> MainTabs (each tab = a stack: its root + every detail screen) and, above the
//                                tabs, the focus flow as full-screen modals
//
// The four tab-root names are deliberately not the name of any navigator screen: the tab of `Today` is
// `TodayTab` and the first screen of its stack is `TodayRoot`. So `navigate('Today')` is never half-handled by
// whichever stack happens to be mounted (a v7 stack would push a second copy); it always arrives at
// `openTabRoot` below, which does the one right thing from anywhere in the main app.
const Root = createNativeStackNavigator();
const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const MAIN_TABS = 'MainTabs';
const TAB_ORDER: readonly TabRootName[] = ['Today', 'Plan', 'Guild', 'Profile'];
const tabNameOf = (root: string) => `${root}Tab`;
const rootNameOf = (root: string) => `${root}Root`;
const tabsInOrder = () => [...tabRoots].sort((a, b) => TAB_ORDER.indexOf(a.name) - TAB_ORDER.indexOf(b.name));

// Every screen draws its own header (`Screen`); Back is the native one.
const noHeader = { headerShown: false } as const;
const focusFlow = { presentation: 'fullScreenModal', gestureEnabled: false } as const;

const screensOf = (Nav: typeof Stack, entries: readonly ScreenEntry[]) =>
  entries.map(entry => <Nav.Screen key={entry.name} name={entry.name} component={entry.component as ComponentType} options={entry.options} />);

const TabBarShownContext = createContext<(shown: boolean) => void>(() => undefined);

function ShellTabBar(props: BottomTabBarProps) {
  const setShown = useContext(TabBarShownContext);
  // The tab bar belongs to the MainTabs screen of the root stack: not focused while the focus flow covers it.
  const focused = useIsFocused();
  // A detail screen has no tab bar (frames S10 and later); Back returns to the tab root.
  const onDetail = (props.state.routes[props.state.index].state?.index ?? 0) > 0;
  const shown = focused && !onDetail;
  useEffect(() => {
    setShown(shown);
    return () => setShown(false);
  }, [shown, setShown]);
  const icons: Record<string, IconName> = Object.fromEntries(tabRoots.map(tab => [tabNameOf(tab.name), tab.icon]));
  return onDetail ? null : <TabBar {...props} icons={icons} />;
}
const renderTabBar = (props: BottomTabBarProps) => <ShellTabBar {...props} />;

function TabStack({ route }: { route: { name: string } }) {
  const root = tabRoots.find(tab => tabNameOf(tab.name) === route.name);
  return (
    <Stack.Navigator screenOptions={noHeader}>
      {root ? <Stack.Screen name={rootNameOf(root.name)} component={root.component as ComponentType} options={root.options} /> : null}
      {screensOf(Stack, detailScreens)}
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator tabBar={renderTabBar} screenOptions={noHeader}>
      {tabsInOrder().map(tab => (
        <Tabs.Screen key={tab.name} name={tabNameOf(tab.name)} component={TabStack} options={{ title: tab.label }} />
      ))}
    </Tabs.Navigator>
  );
}

function SignOutButton() {
  const { signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  return (
    <Button
      variant="secondary"
      label={authVi.signOut}
      loading={leaving}
      onPress={() => {
        setLeaving(true);
        signOut();
      }}
    />
  );
}

/** S39, loading: the session is being restored or `GET /me` is on its way. */
function Pending() {
  return (
    <Screen title={authVi.loadingTitle} subtitle={authVi.loadingSubtitle}>
      <View style={styles.afterHeader} />
      <LoadingState />
    </Screen>
  );
}

/** S39, error: `GET /me` failed and there is nothing cached to start from. */
function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiError ? error.code : undefined;
  const reasons: Partial<Record<string, string>> = commonVi.errorText;
  const message = code === 'NETWORK' || code === 'TIMEOUT' ? authVi.loadFailedOffline : (code && reasons[code]) || commonVi.unknownError;
  return (
    <Screen title={authVi.loadingTitle}>
      <View style={styles.stack}>
        <ErrorState message={message} onRetry={onRetry} />
        <SignOutButton />
      </View>
    </Screen>
  );
}

/** A group whose screens have not been registered yet (AR-25): say so and offer the way out. */
function GroupPending() {
  return (
    <Screen title={authVi.productName}>
      <View style={styles.stack}>
        <EmptyState title={navVi.groupPendingTitle} body={navVi.groupPendingBody} />
        <SignOutButton />
      </View>
    </Screen>
  );
}

/** Signed in: `GET /me` decides between onboarding and the main app. */
function SignedIn() {
  const me = useMe();
  // A failed refresh keeps the data already on screen; only a first load without data stops here.
  if (!me.data) return me.isError ? <LoadFailed error={me.error} onRetry={() => me.refetch()} /> : <Pending />;
  if (!me.data.user.onboarded) {
    if (!onboardingScreens.length) return <GroupPending />;
    return <Root.Navigator screenOptions={noHeader}>{screensOf(Root, onboardingScreens)}</Root.Navigator>;
  }
  if (!tabRoots.length) return <GroupPending />;
  return (
    <Root.Navigator screenOptions={noHeader}>
      <Root.Screen name={MAIN_TABS} component={MainTabs} />
      <Root.Group screenOptions={focusFlow}>{screensOf(Root, focusScreens)}</Root.Group>
    </Root.Navigator>
  );
}

function RootNavigator() {
  const session = useSession();
  const navigation = useNavigation();
  const expired = session.status === 'signedOut' && session.expired;
  useEffect(() => {
    // The server ended the session: land on SignIn, which shows the notice, with Welcome underneath for Back.
    if (expired) navigation.navigate('SignIn');
  }, [expired, navigation]);

  if (session.status === 'loading') return <Pending />;
  if (session.status === 'signedOut') return <Root.Navigator screenOptions={noHeader}>{screensOf(Root, authScreens)}</Root.Navigator>;
  return <SignedIn />;
}

type AnyState = NavigationState | PartialState<NavigationState>;
type Dispatcher = { getRootState(): AnyState | undefined; dispatch(action: NavigationAction): void };

/**
 * `navigate('<tab root>')` from anywhere in the main app (another tab, a detail, the focus flow): the focus flow
 * closes, the tab is selected and its stack is back on its root. False when the tabs are not on screen.
 */
function openTabRoot(navigation: Dispatcher, root: string): boolean {
  const tabs = navigation.getRootState()?.routes.find(route => route.name === MAIN_TABS)?.state;
  const tab = tabs?.routes.find(route => route.name === tabNameOf(root));
  if (!tabs?.key || !tab) return false;
  // A NAVIGATE (not a JUMP_TO) handled by the tabs also brings MainTabs back to the front of the root stack.
  navigation.dispatch({ ...CommonActions.navigate(tab.name), target: tabs.key });
  // Only a stack that shows a detail has anything to pop (never visited = no state yet = on its root).
  if (tab.state?.key && (tab.state.index ?? 0) > 0) navigation.dispatch({ ...StackActions.popToTop(), target: tab.state.key });
  return true;
}

const isRegistered = (name: string) =>
  [authScreens, onboardingScreens, tabRoots, detailScreens, focusScreens].some(group => group.some(entry => entry.name === name));

/**
 * The navigation state that opens the app on `name`, through the real navigators (preview entries, tests).
 * The session and `['me']` must match the group the route belongs to, or the gate shows that group instead.
 */
export function stateForRoute(name: RouteName, params?: object): InitialState {
  const route = { name, params };
  const inTab = (tab: string, routes?: { name: string; params?: object }[]) => ({
    routes: [{ name: MAIN_TABS, state: { routes: [{ name: tabNameOf(tab), state: routes && { routes } }] } }],
  });
  if (tabRoots.some(tab => tab.name === name)) return inTab(name);
  const firstTab = tabsInOrder()[0];
  if (firstTab && detailScreens.some(entry => entry.name === name)) return inTab(firstTab.name, [{ name: rootNameOf(firstTab.name) }, route]);
  if (focusScreens.some(entry => entry.name === name)) return { routes: [{ name: MAIN_TABS }, route] };
  return { routes: [route] };
}

/**
 * Everything navigation: the container, the session gate and the navigators, under the app-wide snackbar (which
 * floats above the tab bar while a tab root is showing). Needs the theme, query and session providers above it.
 * `children` are hosts that live above the navigators but inside the container (celebrations, sync banner).
 */
export function AppNavigation({ initialState, children }: { initialState?: InitialState; children?: ReactNode }) {
  const palette = useTheme();
  const [tabBarShown, setTabBarShown] = useState(false);
  const theme = useMemo<Theme>(
    () => ({
      ...DefaultTheme,
      colors: { ...DefaultTheme.colors, primary: palette.primary, background: palette.bg, card: palette.white, text: palette.ink, border: palette.line },
    }),
    [palette],
  );
  const navigationRef = useNavigationContainerRef();
  const onUnhandledAction = useCallback(
    (action: NavigationAction) => {
      const name = (action.payload as { name?: unknown } | undefined)?.name;
      if (typeof name === 'string') {
        if (action.type === 'NAVIGATE' && TAB_ORDER.some(root => root === name) && openTabRoot(navigationRef, name)) return;
        // AR-25: a link to a declared route whose screen has not been registered yet is inert.
        if (routeNames.some(declared => declared === name) && !isRegistered(name)) return;
      }
      // Anything else is a mistake worth seeing: an undeclared name, or a route of a group that is not on screen.
      if (__DEV__) console.error(`Navigation: ${action.type}${typeof name === 'string' ? ` "${name}"` : ''} was not handled by any navigator.`);
    },
    [navigationRef],
  );
  return (
    <SnackbarProvider bottomOffset={tabBarShown ? TAB_BAR_HEIGHT : 0}>
      <NavigationContainer ref={navigationRef} theme={theme} initialState={initialState} onUnhandledAction={onUnhandledAction}>
        <TabBarShownContext.Provider value={setTabBarShown}>
          <RootNavigator />
        </TabBarShownContext.Provider>
        {children}
      </NavigationContainer>
    </SnackbarProvider>
  );
}

const styles = StyleSheet.create({
  afterHeader: { height: spacing.section - 8 },
  stack: { gap: spacing.section, marginTop: spacing.section - 8 },
});
