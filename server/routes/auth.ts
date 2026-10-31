import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { COOKIE, signToken, requireUser } from '../auth.js';
import { ensureBalances, getBalances } from '../money.js';
import { market } from '../market.js';

const creds = z.object({ email: z.string().email(), password: z.string().min(6) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      username: z.string().min(2).max(24),
      phoneNumber: z.string().optional(),
      countryCode: z.string().default('+254'),
      country: z.string().default('KE'),
    }).parse(req.body);

    const exists = await prisma.profile.findUnique({ where: { email: body.email.toLowerCase() } });
    if (exists) return reply.code(409).send({ error: 'EMAIL_TAKEN' });

    const profile = await prisma.profile.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 10),
        username: body.username,
        phoneNumber: body.phoneNumber,
        countryCode: body.countryCode,
        country: body.country,
      },
    });
    await ensureBalances(profile.id);
    await prisma.autoTradeConfig.create({ data: { userId: profile.id } });

    reply.setCookie(COOKIE, signToken(profile.id), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    });
    return { id: profile.id, email: profile.email, username: profile.username, userType: profile.userType };
  });

  app.post('/auth/login', async (req, reply) => {
    const { email, password } = creds.parse(req.body);
    const profile = await prisma.profile.findUnique({ where: { email: email.toLowerCase() } });
    if (!profile) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    const ok = await bcrypt.compare(password, profile.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    if (profile.frozen) return reply.code(403).send({ error: 'ACCOUNT_FROZEN' });

    reply.setCookie(COOKIE, signToken(profile.id), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    });
    return { id: profile.id, email: profile.email, username: profile.username, userType: profile.userType };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: user.id } });
    return {
      id: profile.id,
      email: profile.email,
      username: profile.username,
      phoneNumber: profile.phoneNumber,
      countryCode: profile.countryCode,
      country: profile.country,
      preferredAccountType: profile.preferredAccountType,
      userType: profile.userType,
      frozen: profile.frozen,
      kycRequired: profile.kycRequired,
      createdAt: profile.createdAt.toISOString(),
      balances: await getBalances(user.id),
    };
  });

  app.patch('/profile', { preHandler: requireUser }, async (req) => {
    const body = z.object({
      username: z.string().min(2).max(24).optional(),
      phoneNumber: z.string().nullable().optional(),
      countryCode: z.string().optional(),
      country: z.string().optional(),
      preferredAccountType: z.enum(['real', 'demo']).optional(),
    }).parse(req.body);

    const updated = await prisma.profile.update({ where: { id: req.user!.id }, data: body });
    return { ok: true, username: updated.username, preferredAccountType: updated.preferredAccountType };
  });

  app.get('/instruments', async () =>
    market.configs().map((c) => ({ ...c, price: market.price(c.symbol) })),
  );
}
