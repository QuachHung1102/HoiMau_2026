-- The in-app inbox (the guaranteed channel: there are no OS notifications). Re-runnable.
--
-- A notification is written by app._notify, called by a job or a function that decided it; the
-- owner reads it and may set read_at, and nothing else, by a plain UPDATE under row level security
-- (POST /inbox/read).
--
-- Rules for whoever edits this file, or writes a notification:
--   * kind is one of the five of the contract's InboxItem union (domain/contract/core.ts), held by
--     a CHECK: a kind the app cannot show is refused at the insert. A new kind is a change of the
--     contract first;
--   * the payload is the object the contract gives that kind (PET_TIRED and QUEST_REMINDER: {});
--   * (user_id, kind, dedupe_key) is unique: a notification that may exist once (a milestone, a
--     date) carries its natural key, and the second insert is nothing. A null key never conflicts;
--   * created_at is unique per user (an index) and rises strictly (app._notify: app.now(), or the
--     user's latest plus one microsecond): the inbox pages by it alone. Every caller of
--     app._notify holds the receiver's users row (FOR NO KEY UPDATE, the first lock of the one
--     lock order) before it calls it, so two writers of one inbox run one after the other;
--   * time is app.now() only.

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('NUDGE', 'STREAK_MILESTONE', 'PET_TIRED', 'GUILD_WEEKLY_RESULT', 'QUEST_REMINDER')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT notifications_once_key UNIQUE (user_id, kind, dedupe_key)
);
-- One instant per item of one user: the inbox pages by created_at alone. A writer that does not
-- hold the receiver's users row (two inserts of one inbox at one instant) fails here, loudly,
-- instead of hiding an item at a page boundary.
DROP INDEX IF EXISTS notifications_user_created_idx;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_created_key ON notifications (user_id, created_at);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON notifications;
CREATE POLICY own_select ON notifications FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_update ON notifications;
CREATE POLICY own_update ON notifications FOR UPDATE TO app_auth
  USING (app.current_user_id() = user_id) WITH CHECK (app.current_user_id() = user_id);

REVOKE ALL ON notifications FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON notifications TO app_auth;
GRANT UPDATE (read_at) ON notifications TO app_auth;

SELECT meta.expect_table('notifications', 'own_rw', '{SELECT}', '{read_at}', 'user_id');
SELECT meta.expect_policy('notifications', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_policy('notifications', 'own_update', 'UPDATE',
  '(app.current_user_id() = user_id)', '(app.current_user_id() = user_id)');

-- One notification for p_user, unless (p_user, p_kind, p_dedupe_key) has one already. True when
-- this call created it. The caller holds p_user's users row lock (see the rules above): without
-- it two concurrent calls can pick one instant, and the second fails on the unique index.
-- Internal: EXECUTE for no role, not SECURITY DEFINER (it runs with the rights of the function
-- that decided the notification).
CREATE OR REPLACE FUNCTION app._notify(p_user uuid, p_kind text, p_payload jsonb, p_dedupe_key text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO notifications (user_id, kind, payload, dedupe_key, created_at)
  SELECT p_user, p_kind, p_payload, p_dedupe_key,
         greatest(app.now(), max(n.created_at) + interval '1 microsecond')
    FROM notifications n WHERE n.user_id = p_user
  ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION app._notify(uuid, text, jsonb, text) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._notify(uuid, text, jsonb, text)', 'invoker', '{}');
