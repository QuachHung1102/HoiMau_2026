-- Idempotent writes: one row per (user, Idempotency-Key). Re-runnable.
--
-- A stored response may carry personal data, so no request role reads the table: the HTTP layer
-- reaches it only through the three functions below, which take the user from
-- app.current_user_id(). A key therefore names a row of the caller only: somebody else's key is
-- simply a new key.
--
-- One key = one user action, and only a 2xx answer is remembered. A row without a status exists
-- only inside the transaction of the request that claimed the key: that request either stores
-- its 2xx answer, or gives the key back (any other answer), or rolls back. No committed row is
-- ever without a status, which is why a reader needs no lock of its own.
--
-- request_hash is a keyed hash made by the server (HMAC): a request body can hold a password,
-- and a plain hash of it would be a fast oracle for whoever reads this table.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key uuid NOT NULL,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  status int CHECK (status BETWEEN 200 AND 299),
  response jsonb,
  -- the purge job deletes by this
  created_at timestamptz NOT NULL DEFAULT app.now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON idempotency_keys FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_table('idempotency_keys', 'internal', '{}', '{}', NULL);

-- Claims p_key for the caller and returns the state of its row. A second request with the same
-- key waits in the INSERT until the first one commits or rolls back (for at most lock_timeout:
-- then it fails with 55P03 and the server tells the client to retry), and then reads what the
-- first one left: that is what makes two requests sent at the same moment run the handler once.
--   same_request false              -> the key belongs to another request of this user
--   same_request true, status null  -> the caller holds the key: run the request, then call
--                                      idempotency_store or idempotency_release
--   same_request true, status set   -> answer with status and response, run nothing
--   no row                          -> the stored row was deleted meanwhile: retry
CREATE OR REPLACE FUNCTION idempotency_begin(p_key uuid, p_request_hash bytea)
RETURNS TABLE (same_request boolean, status int, response jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
BEGIN
  IF v_user IS NULL OR p_key IS NULL OR octet_length(p_request_hash) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'idempotency_begin: needs a user, a key and a 32-byte request hash';
  END IF;
  INSERT INTO idempotency_keys (user_id, key, request_hash)
  VALUES (v_user, p_key, p_request_hash)
  ON CONFLICT (user_id, key) DO NOTHING;
  RETURN QUERY
    SELECT k.request_hash = p_request_hash, k.status, k.response
      FROM idempotency_keys k
     WHERE k.user_id = v_user AND k.key = p_key;
END $$;

-- Stores the 2xx answer of the request that holds p_key. Never replaces a stored answer.
CREATE OR REPLACE FUNCTION idempotency_store(p_key uuid, p_status int, p_response jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE idempotency_keys k SET status = p_status, response = p_response
   WHERE k.user_id = app.current_user_id() AND k.key = p_key AND k.status IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'idempotency_store: the caller holds no open key';
  END IF;
END $$;

-- Gives p_key back when the request that holds it ends without a 2xx answer: the next request
-- with this key starts from nothing, with the same or with a corrected body. Never removes a
-- stored answer.
CREATE OR REPLACE FUNCTION idempotency_release(p_key uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  DELETE FROM idempotency_keys k
   WHERE k.user_id = app.current_user_id() AND k.key = p_key AND k.status IS NULL
$$;

REVOKE ALL ON FUNCTION
  idempotency_begin(uuid, bytea), idempotency_store(uuid, int, jsonb), idempotency_release(uuid)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  idempotency_begin(uuid, bytea), idempotency_store(uuid, int, jsonb), idempotency_release(uuid)
  TO app_auth;

SELECT meta.expect_function('idempotency_begin(uuid, bytea)', 'definer', '{app_auth}');
SELECT meta.expect_function('idempotency_store(uuid, int, jsonb)', 'definer', '{app_auth}');
SELECT meta.expect_function('idempotency_release(uuid)', 'definer', '{app_auth}');
