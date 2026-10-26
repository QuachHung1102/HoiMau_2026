// Nudge routes: GET /guilds/nudge-templates, POST /guilds/nudge. The body names a receiver and a
// template code, nothing else is read: no free text reaches the database (R-12.5). Every rule
// (same guild, mute, STORY done, window, both daily limits) and every lock is nudge_send's
// (52-nudge.sql); a refusal is THROWN, so a refused nudge leaves no row.
import type { NudgeResult, NudgeTemplates } from '../../../domain/contract/social.ts';
import type { FieldError } from '../../../domain/validation.ts';
import type { Route } from '../app.ts';
import { AppError } from '../errors.ts';
import { idempotencyKey } from '../idempotency.ts';
import { objectBody } from './day.ts';

const routes: Route[] = [
  {
    method: 'GET',
    path: '/guilds/nudge-templates',
    auth: 'user',
    handler: async ctx => {
      const { rows } = await ctx.db.query<NudgeTemplates['templates'][number]>(
        'SELECT code, text FROM nudge_templates ORDER BY code',
      );
      const answer: NudgeTemplates = { templates: rows };
      return { status: 200, body: answer };
    },
  },
  {
    method: 'POST',
    path: '/guilds/nudge',
    auth: 'user',
    idempotent: true,
    rateLimit: { perMinute: 10 },
    handler: async ctx => {
      const { receiverId, templateCode } = objectBody(ctx.body);
      const fields: FieldError[] = [];
      const receiver = typeof receiverId === 'string' ? idempotencyKey(receiverId) : null;
      if (receiver === null) {
        fields.push({ field: 'receiverId', rule: receiverId === undefined ? 'required' : 'format' });
      }
      if (typeof templateCode !== 'string') {
        fields.push({ field: 'templateCode', rule: templateCode === undefined ? 'required' : 'format' });
      }
      if (fields.length > 0) {
        throw new AppError('VALIDATION_FAILED', { fields });
      }
      const { rows } = await ctx.db.query<{ result: { sentAt: string; senderRemainingToday: number } }>(
        'SELECT nudge_send($1, $2, $3) AS result',
        [receiver, templateCode, ctx.actionId],
      );
      const { sentAt, senderRemainingToday } = rows[0].result;
      const answer: NudgeResult = { sentAt: new Date(sentAt).toISOString(), senderRemainingToday };
      return { status: 200, body: answer };
    },
  },
];

export default routes;
