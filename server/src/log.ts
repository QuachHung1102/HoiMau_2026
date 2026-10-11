/** One XP or coin ledger row a function reported (NFR-10). */
export type LedgerEntry = {
  kind: 'xp' | 'coin';
  userId: string;
  amount: number;
  reason: string;
  refId: string;
};

/**
 * One JSON object per line. Never pass a request body, a query or path value, a token or its
 * hash, an email, a password, journal text, a body measurement or a calorie number: what is
 * logged is route patterns, statuses, ids and durations.
 */
export type Logger = {
  line(fields: Record<string, unknown>): void;
  /** `{evt:'ledger', kind, userId, amount, reason, refId}`: call it for every ledger row a function returns. */
  ledger(entry: LedgerEntry): void;
};

export function createLogger(
  write: (line: string) => void = line => {
    process.stdout.write(`${line}\n`);
  },
): Logger {
  const line = (fields: Record<string, unknown>) =>
    write(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
  return {
    line,
    ledger: ({ kind, userId, amount, reason, refId }) =>
      line({ evt: 'ledger', kind, userId, amount, reason, refId }),
  };
}

/**
 * What the log keeps of a thrown value. A PostgreSQL error quotes the offending value in its
 * message (`invalid input syntax for type uuid: "…"`) and the whole row in its detail, so only
 * its identifiers are kept, plus the message of a plain RAISE EXCEPTION (P0001), which is text
 * our own SQL wrote and which never holds a value. Any other error is logged with its stack.
 */
export function describeError(thrown: unknown): Record<string, unknown> {
  if (!(thrown instanceof Error)) {
    return { error: typeof thrown };
  }
  const frames = (thrown.stack ?? '')
    .split('\n')
    .filter(row => row.startsWith('    at '))
    .join('\n');
  const pg = thrown as Error & Record<string, unknown>;
  if (typeof pg.severity !== 'string') {
    return { error: thrown.name, stack: thrown.stack };
  }
  return {
    error: 'PostgresError',
    sqlstate: pg.code,
    ...(pg.code === 'P0001' ? { message: thrown.message } : {}),
    schema: pg.schema,
    table: pg.table,
    column: pg.column,
    constraint: pg.constraint,
    routine: pg.routine,
    stack: frames,
  };
}
