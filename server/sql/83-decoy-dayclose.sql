-- Decoy rows of 32-dayclose.sql and 33-inbox.sql for decoy 1: a ticket used for its day of
-- 81-decoy-day.sql, the week that ticket was granted for, and one unread notification. The rules
-- are those of 80-decoy-base.sql (never clean these up; fixed ids; ON CONFLICT DO NOTHING). The
-- ids are repeated in server/checks/attacks/dayclose.ts. No job processes the decoy: its
-- onboarded_at is null.

INSERT INTO freeze_tickets (id, user_id, granted_at, grant_week, used_at, used_for_date, created_at)
VALUES ('00000000-0000-4000-8000-0000000d100e', '00000000-0000-4000-8000-0000000000d1',
        '2025-12-29T05:00:00Z', '2025-12-29', '2026-01-01T05:00:00Z', '2026-01-01', '2025-12-29T05:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO ticket_grant_weeks (user_id, week_start, granted, created_at)
VALUES ('00000000-0000-4000-8000-0000000000d1', '2025-12-29', true, '2025-12-29T05:00:00Z')
ON CONFLICT DO NOTHING;

-- Unread: marking it read is exactly what another user must not be able to do.
INSERT INTO notifications (id, user_id, kind, payload, dedupe_key, created_at)
VALUES ('00000000-0000-4000-8000-0000000d100f', '00000000-0000-4000-8000-0000000000d1',
        'PET_TIRED', '{}', '2026-01-01', '2026-01-01T05:00:00Z')
ON CONFLICT DO NOTHING;
