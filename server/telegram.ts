import { prisma } from './db.js';
import { emitAdmin } from './realtime.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
export const telegramConfigured = Boolean(TOKEN && CHAT_ID);

export type TelegramButton = { text: string; data: string };

export async function pushTelegramEvent(input: {
  kind: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'TICKET' | 'SYSTEM';
  title: string;
  body: string;
  refId?: string;
  status?: string;
  buttons?: TelegramButton[];
}) {
  const ev = await prisma.telegramEvent.create({
    data: {
      direction: 'OUT',
      kind: input.kind,
      title: input.title,
      body: input.body,
      refId: input.refId,
      status: input.status ?? 'INFO',
      payload: input.buttons ? JSON.stringify(input.buttons) : null,
    },
  });
  emitAdmin('admin:telegram', ev);

  if (telegramConfigured) {
    const text = `<b>${escapeHtml(input.title)}</b>\n${escapeHtml(input.body)}`;
    const reply_markup = input.buttons?.length
      ? {
          inline_keyboard: [
            input.buttons.map((b) => ({ text: b.text, callback_data: b.data })),
          ],
        }
      : undefined;
    await callTelegram('sendMessage', {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      reply_markup,
    }).catch((e) => console.warn('[telegram] send failed:', e.message));
  }
  return ev;
}

async function callTelegram(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  return res.json();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Long-polling command handler. Callback data routes into the same treasury
 * functions the admin UI uses — one source of truth, no side channel.
 */
export async function startTelegramPolling(handlers: {
  approveWithdrawal: (id: string) => Promise<unknown>;
  declineWithdrawal: (id: string) => Promise<unknown>;
  completeWithdrawal: (id: string) => Promise<unknown>;
  creditDeposit: (id: string) => Promise<unknown>;
}) {
  if (!telegramConfigured) {
    console.log('[telegram] not configured — in-app mirror feed only');
    return;
  }
  let offset = 0;
  console.log('[telegram] polling started');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const data = await callTelegram('getUpdates', { offset, timeout: 25 });
      for (const u of data.result ?? []) {
        offset = u.update_id + 1;
        const cq = u.callback_query;
        if (!cq?.data) continue;
        const [scope, action, id] = String(cq.data).split(':');
        let result = 'Ignored';
        try {
          if (scope === 'wd') {
            if (action === 'approve') { await handlers.approveWithdrawal(id); result = 'Approved — payout in progress'; }
            if (action === 'complete') { await handlers.completeWithdrawal(id); result = 'Completed'; }
            if (action === 'decline') { await handlers.declineWithdrawal(id); result = 'Declined + refunded'; }
          }
          if (scope === 'dep' && action === 'credit') { await handlers.creditDeposit(id); result = 'Deposit credited'; }
        } catch (e) {
          result = `Failed: ${(e as Error).message}`;
        }
        await callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text: result });
        await prisma.telegramEvent.create({
          data: {
            direction: 'IN', kind: 'SYSTEM', title: 'Callback', status: result,
            body: `${scope}:${action}:${id}`, refId: id,
          },
        }).then((ev) => emitAdmin('admin:telegram', ev)).catch(() => {});
      }
    } catch (e) {
      console.warn('[telegram] poll error:', (e as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
