// ── Chat page logic with SSE streaming ─────────────────

let currentSessionId = null;
let scenarios = [];
let isStreaming = false;

const sessionListEl = document.getElementById("session-list");
const chatMessagesEl = document.getElementById("chat-messages");
const chatHeaderEl = document.getElementById("chat-header");
const chatInputAreaEl = document.getElementById("chat-input-area");
const chatInputEl = document.getElementById("chat-input");
const sendBtnEl = document.getElementById("send-btn");
const scenarioModalEl = document.getElementById("scenario-modal");
const scenarioGridEl = document.getElementById("scenario-grid");
const newSessionBtnEl = document.getElementById("new-session-btn");
const modalCloseEl = document.getElementById("modal-close");

// ── Auth check & nav setup ──────────────────────────────

(async () => {
  try {
    const resp = await fetch("/api/auth/me");
    if (!resp.ok) {
      window.location.href = "/index.html";
      return;
    }
    const user = await resp.json();
    if (user.role === "instructor") {
      document.getElementById("logs-link").classList.remove("hidden");
    }
  } catch {
    window.location.href = "/index.html";
  }
})();

document.getElementById("logout-link").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/index.html";
});

// ── Load scenarios ───────────────────────────────────────

async function loadScenarios() {
  const resp = await fetch("/api/scenarios");
  if (!resp.ok) return;
  scenarios = await resp.json();
}

function renderScenarioGrid() {
  scenarioGridEl.innerHTML = "";
  for (const s of scenarios) {
    const card = document.createElement("div");
    card.className = "scenario-card";
    card.innerHTML = `<h3>${s.title}</h3><p>${s.description}</p>`;
    card.addEventListener("click", () => {
      createSession(s.key);
      scenarioModalEl.classList.add("hidden");
    });
    scenarioGridEl.appendChild(card);
  }
}

// ── Session management ──────────────────────────────────

async function loadSessions() {
  const resp = await fetch("/api/sessions");
  if (!resp.ok) return;
  const sessions = await resp.json();
  sessionListEl.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "session-item" + (s.id === currentSessionId ? " active" : "");
    item.textContent = s.title;
    item.addEventListener("click", () => openSession(s.id, s.title));
    sessionListEl.appendChild(item);
  }
}

async function createSession(scenarioKey) {
  const resp = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: scenarioKey }),
  });
  if (!resp.ok) return;
  const session = await resp.json();
  await loadSessions();
  openSession(session.id, session.title);
}

async function openSession(sessionId, title) {
  currentSessionId = sessionId;
  chatHeaderEl.textContent = title;
  chatInputAreaEl.style.display = "flex";
  chatMessagesEl.innerHTML = "";

  // Highlight active session in sidebar
  document.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("active", el.textContent === title);
  });

  // Load message history
  const resp = await fetch(`/api/sessions/${sessionId}/messages`);
  if (!resp.ok) return;
  const messages = await resp.json();
  for (const m of messages) {
    appendMessage(m.role, m.content);
  }

  chatInputEl.focus();
}

// ── Chat messaging with SSE streaming ───────────────────

function appendMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  const label = role === "student" ? "You" : "Patient";
  el.innerHTML = `<div class="role-label">${label}</div>${escapeHtml(content)}`;
  chatMessagesEl.appendChild(el);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  return el;
}

function appendStreamingMessage() {
  const el = document.createElement("div");
  el.className = "message patient";
  el.innerHTML = `<div class="role-label">Patient</div><span class="streaming-text"></span>`;
  chatMessagesEl.appendChild(el);
  return el;
}

function showTypingIndicator() {
  const el = document.createElement("div");
  el.className = "typing-indicator";
  el.id = "typing-indicator";
  el.innerHTML = "Patient is typing<span>.</span><span>.</span><span>.</span>";
  chatMessagesEl.appendChild(el);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById("typing-indicator")?.remove();
}

async function sendMessage() {
  const message = chatInputEl.value.trim();
  if (!message || !currentSessionId || isStreaming) return;

  isStreaming = true;
  sendBtnEl.disabled = true;
  chatInputEl.value = "";

  appendMessage("student", message);
  showTypingIndicator();

  try {
    const resp = await fetch(`/api/sessions/${currentSessionId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!resp.ok) {
      removeTypingIndicator();
      const err = await resp.json().catch(() => ({}));
      appendMessage("patient", `[Error: ${err.error || resp.status}]`);
      return;
    }

    removeTypingIndicator();
    const msgEl = appendStreamingMessage();
    const textSpan = msgEl.querySelector(".streaming-text");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            textSpan.textContent += parsed.text;
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
          }
          if (parsed.error) {
            textSpan.textContent += `[Error: ${parsed.error}]`;
          }
          if (parsed.done) {
            // Streaming complete
          }
        } catch {}
      }
    }
  } catch (err) {
    removeTypingIndicator();
    appendMessage("patient", `[Network error: ${err.message}]`);
  } finally {
    isStreaming = false;
    sendBtnEl.disabled = false;
    chatInputEl.focus();
  }
}

// ── Event listeners ─────────────────────────────────────

sendBtnEl.addEventListener("click", sendMessage);
chatInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

newSessionBtnEl.addEventListener("click", () => {
  scenarioModalEl.classList.remove("hidden");
});

modalCloseEl.addEventListener("click", () => {
  scenarioModalEl.classList.add("hidden");
});

scenarioModalEl.addEventListener("click", (e) => {
  if (e.target === scenarioModalEl) {
    scenarioModalEl.classList.add("hidden");
  }
});

// ── Helpers ─────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── Init ────────────────────────────────────────────────

(async () => {
  await loadScenarios();
  renderScenarioGrid();
  await loadSessions();
})();
