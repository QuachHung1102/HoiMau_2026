// What the person has entered during onboarding, kept above the navigators so Back loses nothing.
// Memory only: measurements never reach AsyncStorage, navigation params, logs or the disk cache. The state belongs
// to one signed-in user: it starts empty again whenever `useSession().userId` changes, and after a finished onboarding.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OnboardingRequest } from '../../../domain/contract/core.ts';
import type { ActivityLevel, Archetype, Sex } from '../../../domain/types.ts';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import { noErrors, type FormErrors } from '../auth/form';
import { parseDecimal, parseYear } from './BiometricsFields';

/** The body properties of `POST /onboarding`, in form order. */
export const ONBOARDING_FIELDS = ['birthYear', 'heightCm', 'weightKg', 'sex', 'timezone', 'activityLevel', 'archetype'] as const;
export type OnboardingField = (typeof ONBOARDING_FIELDS)[number];

/** The step that shows a field (and its error). */
export const STEP_OF = {
  birthYear: 'OnbProfile',
  heightCm: 'OnbProfile',
  weightKg: 'OnbProfile',
  sex: 'OnbProfile',
  timezone: 'OnbProfile',
  activityLevel: 'OnbActivity',
  archetype: 'OnbArchetype',
} as const satisfies Record<OnboardingField, string>;

export type OnboardingDraft = {
  /** The three numbers as typed; they are parsed when a step validates. */
  birthYear: string;
  heightCm: string;
  weightKg: string;
  sex: Sex | null;
  /** null until the profile step is passed: the field then shows the default zone. */
  timezone: string | null;
  activityLevel: ActivityLevel | null;
  archetype: Archetype | null;
};
/** A refusal that replaces the form: under 16 (S61, on the profile step) or a direction that is not offered (S43). */
export type OnboardingBlock = 'age' | 'archetype' | null;

export type OnboardingState = { draft: OnboardingDraft; errors: FormErrors<OnboardingField>; block: OnboardingBlock };

export type Onboarding = OnboardingState & {
  /** Bumped by `fail`: the step on screen moves focus to its first invalid field. */
  focusRequest: number;
  /** Changes inputs. A real change clears the errors of those fields and ends the current submit attempt. */
  edit(patch: Partial<OnboardingDraft>): void;
  /** Shows field errors (S60, or a server `VALIDATION_FAILED`) on the steps that own the fields. */
  fail(errors: FormErrors<OnboardingField>): void;
  setBlock(block: OnboardingBlock): void;
  /** The Idempotency-Key of the current attempt: the same value until an input changes. */
  attemptKey(): string;
  /** Forgets everything (after a finished onboarding). */
  reset(): void;
};

const emptyDraft: OnboardingDraft = { birthYear: '', heightCm: '', weightKg: '', sex: null, timezone: null, activityLevel: null, archetype: null };
const emptyState: OnboardingState = { draft: emptyDraft, errors: noErrors, block: null };

/** The request for the draft, or null while something is missing or unreadable. */
export function requestOf(draft: OnboardingDraft): OnboardingRequest | null {
  const heightCm = parseDecimal(draft.heightCm);
  const weightKg = parseDecimal(draft.weightKg);
  const birthYear = parseYear(draft.birthYear);
  const { sex, timezone, activityLevel, archetype } = draft;
  if (heightCm === null || weightKg === null || birthYear === null || !sex || !timezone || !activityLevel || !archetype) return null;
  return { heightCm, weightKg, birthYear, sex, activityLevel, timezone, archetype };
}

const Context = createContext<Onboarding | null>(null);

type Props = {
  children: ReactNode;
  /** A starting state for previews and tests; the app starts empty. */
  initial?: Partial<Omit<OnboardingState, 'draft'>> & { draft?: Partial<OnboardingDraft> };
};

export function OnboardingProvider({ children, initial }: Props) {
  const { userId } = useSession();
  const [held, setHeld] = useState(() => ({
    owner: userId,
    focusRequest: 0,
    ...emptyState,
    ...initial,
    draft: { ...emptyDraft, ...initial?.draft },
  }));
  // Another person on this phone must never see these values: a state that belongs to someone else is dropped
  // during this render, before any screen can read it. (A state without an owner was created before the session
  // was restored; nobody can have typed into it, so the first user to appear takes it over.)
  const state = useMemo(() => {
    if (held.owner === userId) return held;
    return held.owner === null ? { ...held, owner: userId } : { owner: userId, focusRequest: 0, ...emptyState };
  }, [held, userId]);
  if (state !== held) setHeld(state);

  const key = useRef<string | null>(null);
  useEffect(() => {
    key.current = null;
  }, [userId]);

  const edit = useCallback((patch: Partial<OnboardingDraft>) => {
    setHeld(current => {
      const changed = (Object.keys(patch) as (keyof OnboardingDraft)[]).filter(field => patch[field] !== current.draft[field]);
      if (changed.length === 0) return current;
      key.current = null; // new inputs are a new attempt (clearing twice is harmless, so this may sit in the updater)
      const fields = { ...current.errors.fields };
      for (const field of changed) delete fields[field];
      return { ...current, draft: { ...current.draft, ...patch }, errors: { fields } };
    });
  }, []);
  const fail = useCallback(
    (errors: FormErrors<OnboardingField>) => setHeld(current => ({ ...current, errors, focusRequest: current.focusRequest + 1 })),
    [],
  );
  const setBlock = useCallback((block: OnboardingBlock) => setHeld(current => ({ ...current, block })), []);
  const attemptKey = useCallback(() => (key.current ??= newActionId()), []);
  const reset = useCallback(() => {
    key.current = null;
    setHeld(current => ({ owner: current.owner, focusRequest: 0, ...emptyState }));
  }, []);

  const value = useMemo(() => ({ ...state, edit, fail, setBlock, attemptKey, reset }), [state, edit, fail, setBlock, attemptKey, reset]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOnboarding(): Onboarding {
  const value = useContext(Context);
  if (!value) throw new Error('useOnboarding needs an OnboardingProvider above it');
  return value;
}
