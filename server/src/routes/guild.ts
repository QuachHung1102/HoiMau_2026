// Guild routes: POST /guilds, POST /guilds/join, GET /guilds/me, POST /guilds/me/leave,
// POST /guilds/me/transfer. The route judges the shape of the body and the banned terms; one
// guild per user, eight members, the leader rules and every lock are the guild_* functions'
// (50-guild.sql). Every refusal is THROWN, so a refused request leaves no row.
import { findBannedTerms } from '../../../domain/language.ts';
import { LIMITS, isDisplayName, stripUnseen } from '../../../domain/validation.ts';
import type { FieldError } from '../../../domain/validation.ts';
import type { Route } from '../app.ts';
import { AppError } from '../errors.ts';
import { idempotencyKey } from '../idempotency.ts';
import { buildGuild } from '../readModels/guild.ts';
import { objectBody } from './day.ts';

function refuse(fields: FieldError[]): void {
  if (fields.length > 0) {
    throw new AppError('VALIDATION_FAILED', { fields });
  }
}

/** NFC, trimmed; 3 to 30 code points; the format of a display name (no unseen character, a letter or digit). */
function nameOf(value: unknown, fields: FieldError[]): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  const length = [...name].length;
  let rule: FieldError['rule'] | null = null;
  if (typeof value !== 'string') {
    rule = value === undefined ? 'required' : 'format';
  } else if (length < LIMITS.guildName.min) {
    rule = 'min';
  } else if (length > LIMITS.guildName.max) {
    rule = 'max';
  } else if (!isDisplayName(name)) {
    rule = 'format';
  }
  if (rule !== null) {
    fields.push({ field: 'name', rule });
  }
  return name;
}

/** Optional; NFC, trimmed; at most 80 code points; no unseen character. Absent or null is ''. */
function mottoOf(value: unknown, fields: FieldError[]): string {
  if (value === undefined || value === null) {
    return '';
  }
  const motto = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (typeof value !== 'string' || stripUnseen(motto) !== motto) {
    fields.push({ field: 'motto', rule: 'format' });
  } else if ([...motto].length > LIMITS.guildMotto.max) {
    fields.push({ field: 'motto', rule: 'max' });
  }
  return motto;
}

const routes: Route[] = [
  {
    method: 'POST',
    path: '/guilds',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      const input = objectBody(ctx.body);
      const fields: FieldError[] = [];
      const name = nameOf(input.name, fields);
      const motto = mottoOf(input.motto, fields);
      refuse(fields);
      // judged last, as for a display name: only text that is otherwise fine is called not allowed
      if (findBannedTerms(name).length > 0 || findBannedTerms(motto).length > 0) {
        throw new AppError('NAME_NOT_ALLOWED');
      }
      await ctx.db.query('SELECT guild_create($1, $2)', [name, motto]);
      return { status: 200, body: await buildGuild(ctx) };
    },
  },
  {
    method: 'POST',
    path: '/guilds/join',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      const { inviteCode } = objectBody(ctx.body);
      if (typeof inviteCode !== 'string') {
        refuse([{ field: 'inviteCode', rule: inviteCode === undefined ? 'required' : 'format' }]);
      }
      // trimmed and upper-cased by guild_join
      await ctx.db.query('SELECT guild_join($1)', [inviteCode]);
      return { status: 200, body: await buildGuild(ctx) };
    },
  },
  {
    method: 'GET',
    path: '/guilds/me',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildGuild(ctx) }),
  },
  {
    method: 'POST',
    path: '/guilds/me/leave',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      await ctx.db.query('SELECT guild_leave()');
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    path: '/guilds/me/transfer',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      const { userId } = objectBody(ctx.body);
      const target = typeof userId === 'string' ? idempotencyKey(userId) : null;
      if (target === null) {
        refuse([{ field: 'userId', rule: userId === undefined ? 'required' : 'format' }]);
      }
      await ctx.db.query('SELECT guild_transfer($1)', [target]);
      return { status: 200, body: await buildGuild(ctx) };
    },
  },
];

export default routes;
