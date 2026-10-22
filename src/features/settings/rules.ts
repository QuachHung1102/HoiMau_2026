/**
 * Days between two free changes of direction (R-01.1). The server owns the rule (`profile_set_archetype`: archetype_set_at + 336 hours,
 * and `ARCHETYPE_COOLDOWN_MS` of readModels/me.ts); `helpContent.test.ts` compares this number with both.
 */
export const ARCHETYPE_COOLDOWN_DAYS = 14;

/**
 * Days between the deletion of an account and the removal of its data. The server owns the rule (`account_delete` of 61-privacy.sql:
 * `purge_after = app.now() + interval '30 days'`); `PrivacyScreen.test.tsx` compares this number with it.
 */
export const ACCOUNT_PURGE_DAYS = 30;
