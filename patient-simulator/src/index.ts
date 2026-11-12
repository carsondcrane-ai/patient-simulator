import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { authRoutes, getSessionUser, SESSION_COOKIE } from "./auth";
import {
  createChatSession,
  getChatSessions,
  getChatSession,
  addMessage,
  getMessages,
  getAllChatSessions,
  getSessionWithMessages,
} from "./db";
import { streamGemini } from "./gemini";
import { SCENARIOS, getScenario, buildSystemPrompt } from "./patient";
import { getRagContext, indexMaterial } from "./rag";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  VECTORIZE?: Vectorize;
  GEMINI_API_KEY: string;
  SESSION_SECRET: string;
  GEMINI_MODEL?: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── Auth routes ─────────────────────────────────────────
app.route("/api/auth", authRoutes);

// ── Scenarios list ─────────────────────────────────────
app.get("/api/scenarios", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  return c.json(SCENARIOS);
});

// ── Chat session routes ────────────────────────────────

// List student's chat sessions
app.get("/api/sessions", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  const sessions = await getChatSessions(c.env.DB, user.id);
  return c.json(sessions);
});

// Create a new chat session
app.post("/api/sessions", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);

  const { scenario } = await c.req.json<{ scenario: string }>();
  const scenarioDef = getScenario(scenario);
  if (!scenarioDef) return c.json({ error: "Unknown scenario" }, 400);

  const session = await createChatSession(
    c.env.DB,
    user.id,
    scenarioDef.key,
    scenarioDef.title,
  );
  return c.json(session);
});

// Get messages for a session
app.get("/api/sessions/:id/messages", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);

  const session = await getChatSession(c.env.DB, c.req.param("id"), user.id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const messages = await getMessages(c.env.DB, session.id);
  return c.json(messages);
});

// ── Chat endpoint with Gemini streaming ───────────────
app.post("/api/sessions/:id/chat", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);

  const session = await getChatSession(c.env.DB, c.req.param("id"), user.id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const { message } = await c.req.json<{ message: string }>();
  if (!message?.trim()) return c.json({ error: "Message required" }, 400);

  const scenarioDef = getScenario(session.scenario);
  if (!scenarioDef) return c.json({ error: "Scenario config missing" }, 500);

  // 1. Save student message to D1
  await addMessage(c.env.DB, session.id, "student", message);

  // 2. Load conversation history
  const history = await getMessages(c.env.DB, session.id);
  const geminiMessages = history.map((m) => ({
    role: m.role === "student" ? ("student" as const) : ("patient" as const),
    content: m.content,
  }));

  // 3. Load skill file content
  // The skill file is served as a static asset; we fetch it from ASSETS
  const skillFileUrl = new URL(
    `/patient-scenarios/${scenarioDef.skillFile}.md`,
    c.req.url,
  );
  const skillFileResp = await c.env.ASSETS.fetch(skillFileUrl.toString());
  let skillFileContent = "";
  if (skillFileResp.ok) {
    skillFileContent = await skillFileResp.text();
  } else {
    skillFileContent = `You are a patient in the "${scenarioDef.title}" scenario. ${scenarioDef.description}`;
  }

  // 4. Query Vectorize for RAG context (optional)
  const ragContext = await getRagContext(c.env, message);

  // 5. Build system prompt
  const systemPrompt = buildSystemPrompt(skillFileContent, ragContext);

  // 6. Determine model
  const model = c.env.GEMINI_MODEL || "gemini-2.0-flash";

  // 7. Stream Gemini response as SSE
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await streamGemini(
          c.env.GEMINI_API_KEY,
          model,
          systemPrompt,
          geminiMessages,
          (chunk) => {
            fullResponse += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          },
        );

        // 8. Save AI response to D1
        await addMessage(c.env.DB, session.id, "patient", fullResponse);

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
        );
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: err.message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ── Instructor log routes ──────────────────────────────

// List all chat sessions (instructor only)
app.get("/api/logs", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  if (user.role !== "instructor")
    return c.json({ error: "Instructor access required" }, 403);

  const sessions = await getAllChatSessions(c.env.DB);
  return c.json(sessions);
});

// Get a specific session with all messages (instructor only)
app.get("/api/logs/:id", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  if (user.role !== "instructor")
    return c.json({ error: "Instructor access required" }, 403);

  const session = await getSessionWithMessages(c.env.DB, c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

// ── Index material into Vectorize (instructor only) ────
app.post("/api/index", async (c) => {
  const user = await getSessionUser(c.env, c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  if (user.role !== "instructor")
    return c.json({ error: "Instructor access required" }, 403);

  if (!c.env.VECTORIZE)
    return c.json({ error: "Vectorize not configured" }, 400);

  const { text, metadata } = await c.req.json<{
    text: string;
    metadata?: Record<string, string>;
  }>();
  if (!text?.trim()) return c.json({ error: "Text required" }, 400);

  await indexMaterial(c.env, text, metadata);
  return c.json({ ok: true });
});

// ── Static assets fallback ─────────────────────────────
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
