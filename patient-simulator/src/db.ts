// ── D1 Database Queries ─────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  scenario: string;
  title: string;
  created_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

// ── Chat session queries ───────────────────────────────

export async function createChatSession(
  db: D1Database,
  userId: string,
  scenario: string,
  title: string,
): Promise<ChatSession> {
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO chat_sessions (id, user_id, scenario, title) VALUES (?, ?, ?, ?)')
    .bind(id, userId, scenario, title)
    .run();
  return { id, user_id: userId, scenario, title, created_at: new Date().toISOString() };
}

export async function getChatSessions(db: D1Database, userId: string): Promise<ChatSession[]> {
  const result = await db
    .prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<ChatSession>();
  return result.results ?? [];
}

export async function getChatSession(
  db: D1Database,
  id: string,
  userId: string,
): Promise<ChatSession | null> {
  return db
    .prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<ChatSession>();
}

// ── Message queries ────────────────────────────────────

export async function addMessage(
  db: D1Database,
  sessionId: string,
  role: string,
  content: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)')
    .bind(sessionId, role, content)
    .run();
}

export async function getMessages(db: D1Database, sessionId: string): Promise<Message[]> {
  const result = await db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .bind(sessionId)
    .all<Message>();
  return result.results ?? [];
}

// ── Instructor log queries ─────────────────────────────

export interface SessionLogRow extends ChatSession {
  student_name: string;
  student_email: string;
  message_count: number;
}

export async function getAllChatSessions(db: D1Database): Promise<SessionLogRow[]> {
  const result = await db
    .prepare(
      `SELECT cs.*,
              u.name  AS student_name,
              u.email AS student_email,
              (SELECT COUNT(*) FROM messages WHERE session_id = cs.id) AS message_count
       FROM chat_sessions cs
       JOIN users u ON cs.user_id = u.id
       ORDER BY cs.created_at DESC`,
    )
    .all<SessionLogRow>();
  return result.results ?? [];
}

export async function getSessionWithMessages(
  db: D1Database,
  sessionId: string,
): Promise<(ChatSession & { student_name: string; student_email: string; messages: Message[] }) | null> {
  const session = await db
    .prepare(
      `SELECT cs.*, u.name AS student_name, u.email AS student_email
       FROM chat_sessions cs
       JOIN users u ON cs.user_id = u.id
       WHERE cs.id = ?`,
    )
    .bind(sessionId)
    .first();

  if (!session) return null;

  const messages = await getMessages(db, sessionId);
  return { ...session, messages } as any;
}
