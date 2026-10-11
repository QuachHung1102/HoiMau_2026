import { routeNames } from '../src/app/routes';
import { authScreens, detailScreens, focusScreens, onboardingScreens, tabRoots } from '../src/app/screens';

const groups = { authScreens, onboardingScreens, tabRoots, detailScreens, focusScreens };
const registered = Object.values(groups).flatMap(group => group.map(entry => entry.name));

test('the route list declares 54 distinct names', () => {
  expect(new Set(routeNames).size).toBe(routeNames.length);
  expect(routeNames).toHaveLength(54);
});

// Task 49 flips this to equality (every declared route is registered).
test('every registered screen is a declared route, registered once', () => {
  expect(registered.filter(name => !routeNames.includes(name))).toEqual([]);
  expect(registered.filter((name, i) => registered.indexOf(name) !== i)).toEqual([]);
});

test('Welcome is registered in the signed-out group', () => {
  expect(authScreens.map(entry => entry.name)).toContain('Welcome');
});

test('every entry has a component, and a tab root also a label and an icon', () => {
  for (const entry of Object.values(groups).flat()) expect(typeof entry.component).toBe('function');
  for (const tab of tabRoots) {
    expect(tab.label).toBeTruthy();
    expect(tab.icon).toBeTruthy();
  }
});
