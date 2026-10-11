-- The schema checks itself: the catalog must match the design and the registry of 02-meta.sql.
-- Runs as the superuser at the end of every migration and as the gate `npm run db:verify`.
-- It is generic over the registry: a feature file registers its objects, it never edits this.
-- Every violation raises an exception that names the object.
--
-- Rules for whoever edits it:
--   * state what is intact and compare by equality. Never look for a known breakage, and never
--     match a value by pattern: USING (owner() OR true) still contains "owner()", and
--     search_path = public still starts with "search_path=". (LIKE is used below only to pick
--     the app_* roles and to skip the pg_* schemas, by the naming convention.)
--   * read the ACL, not has_*_privilege for a list of roles: a grant to a role nobody thought of
--     is still a grant. Whatever is not expected is a violation, whoever holds it;
--   * an assertion that no mutation can make fail is dead. checks/verify.test.ts and the
--     mutation check prove each one: add the mutation with the assertion.
--
-- "Ours" below = every schema that is not PostgreSQL's own: public, app, meta.

DO $verify$
DECLARE
  r record;
  role_name text;
  found text;
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
  -- No app role is a member of anything else, and no other role is a member of an app role.
  SELECT string_agg(format('%s in %s (inherit %s, set %s, admin %s)',
                           m.rolname, g.rolname, am.inherit_option, am.set_option, am.admin_option), '; '
                    ORDER BY m.rolname, g.rolname)
    INTO found
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
   WHERE (m.rolname LIKE 'app\_%' OR g.rolname LIKE 'app\_%')
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
  -- A role may store settings for itself (ALTER ROLE app_conn SET role = 'app_job'), and they
  -- apply at login, before any request code runs. That cannot be prevented, so it is detected.
  SELECT string_agg(format('role %s, database %s: %s', coalesce(ro.rolname, '(all)'),
                           coalesce(d.datname, '(all)'), s.setconfig), '; ')
    INTO found
    FROM pg_db_role_setting s
    LEFT JOIN pg_roles ro ON ro.oid = s.setrole
    LEFT JOIN pg_database d ON d.oid = s.setdatabase
   WHERE (s.setrole = 0 OR ro.rolname LIKE 'app\_%')
     AND (s.setdatabase = 0 OR d.datname = current_database());
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'a stored setting applies to an app role: %', found;
  END IF;
  -- A privilege on a configuration parameter (GRANT SET ON PARAMETER) lets a role change a
  -- setting it otherwise could not, session_replication_role for one.
  SELECT string_agg(format('%s to %s (%s)', pa.parname, CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE ro.rolname END,
                           g.privilege_type), '; ' ORDER BY pa.parname, ro.rolname)
    INTO found
    FROM pg_parameter_acl pa
    CROSS JOIN LATERAL aclexplode(pa.paracl) g
    LEFT JOIN pg_roles ro ON ro.oid = g.grantee
   WHERE g.grantee = 0 OR ro.rolname LIKE 'app\_%';
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'a configuration parameter is granted to an app role or to PUBLIC: %', found;
  END IF;

  -- The registry is not trusted either: a row is judged here, however it was written. A class
  -- fixes what app_auth may be granted; without this a registered TRUNCATE, or a class nobody
  -- defined, would make the catalog "match".
  SELECT string_agg(format('table %s (%s): %s', e.name, e.class, e.problem), '; ' ORDER BY e.name)
    INTO found
    FROM (SELECT t.name, t.class,
                 CASE
                   WHEN t.class NOT IN ('own_read', 'own_rw', 'internal', 'content')
                     THEN 'unknown class'
                   WHEN (t.class IN ('own_read', 'own_rw')) <> (t.owner_column IS NOT NULL)
                     THEN 'owner_column is required for own_read and own_rw, and null for the other classes'
                   WHEN t.class IN ('own_read', 'content') AND NOT (t.auth_privileges = '{SELECT}' AND t.auth_update_columns = '{}')
                     THEN 'app_auth holds exactly {SELECT} and no column grant'
                   WHEN t.class = 'internal' AND NOT (t.auth_privileges = '{}' AND t.auth_update_columns = '{}')
                     THEN 'app_auth holds nothing'
                   -- TRUNCATE ignores row level security; REFERENCES and TRIGGER are not a client's business
                   WHEN t.class = 'own_rw' AND NOT t.auth_privileges <@ ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                     THEN 'app_auth may hold only SELECT, INSERT, UPDATE, DELETE'
                 END AS problem
            FROM meta.expected_tables t) e
   WHERE e.problem IS NOT NULL;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'registry: %', found;
  END IF;
  SELECT string_agg(format('function %s: only app_anon, app_auth, app_job can be registered, not %s', e.signature, e.roles),
                    '; ' ORDER BY e.signature)
    INTO found
    FROM meta.expected_functions e
   WHERE NOT e.roles <@ ARRAY['app_anon', 'app_auth', 'app_job'];
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'registry: %', found;
  END IF;

  -- (3) Every registered table exists ...
  SELECT string_agg(e.name, ', ' ORDER BY e.name)
    INTO found
    FROM meta.expected_tables e
   WHERE NOT EXISTS (SELECT 1 FROM pg_class c
                      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = e.name
                        AND c.relkind IN ('r', 'p', 'v', 'm', 'f'));
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'registered table does not exist: %', found;
  END IF;

  -- Tables, and everything else that holds or shows rows, in every schema of ours.
  FOR r IN
    SELECT c.oid, c.oid::regclass::text AS label, n.nspname, c.relkind, c.relrowsecurity,
           e.class, e.auth_update_columns, e.owner_column,
           (SELECT bool_or(o.option_value::boolean) FROM pg_options_to_table(c.reloptions) o
             WHERE o.option_name = 'security_invoker') AS security_invoker
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN meta.expected_tables e ON n.nspname = 'public' AND e.name = c.relname
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     ORDER BY 2
  LOOP
    -- A view reads its tables as the view's owner: row level security does not apply to what
    -- it shows unless it is a security_invoker view. A materialized view is a copy of the rows,
    -- and the rows of a foreign table are not in this database at all.
    IF r.relkind = 'm' THEN
      RAISE EXCEPTION 'materialized view % is not allowed: its rows sit outside row level security', r.label;
    ELSIF r.relkind = 'f' THEN
      RAISE EXCEPTION 'foreign table % is not allowed: its rows sit outside this database and its fences', r.label;
    ELSIF r.relkind = 'v' AND r.security_invoker IS NOT TRUE THEN
      RAISE EXCEPTION 'view % must be WITH (security_invoker = true): otherwise it reads as its owner, past row level security', r.label;
    END IF;
    -- (3) ... and every table in public is registered.
    IF r.nspname = 'public' AND r.class IS NULL THEN
      RAISE EXCEPTION 'table % is not registered (meta.expect_table)', r.label;
    END IF;
    -- (4) Per class. The grants themselves are compared further down.
    IF r.class IN ('own_read', 'own_rw', 'internal') AND NOT r.relrowsecurity THEN
      RAISE EXCEPTION 'table % (%): row level security is off', r.label, r.class;
    END IF;
    SELECT string_agg(x, ', ')
      INTO found
      FROM unnest(r.auth_update_columns || r.owner_column) x
     WHERE x IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = r.oid AND a.attname = x AND a.attnum > 0 AND NOT a.attisdropped);
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'table %: registered column does not exist: %', r.label, found;
    END IF;
  END LOOP;

  -- (5) Policies in public are exactly the registered ones, text for text; all of them
  -- PERMISSIVE and TO app_auth, the only role that is granted anything on a table.
  FOR r IN
    SELECT coalesce(a.table_name, e.table_name) AS table_name, coalesce(a.policy, e.policy) AS policy,
           a.policy IS NOT NULL AS present, e.policy IS NOT NULL AS registered, t.class,
           a.permissive, a.roles,
           a.cmd, e.cmd AS expected_cmd,
           a.using_expr, e.using_expr AS expected_using,
           a.check_expr, e.check_expr AS expected_check
      FROM (SELECT c.relname::text AS table_name, p.polname::text AS policy, p.polpermissive AS permissive,
                   ARRAY(SELECT s.x
                           FROM (SELECT CASE WHEN o = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(o)::text END AS x
                                   FROM unnest(p.polroles) o) s
                          ORDER BY s.x COLLATE "C") AS roles,
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
    ELSIF NOT r.permissive THEN
      RAISE EXCEPTION 'policy "%" on table %: is RESTRICTIVE, must be PERMISSIVE', r.policy, r.table_name;
    ELSIF r.roles <> ARRAY['app_auth'] THEN
      RAISE EXCEPTION 'policy "%" on table %: applies to %, must be {app_auth}', r.policy, r.table_name, r.roles;
    ELSIF r.cmd IS DISTINCT FROM r.expected_cmd THEN
      RAISE EXCEPTION 'policy "%" on table %: command is %, registered %', r.policy, r.table_name, r.cmd, r.expected_cmd;
    ELSIF r.using_expr IS DISTINCT FROM r.expected_using THEN
      RAISE EXCEPTION 'policy "%" on table %: USING is %, registered %', r.policy, r.table_name, r.using_expr, r.expected_using;
    ELSIF r.check_expr IS DISTINCT FROM r.expected_check THEN
      RAISE EXCEPTION 'policy "%" on table %: WITH CHECK is %, registered %', r.policy, r.table_name, r.check_expr, r.expected_check;
    END IF;
  END LOOP;

  -- (7) Every function of ours is registered, and every registered function exists.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO found
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND NOT EXISTS (SELECT 1 FROM meta.expected_functions e WHERE e.signature = p.oid::regprocedure::text);
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'function is not registered (meta.expect_function): %', found;
  END IF;
  SELECT string_agg(e.signature, ', ' ORDER BY e.signature)
    INTO found
    FROM meta.expected_functions e
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p
                       JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
                        AND p.oid::regprocedure::text = e.signature);
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'registered function does not exist: %', found;
  END IF;
  -- (8) A helper that takes the user id as an argument serves whoever may call it: the internal
  -- ones (a name starting with "_" in any schema, and everything in meta) are registered for no
  -- role at all.
  SELECT string_agg(format('%s %s', e.signature, e.roles), ', ' ORDER BY e.signature)
    INTO found
    FROM meta.expected_functions e
    JOIN pg_proc p ON p.oid::regprocedure::text = e.signature
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE (n.nspname = 'meta' OR left(p.proname, 1) = '_')
     AND e.roles <> '{}';
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'internal function must be registered with no role: %', found;
  END IF;

  -- (6) A SECURITY DEFINER function resolves names with the search_path it carries. One that
  -- carries none uses the caller's; one whose path does not end in pg_temp, or starts with it,
  -- lets the caller's temporary objects shadow the real ones. The settings of the function must
  -- be exactly one of the two allowed paths and nothing else: any further SET (for instance
  -- session_replication_role = replica, which switches triggers off) rides along unseen.
  SELECT string_agg(format('%s %s', p.oid::regprocedure::text, coalesce(p.proconfig, '{}')), ', '
                    ORDER BY p.oid::regprocedure::text)
    INTO found
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND p.prosecdef
     AND p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'];
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function must carry exactly SET search_path = public, pg_temp (or pg_catalog, pg_temp) and no other setting: %', found;
  END IF;

  -- (2) (4) (7) (8) Ownership and grants of everything of ours, read from the ACL. Nothing is
  -- owned by an app role (the owner needs no grant and is not subject to its policies), and
  -- the grants to anyone but the owner are exactly the expected ones: only app_auth on
  -- registered tables, only the registered roles on functions, nothing on sequences.
  FOR r IN
    WITH ours AS (
      SELECT oid, nspname, nspowner, nspacl FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
    ), objects (kind, label, owner, acl, expected) AS (
      SELECT 'database', d.datname::text, d.datdba, coalesce(d.datacl, acldefault('d', d.datdba)),
             ARRAY['PUBLIC:CONNECT', 'PUBLIC:TEMPORARY']
        FROM pg_database d
       WHERE d.datname = current_database()
      UNION ALL
      SELECT 'schema', n.nspname::text, n.nspowner, coalesce(n.nspacl, acldefault('n', n.nspowner)),
             CASE WHEN n.nspname IN ('public', 'app')
                  THEN ARRAY['app_anon:USAGE', 'app_auth:USAGE', 'app_job:USAGE'] ELSE '{}' END
        FROM ours n
      UNION ALL
      SELECT CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' ELSE 'table' END,
             c.oid::regclass::text, c.relowner,
             coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner)),
             ARRAY(SELECT 'app_auth:' || p FROM unnest(e.auth_privileges) p)
        FROM pg_class c
        JOIN ours n ON n.oid = c.relnamespace
        LEFT JOIN meta.expected_tables e ON n.nspname = 'public' AND e.name = c.relname AND c.relkind <> 'S'
       WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      UNION ALL
      SELECT 'column', c.oid::regclass::text || '.' || a.attname, c.relowner, a.attacl,
             CASE WHEN a.attname = ANY (e.auth_update_columns) THEN ARRAY['app_auth:UPDATE'] ELSE '{}' END
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN ours n ON n.oid = c.relnamespace
        LEFT JOIN meta.expected_tables e ON n.nspname = 'public' AND e.name = c.relname
       WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'function', p.oid::regprocedure::text, p.proowner, coalesce(p.proacl, acldefault('f', p.proowner)),
             ARRAY(SELECT x || ':EXECUTE' FROM unnest(e.roles) x)
        FROM pg_proc p
        JOIN ours n ON n.oid = p.pronamespace
        JOIN meta.expected_functions e ON e.signature = p.oid::regprocedure::text
    )
    SELECT o.kind, o.label, pg_get_userbyid(o.owner)::text AS owner,
           ARRAY(SELECT x FROM unnest(o.expected) x ORDER BY x COLLATE "C") AS expected,
           -- "*" marks WITH GRANT OPTION
           ARRAY(SELECT s.x
                   FROM (SELECT format('%s:%s%s', CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END,
                                       g.privilege_type, CASE WHEN g.is_grantable THEN '*' ELSE '' END) AS x
                           FROM aclexplode(o.acl) g
                          WHERE g.grantee <> o.owner) s
                  ORDER BY s.x COLLATE "C") AS actual
      FROM objects o
     ORDER BY o.kind, o.label
  LOOP
    IF r.kind <> 'column' AND r.owner LIKE 'app\_%' THEN
      RAISE EXCEPTION '% % is owned by app role %', r.kind, r.label, r.owner;
    ELSIF r.actual <> r.expected THEN
      RAISE EXCEPTION '% %: grants are %, expected %', r.kind, r.label, r.actual, r.expected;
    END IF;
  END LOOP;

  -- (9) A frozen clock outside a test run would freeze the product.
  IF EXISTS (SELECT 1 FROM meta.test_clock) THEN
    RAISE EXCEPTION 'meta.test_clock is not empty: the test clock is set';
  END IF;
END
$verify$;
