import type { Me, Pet } from '../../../domain/contract/core.ts';
import { CelebrationOverlay } from '../../../src/features/progression/CelebrationHost';
import { petKey } from '../../../src/features/shop/api';
import { withApp, type Entries } from '../harness';
import { app, meOf } from './today';

// Illustrative values, as in frames S22 and S70: a Mầm nhú at 64 % towards Chồi non. The server's `Pet` is what the screens
// read; the profile carries the same one.
export const petOf = (more: Partial<Pet> = {}): Pet => ({ stage: 'HATCHLING', stageIndex: 1, growthPercent: 64, mood: 'HAPPY', skinCode: 'SKIN_DEFAULT', nextStage: 'JUVENILE', ...more });
export const meWith = (pet: Pet, more: Partial<Me> = {}): Me => ({ ...meOf(), pet, ...more });

const seen = (pet: Pet) => ({ route: 'Pet' as const, me: meWith(pet), queries: [[petKey, pet]] as [readonly unknown[], unknown][] });

export const entries: Entries = {
  's22-pet': () => app(seen(petOf())),
  // Tired is the mood at the floor: the stage and the growth stay as they were.
  's70-pet-tired': () => app(seen(petOf({ mood: 'TIRED' }))),
  's68-pet-stages': () => app({ ...seen(petOf()), route: 'PetStages' }),
  // The overlay is what CelebrationHost puts on screen (its own component), with the final card of a reduced-motion run.
  's69-pet-evolve-overlay': () =>
    withApp(<CelebrationOverlay shown={{ id: 'pet-stage-up:1', kind: 'PET_STAGE_UP', stage: 'JUVENILE' }} stage="JUVENILE" onClose={() => undefined} onSee={() => undefined} />, {
      motion: 'REDUCED',
    }),
};
