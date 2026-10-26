/* eslint-env jest */
// Test-only stand-ins for the leaderboard and the nudge, so that a guild test can follow a press to the route it names
// and read the params it carried. The nudge settings are a real screen: GuildManageScreen.test opens the real one.
// Used through `jest.mock('../../app/screens', ...)` in the guild tests; never imported by app code.
import type { ComponentType } from 'react';
import { Text } from 'react-native';

const NAMES = ['Leaderboard', 'Nudge'];

const probe = (name: string): ComponentType<{ route: { params?: object } }> =>
  function Probe({ route }) {
    return <Text accessibilityRole="header">{`${name} ${JSON.stringify(route.params ?? {})}`}</Text>;
  };

/** The registry with these routes answered by a probe, whether or not the real screen exists by now. */
export function withProbes<T extends { detailScreens: { name: string }[] }>(actual: T): T {
  return {
    ...actual,
    detailScreens: [...actual.detailScreens.filter(entry => !NAMES.includes(entry.name)), ...NAMES.map(name => ({ name, component: probe(name) }))],
  };
}
