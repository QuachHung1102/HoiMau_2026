-- Decoy rows of 52-nudge.sql: one nudge from decoy 1 to decoy 2 (both of the decoy guild,
-- 86-decoy-guild.sql) with a seeded template. The rules are those of 80-decoy-base.sql (never
-- clean these up; fixed values; ON CONFLICT DO NOTHING). The values are repeated in
-- server/checks/attacks/nudge.ts.

INSERT INTO nudge_events (id, sender_id, receiver_id, template_code, sender_date, receiver_date, sent_at, created_at)
VALUES ('00000000-0000-4000-8000-0000000d1501', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-0000000000d2', 'MOVE_TOGETHER', '2026-01-02', '2026-01-02',
        '2026-01-02T06:00:00Z', '2026-01-02T06:00:00Z')
ON CONFLICT DO NOTHING;
