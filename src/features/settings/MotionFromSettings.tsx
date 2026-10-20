import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../../shared/api/session';
import {
  MotionPreferenceProvider,
  type MotionPreference,
} from '../../shared/motion/useReducedMotion';
import { readMotionPref, writeMotionPref } from '../../shared/storage/prefs';
import { useMe } from '../auth/api';
import { useSettings } from './api';

/**
 * Feeds `useReducedMotion()` for the whole app from the `motion` setting (S79). The server's answer is read only once the shell is up,
 * so the word is also kept on the device (`prefs:v1:<userId>`) and read from there first: until either is known the app is static
 * (reduced is the safe default), and when neither exists (the very first run) it follows the system, as the setting's default does.
 */
export function MotionFromSettings({ children }: { children: ReactNode }) {
  const { userId } = useSession();
  const onboarded = useMe().data?.user.onboarded === true;
  const motion = useSettings(onboarded).data?.motion;
  // `read`: the stored word of this user, once looked up (undefined inside: nothing stored)
  const [read, setRead] = useState<{
    userId: string;
    motion: MotionPreference | undefined;
  }>();
  useEffect(() => {
    if (!userId) return undefined;
    let current = true;
    readMotionPref(userId).then(
      stored => current && setRead({ userId, motion: stored }),
    );
    return () => {
      current = false;
    };
  }, [userId]);
  useEffect(() => {
    if (userId && motion) writeMotionPref(userId, motion);
  }, [userId, motion]);

  const known = read?.userId === userId ? read : undefined;
  const value: MotionPreference =
    motion ??
    (userId ? (known ? known.motion ?? 'SYSTEM' : 'REDUCED') : 'SYSTEM');
  return (
    <MotionPreferenceProvider value={value}>
      {children}
    </MotionPreferenceProvider>
  );
}
