import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { initRealtime } from './realtime.js';
import { startEngines } from './engine.js';
import { startTelegramPolling } from './telegram.js';
import { authRoutes } from './routes/auth.js';
import { tradingRoutes } from './routes/trading.js';
import { paymentRoutes } from './routes/payments.js';
import { adminRoutes } from './routes/admin.js';
import { approveWithdrawal, completeWithdrawal, declineWithdrawal } from './services/treasury.js';
import { creditDeposit } from './services/deposits.js';

const app = Fastify({ logger: false, trustProxy: true });

app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  (req as { rawBody?: string }).rawBody = body as string;
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch (err) {
    done(err as Error);
  }
});

async function main() {
await app.register(cookie, {});
await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

app.get('/api/health', async () => ({ ok: true, service: 'tradeitx-api', ts: new Date().toISOString() }));

await app.register(authRoutes, { prefix: '/api' });
await app.register(tradingRoutes, { prefix: '/api' });
await app.register(paymentRoutes, { prefix: '/api' });
await app.register(adminRoutes, { prefix: '/api' });

app.setErrorHandler((err, _req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) console.error('[api]', err);
  reply.code(status).send({ error: err.message || 'INTERNAL_ERROR' });
});

const port = Number(process.env.API_PORT || 4000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`[api] listening on http://0.0.0.0:${port}`);

initRealtime(app.server);
startEngines();
startTelegramPolling({ approveWithdrawal, declineWithdrawal, completeWithdrawal, creditDeposit });
}

main().catch((e) => { console.error('[api] fatal', e); process.exit(1); });
