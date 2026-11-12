import type { Env } from './index';

// ── Types ──────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

interface UserRow extends User {
  password_hash: string;
  salt: string;
}

// ── Password hashing (PBKDF2 via Web Crypto) ────────────

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  return actual === expectedHash;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// ── Session helpers ────────────────────────────────────

const SESSION_COOKIE = 'patient_sim_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function createSession(env: Env, userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), userId, token, expiresAt.toISOString())
    .run();
  return token;
}

export function setSessionCookie(c: any, token: string): void {
  // @ts-ignore — Hono context has setCookie
  setCookieHono(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

// Local import to avoid circular deps at module level
import { setCookie as setCookieHono, getCookie as getCookieHono } from 'hono/cookie';

// ── Auth middleware ─────────────────────────────────────

export async function getSessionUser(env: Env, c: any): Promise<User | null> {
  const token = getCookieHono(c, SESSION_COOKIE);
  if (!token) return null;

  const session = await env.DB.prepare(
    `SELECT s.user_id FROM sessions s
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
  )
    .bind(token)
    .first<{ user_id: string }>();

  if (!session) return null;

  const user = await env.DB.prepare(
    'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
  )
    .bind(session.user_id)
    .first<User>();

  return user ?? null;
}

export async function requireAuth(env: Env, c: any): Promise<User> {
  const user = await getSessionUser(env, c);
  if (!user) {
    return null as any; // caller should check and return 401
  }
  return user;
}

// ── Auth routes ─────────────────────────────────────────

import { Hono } from 'hono';

export const authRoutes = new Hono<{ Bindings: Env }>();

// POST /api/auth/register
authRoutes.post('/register', async (c) => {
  const { name, email, password, role } = await c.req.json<{
    name: string;
    email: string;
    password: string;
    role?: string;
  }>();

  if (!name || !email || !password) {
    return c.json({ error: 'Name, email, and password are required' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }

  // Check if email already exists
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const id = crypto.randomUUID();
  const userRole = role === 'instructor' ? 'instructor' : 'student';

  await c.env.DB.prepare(
    'INSERT INTO users (id, name, email, password_hash, salt, role) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, name, email, passwordHash, salt, userRole)
    .run();

  const token = await createSession(c.env, id);
  setSessionCookie(c, token);

  return c.json({ id, name, email, role: userRole });
});

// POST /api/auth/login
authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>();

  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.salt, user.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const token = await createSession(c.env, user.id);
  setSessionCookie(c, token);

  return c.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// POST /api/auth/logout
authRoutes.post('/logout', async (c) => {
  const token = getCookieHono(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  // @ts-ignore
  deleteCookieHono(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// GET /api/auth/me
authRoutes.get('/me', async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: 'Not authenticated' }, 401);
  return c.json(user);
});

import { deleteCookie as deleteCookieHono } from 'hono/cookie';
