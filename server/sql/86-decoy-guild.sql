-- Decoy rows of 50-guild.sql: the guild "decoy-guild" with decoy 1 as its LEADER and decoy 2 as
-- a MEMBER. The rules are those of 80-decoy-base.sql (never clean these up; fixed values; ON
-- CONFLICT DO NOTHING). Its invite code holds O and 0, outside the AR-18 alphabet: guild_join
-- refuses such a code before it looks, so nobody can join the decoy guild. The values are
-- repeated in server/checks/attacks/guild.ts.

INSERT INTO guilds (id, name, motto, invite_code, created_at)
VALUES ('00000000-0000-4000-8000-0000000d1301', 'decoy-guild', 'Mồi nhử', 'DECOY000', '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO guild_memberships (user_id, guild_id, role, joined_at, created_at) VALUES
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000d1301', 'LEADER',
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000d1301', 'MEMBER',
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;
