import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

export const COOKIE = 'tx_session';
const SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  userType: string;
  frozen: boolean;
  kycRequired: boolean;
  preferredAccountType: string;
};

export function signToken(userId: string) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: '7d' });
}

export function readToken(req: FastifyRequest): string | null {
  const c = (req.cookies as Record<string, string> | undefined)?.[COOKIE];
  if (c) return c;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, SECRET) as { uid?: string };
    return payload.uid ?? null;
  } catch {
    return null;
  }
}

export async function loadUser(token: string | null): Promise<AuthUser | null> {
  if (!token) return null;
  const uid = verifyToken(token);
  if (!uid) return null;
  const p = await prisma.profile.findUnique({
    where: { id: uid },
    select: {
      id: true, email: true, username: true, userType: true,
      frozen: true, kycRequired: true, preferredAccountType: true,
    },
  });
  return p;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await loadUser(readToken(req));
  if (!user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
  if (user.frozen) return reply.code(403).send({ error: 'ACCOUNT_FROZEN' });
  req.user = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = await loadUser(readToken(req));
  if (!user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
  if (user.userType !== 'admin') return reply.code(403).send({ error: 'ADMIN_ONLY' });
  req.user = user;
}
