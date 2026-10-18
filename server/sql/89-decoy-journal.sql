-- Decoy rows of 60-journal.sql: one journal entry of decoy 1 whose body is random bytes in the
-- stored layout (version byte 0x01, then IV, "ciphertext" and tag that decrypt under no key) and
-- whose quote is the seeded Q001. The rules are those of 80-decoy-base.sql (never clean these up;
-- fixed values; ON CONFLICT DO NOTHING). The id is repeated in server/checks/attacks/journal.ts.

INSERT INTO journal_entries (id, user_id, body_encrypted, quote_code, logical_date, created_at)
VALUES ('00000000-0000-4000-8000-0000000d1601', '00000000-0000-4000-8000-0000000000d1',
        '\x01'::bytea || substring(sha512(uuid_send(gen_random_uuid())) FROM 1 FOR 48),
        'Q001', '2026-01-01', '2026-01-01T05:00:00Z')
ON CONFLICT DO NOTHING;
