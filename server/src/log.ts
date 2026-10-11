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

const LF = String.fromCharCode(10);
const CODE = /^[A-Za-z0-9_]{1,40}$/;

/**
 * The frames of a stack, without its first part: a stack starts with the name and the MESSAGE
 * of the error, and a message can run over several lines, so it is cut off as a whole, not line
 * by line. Empty when the message cannot be found in the stack.
 */
function frames(error: Error): string {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  const message = String(error.message);
  const at = message === '' ? stack.indexOf(LF) : stack.indexOf(message);
  if (at < 0) {
    return '';
  }
  return stack
    .slice(at + message.length)
    .split(LF)
    .filter(row => row.startsWith('    at '))
    .join(LF);
}

/**
 * What the log keeps of a thrown value: the name of its class, its code (a SQLSTATE or an errno
 * name), the catalog names a database error carries, and the frames of its stack. Never its
 * message and never its detail: messages quote input (`invalid input syntax for type uuid:
 * "…"`, `Invalid time zone specified: …`, the answer of a mail server), and a constraint
 * violation prints the whole row.
 */
export function describeError(thrown: unknown): Record<string, unknown> {
  if (!(thrown instanceof Error)) {
    return { error: typeof thrown };
  }
  const { code, schema, table, column, constraint, routine } = thrown as Error &
    Record<string, unknown>;
  const name = (value: unknown) =>
    typeof value === 'string' && CODE.test(value) ? value : undefined;
  return {
    error: name(thrown.constructor?.name) ?? 'Error',
    code: name(code),
    schema: name(schema),
    table: name(table),
    column: name(column),
    constraint: name(constraint),
    routine: name(routine),
    stack: frames(thrown),
  };
}
