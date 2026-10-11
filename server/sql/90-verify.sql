-- The schema checks itself: the catalog must match the design and the registry of 02-meta.sql.
-- Runs as the superuser at the end of every migration and as the gate `npm run db:verify`.
-- It is generic over the registry: a feature file registers its objects, it never edits this.
-- Every violation raises an exception that names the object.
--
-- Two rules for whoever edits it:
--   * compare with what is intact, by equality. Never look for a known breakage, never LIKE
--     on an expression: USING (owner() OR true) still contains "owner()";
--   * an assertion that no mutation can make fail is dead. The mutation check proves each one.

DO $verify$
DECLARE
  app_roles CONSTANT text[] := ARRAY['app_anon', 'app_auth', 'app_conn', 'app_job'];
  table_privileges CONSTANT text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
  r record;
  role_name text;
  privilege text;
  found text;
  held text[];
  expected text[];
BEGIN
  -- Names print without their schema exactly when it is public, whatever the caller's setting.
  PERFORM set_config('search_path', 'public, pg_temp', true);

  -- (1) Roles. app_conn logs in and inherits nothing; the others cannot log in; none is elevated.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_conn' AND rolcanlogin AND NOT rolinherit) THEN
    RAISE EXCEPTION 'role app_conn must be LOGIN NOINHERIT';
  END IF;
  FOR r IN SELECT * FROM pg_roles WHERE rolname LIKE 'app\_%' ORDER BY rolname LOOP
    IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication THEN
      RAISE EXCEPTION 'role % is SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION', r.rolname;
    END IF;
    IF r.rolcanlogin AND r.rolname <> 'app_conn' THEN
      RAISE EXCEPTION 'role % can log in: only app_conn may', r.rolname;
    END IF;
  END LOOP;
  -- Since PostgreSQL 16 inheritance is a property of each membership, not of rolinherit alone.
  SELECT string_agg(format('%s in %s (inherit %s, set %s, admin %s)',
                           m.rolname, g.rolname, am.inherit_option, am.set_option, am.admin_option), '; ')
    INTO found
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
   WHERE m.rolname LIKE 'app\_%'
     AND NOT (m.rolname = 'app_conn' AND g.rolname IN ('app_anon', 'app_auth', 'app_job')
              AND NOT am.inherit_option AND am.set_option AND NOT am.admin_option);
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'role membership must be only app_conn in app_anon, app_auth, app_job WITH INHERIT FALSE, SET TRUE; found: %', found;
  END IF;
  FOREACH role_name IN ARRAY ARRAY['app_anon', 'app_auth', 'app_job'] LOOP
    IF NOT pg_has_role('app_conn', role_name, 'SET') THEN
      RAISE EXCEPTION 'app_conn cannot SET ROLE %', role_name;
    END IF;
  END LOOP;

  -- Schemas: the three request and job roles may use public and app; nobody creates anything,
  -- app_conn and meta stay closed.
  SELECT string_agg(format('%s on schema %s', x, n.nspname), ', ')
    INTO found
    FROM pg_namespace n CROSS JOIN unnest(app_roles) x
   WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND (has_schema_privilege(x, n.oid, 'CREATE')
          OR has_schema_privilege(x, n.oid, 'USAGE') <> (n.nspname IN ('public', 'app') AND x <> 'app_conn'));
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'schema privileges must be only USAGE on public and app for app_anon, app_auth, app_job; wrong: %', found;
  END IF;

  -- (3) Every registered table exists ...
  SELECT string_agg(e.name, ', ')
    INTO found
    FROM meta.expected_tables e
   WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = e.name
                        AND c.relkind IN ('r', 'p', 'v', 'm', 'f'));
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'registered table does not exist: %', found;
  END IF;

  -- Tables, and everything else that holds rows, in every schema of ours.
  FOR r IN
    SELECT c.oid, c.oid::regclass::text AS label, n.nspname, c.relrowsecurity,
           pg_get_userbyid(c.relowner) AS owner,
           e.class, e.auth_privileges, e.auth_update_columns, e.owner_column
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN meta.expected_tables e ON n.nspname = 'public' AND e.name = c.relname
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     ORDER BY 2
  LOOP
    -- (2) RLS does not apply to the owner of a table.
    IF r.owner LIKE 'app\_%' THEN
      RAISE EXCEPTION 'table % is owned by app role %', r.label, r.owner;
    END IF;
    -- (3) ... and every table in public is registered.
    IF r.nspname = 'public' AND r.class IS NULL THEN
      RAISE EXCEPTION 'table % is not registered (meta.expect_table)', r.label;
    END IF;
    -- (4) Per class.
    IF r.class IN ('own_read', 'own_rw', 'internal') AND NOT r.relrowsecurity THEN
      RAISE EXCEPTION 'table % (%): row level security is off', r.label, r.class;
    END IF;
    IF r.owner_column IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = r.oid AND a.attname = r.owner_column AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'table %: registered owner column % does not exist', r.label, r.owner_column;
    END IF;
    -- Only app_auth holds table privileges, only on registered tables, and exactly those registered.
    FOREACH role_name IN ARRAY app_roles LOOP
      held := ARRAY(SELECT p FROM unnest(table_privileges) p
                     WHERE has_table_privilege(role_name, r.oid, p) ORDER BY 1);
      expected := CASE WHEN role_name = 'app_auth' AND r.class IS NOT NULL
                       THEN ARRAY(SELECT p FROM unnest(r.auth_privileges) p ORDER BY 1)
                       ELSE '{}' END;
      IF held <> expected THEN
        RAISE EXCEPTION 'table %: % holds %, expected %', r.label, role_name, held, expected;
      END IF;
      -- has_table_privilege does not see column-level grants.
      FOREACH privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'REFERENCES'] LOOP
        IF privilege <> ALL (held) AND has_any_column_privilege(role_name, r.oid, privilege) THEN
          RAISE EXCEPTION 'table %: % holds a column-level % (only UPDATE can be registered by column)', r.label, role_name, privilege;
        END IF;
      END LOOP;
      held := CASE WHEN 'UPDATE' = ANY (held) THEN '{}' ELSE
                ARRAY(SELECT a.attname::text FROM pg_attribute a
                       WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                         AND has_column_privilege(role_name, r.oid, a.attnum, 'UPDATE') ORDER BY 1) END;
      expected := CASE WHEN role_name = 'app_auth' AND r.class IS NOT NULL
                       THEN ARRAY(SELECT x FROM unnest(r.auth_update_columns) x ORDER BY 1)
                       ELSE '{}' END;
      IF held <> expected THEN
        RAISE EXCEPTION 'table %: % can UPDATE columns %, expected %', r.label, role_name, held, expected;
      END IF;
    END LOOP;
  END LOOP;

  -- (5) Policies in public are exactly the registered ones, text for text.
  FOR r IN
    SELECT coalesce(a.table_name, e.table_name) AS table_name, coalesce(a.policy, e.policy) AS policy,
           a.policy IS NOT NULL AS present, e.policy IS NOT NULL AS registered, t.class,
           a.cmd, e.cmd AS expected_cmd,
           a.using_expr, e.using_expr AS expected_using,
           a.check_expr, e.check_expr AS expected_check
      FROM (SELECT c.relname::text AS table_name, p.polname::text AS policy,
                   CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                                 WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
                   pg_get_expr(p.polqual, p.polrelid) AS using_expr,
                   pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
              FROM pg_policy p
              JOIN pg_class c ON c.oid = p.polrelid
             WHERE c.relnamespace = 'public'::regnamespace) a
      FULL JOIN meta.expected_policies e ON e.table_name = a.table_name AND e.policy = a.policy
      LEFT JOIN meta.expected_tables t ON t.name = coalesce(a.table_name, e.table_name)
     ORDER BY 1, 2
  LOOP
    IF r.class = 'internal' AND r.present THEN
      RAISE EXCEPTION 'internal table % has policy "%": it must have none', r.table_name, r.policy;
    ELSIF NOT r.registered THEN
      RAISE EXCEPTION 'policy "%" on table % is not registered (meta.expect_policy)', r.policy, r.table_name;
    ELSIF NOT r.present THEN
      RAISE EXCEPTION 'registered policy "%" on table % does not exist', r.policy, r.table_name;
    ELSIF r.cmd IS DISTINCT FROM r.expected_cmd THEN
      RAISE EXCEPTION 'policy "%" on table %: command is %, registered %', r.policy, r.table_name, r.cmd, r.expected_cmd;
    ELSIF r.using_expr IS DISTINCT FROM r.expected_using THEN
      RAISE EXCEPTION 'policy "%" on table %: USING is %, registered %', r.policy, r.table_name, r.using_expr, r.expected_using;
    ELSIF r.check_expr IS DISTINCT FROM r.expected_check THEN
      RAISE EXCEPTION 'policy "%" on table %: WITH CHECK is %, registered %', r.policy, r.table_name, r.check_expr, r.expected_check;
    END IF;
  END LOOP;

  -- (6) A SECURITY DEFINER function without a fixed search_path runs whatever the caller shadows.
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO found
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%');
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function without SET search_path: %', found;
  END IF;

  -- (7) Every function in public is registered, and EXECUTE is held by exactly the registered
  -- roles. (8) Internal helpers (app._*) and everything in meta are executable by no app role.
  FOR r IN
    SELECT coalesce(a.signature, e.signature) AS signature, a.oid, a.nspname, a.proname, e.roles,
           e.signature IS NOT NULL AS registered,
           ARRAY(SELECT x FROM unnest(app_roles || 'PUBLIC'::text) x
                  WHERE CASE WHEN x = 'PUBLIC'
                             THEN EXISTS (SELECT 1 FROM aclexplode(a.acl) g
                                           WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE')
                             ELSE has_function_privilege(x, a.oid, 'EXECUTE') END
                  ORDER BY 1) AS held
      FROM (SELECT p.oid, p.oid::regprocedure::text AS signature, n.nspname, p.proname,
                   coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema') a
      FULL JOIN meta.expected_functions e ON e.signature = a.signature
     ORDER BY 1
  LOOP
    IF r.oid IS NULL THEN
      RAISE EXCEPTION 'registered function % does not exist', r.signature;
    ELSIF r.registered THEN
      IF r.held <> ARRAY(SELECT x FROM unnest(r.roles) x ORDER BY 1) THEN
        RAISE EXCEPTION 'function %: EXECUTE is held by %, registered %', r.signature, r.held, r.roles;
      END IF;
    ELSIF r.nspname = 'public' THEN
      RAISE EXCEPTION 'function % is not registered (meta.expect_function)', r.signature;
    ELSIF (r.nspname = 'meta' OR (r.nspname = 'app' AND r.proname LIKE '\_%')) AND r.held <> '{}' THEN
      RAISE EXCEPTION 'internal function % is executable by %', r.signature, r.held;
    END IF;
  END LOOP;

  -- (9) A frozen clock outside a test run would freeze the product.
  IF EXISTS (SELECT 1 FROM meta.test_clock) THEN
    RAISE EXCEPTION 'meta.test_clock is not empty: the test clock is set';
  END IF;
END
$verify$;
