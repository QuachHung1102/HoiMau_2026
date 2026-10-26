import type { Archetype } from '../../domain/types.ts';
import type { QuestSeed } from './types.ts';

const ALL: Archetype[] = ['TANKER', 'ASSASSIN', 'SUPPORTER'];

// Rewards are those of spec F-06 / D-07: target / XP / coins.
export const QUESTS: QuestSeed[] = [
  {
    code: 'WORKOUT_MAIN',
    titleKey: 'WORKOUT_MAIN',
    category: 'STORY',
    targetCount: 1,
    xpReward: 50,
    coinReward: 20,
    archetypes: ALL,
    isActive: true,
  },
  {
    code: 'NUTRITION_TARGET',
    titleKey: 'NUTRITION_TARGET',
    category: 'STORY',
    targetCount: 1,
    xpReward: 50,
    coinReward: 20,
    archetypes: ALL,
    isActive: true,
  },
  {
    code: 'WATER_8',
    titleKey: 'WATER_8',
    category: 'DAILY',
    targetCount: 8,
    xpReward: 10,
    coinReward: 5,
    archetypes: ALL,
    isActive: true,
  },
  {
    code: 'STAND_UP',
    titleKey: 'STAND_UP',
    category: 'DAILY',
    targetCount: 6,
    xpReward: 10,
    coinReward: 5,
    archetypes: ALL,
    isActive: true,
  },
  {
    code: 'BEDTIME_BEFORE_23',
    titleKey: 'BEDTIME_BEFORE_23',
    category: 'HIDDEN',
    targetCount: 1,
    xpReward: 30,
    coinReward: 15,
    archetypes: ALL,
    isActive: true,
  },
];
