/* eslint-env jest */
// Test-only: the real screen registry with every `navigate` call recorded on its way to the navigator, and the latest
// `navigation` prop of each screen kept, so that a test can assert a link to a route no task has registered yet (inert,
// AR-25: NotificationSettings, Task 47) by name, and can open a route with params no screen offers (a nudge whose reason is
// already known). Used through `jest.mock('../../app/screens', () => require('../guild/navigationSpy').spied(jest.requireActual('../../app/screens')))`.
import { createElement, type ComponentType } from 'react';

type Navigation = { navigate(...to: unknown[]): void };
type Entry = { name: string; component: unknown };
/** Every `navigate(...)` the screens made, in order. */
export const navigated: unknown[][] = [];
/** The `navigation` prop each screen was last rendered with, by route name. */
export const navigations: Record<string, Navigation> = {};
export const forget = () => {
  navigated.length = 0;
  for (const name of Object.keys(navigations)) delete navigations[name];
};

const spy = (entry: Entry) => {
  function Spied(props: { navigation: Navigation }) {
    navigations[entry.name] = props.navigation;
    const navigate = (...to: unknown[]) => {
      navigated.push(to);
      props.navigation.navigate(...to);
    };
    return createElement(entry.component as ComponentType<{ navigation: Navigation }>, { ...props, navigation: { ...props.navigation, navigate } });
  }
  return { ...entry, component: Spied };
};

export function spied<T extends { tabRoots: Entry[]; detailScreens: Entry[] }>(actual: T): T {
  return { ...actual, tabRoots: actual.tabRoots.map(spy), detailScreens: actual.detailScreens.map(spy) };
}
