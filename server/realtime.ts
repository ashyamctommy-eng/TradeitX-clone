import { Server as SocketServer } from 'socket.io';
import type { Server } from 'http';
import { loadUser, COOKIE } from './auth.js';
import { market } from './market.js';

let io: SocketServer | null = null;

/** Users currently watching the AI telemetry panel. */
const aiSubscribers = new Set<string>();
export const addAiSubscriber = (id: string) => aiSubscribers.add(id);
export const removeAiSubscriber = (id: string) => aiSubscribers.delete(id);
export const getAiSubscribers = () => [...aiSubscribers];

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function initRealtime(server: Server) {
  io = new SocketServer(server, {
    cors: { origin: true, credentials: true },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const user = await loadUser(cookies[COOKIE] ?? null);
      if (!user) return next(new Error('UNAUTHENTICATED'));
      (socket.data as { user: typeof user }).user = user;
      next();
    } catch (e) {
      next(e as Error);
    }
  });

  io.on('connection', (socket) => {
    const user = (socket.data as { user: { id: string; userType: string } }).user;
    socket.join(`user:${user.id}`);
    if (user.userType === 'admin') socket.join('admin');

    socket.on('market:subscribe', (symbol: string) => {
      socket.join(`market:${symbol}`);
      socket.emit('market:snapshot', { symbol, price: market.price(symbol) });
    });

    socket.on('support:join', (ticketId: string) => socket.join(`ticket:${ticketId}`));

    socket.on('ai:subscribe', () => {
      addAiSubscriber(user.id);
      socket.emit('ai:subscribed', { ok: true });
    });
    socket.on('ai:unsubscribe', () => removeAiSubscriber(user.id));

    socket.on('disconnect', () => {});
  });

  market.subscribe((symbol, price, prev) => {
    io?.to(`market:${symbol}`).emit('market:tick', { symbol, price, prev, t: Date.now() });
  });

  return io;
}

export function emitUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitAdmin(event: string, payload: unknown) {
  io?.to('admin').emit(event, payload);
}

export function emitTicket(ticketId: string, event: string, payload: unknown) {
  io?.to(`ticket:${ticketId}`).emit(event, payload);
}
