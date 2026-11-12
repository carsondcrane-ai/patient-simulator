// ── Instructor logs page logic ──────────────────────────

(async () => {
  try {
    const resp = await fetch("/api/auth/me");
    if (!resp.ok) {
      window.location.href = "/index.html";
      return;
    }
    const user = await resp.json();
    if (user.role !== "instructor") {
      window.location.href = "/chat.html";
      return;
    }
    document.getElementById("index-section").classList.remove("hidden");
    loadLogs();
  } catch {
    window.location.href = "/index.html";
  }
})();

document.getElementById("logout-link").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/index.html";
});

// ── Load all chat sessions ──────────────────────────────

async function loadLogs() {
  const resp = await fetch("/api/logs");
  if (!resp.ok) return;
  const sessions = await resp.json();
  const tbody = document.getElementById("logs-body");

  if (sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-dim text-center">No interactions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  for (const s of sessions) {
    const tr = document.createElement("tr");
    tr.className = "clickable";
    const date = new Date(s.created_at).toLocaleString();
    tr.innerHTML = `
      <td>${s.student_name}<br><span class="text-dim" style="font-size:0.8rem">${s.student_email}</span></td>
      <td>${s.title}</td>
      <td>${s.message_count}</td>
      <td>${date}</td>
    `;
    tr.addEventListener("click", () => openDetail(s.id));
    tbody.appendChild(tr);
  }
}

// ── View session detail ─────────────────────────────────

async function openDetail(sessionId) {
  const resp = await fetch(`/api/logs/${sessionId}`);
  if (!resp.ok) return;
  const session = await resp.json();

  const content = document.getElementById("detail-content");
  const date = new Date(session.created_at).toLocaleString();
  let html = `
    <h2>${session.title}</h2>
    <p class="text-dim" style="margin-bottom:1.5rem">
      <strong>${session.student_name}</strong> (${session.student_email}) — ${date}
    </p>
  `;

  if (session.messages && session.messages.length > 0) {
    for (const m of session.messages) {
      const label = m.role === "student" ? "Student" : "Patient";
      const time = new Date(m.created_at).toLocaleTimeString();
      html += `
        <div class="log-message ${m.role}">
          <div class="meta">${label} — ${time}</div>
          ${escapeHtml(m.content)}
        </div>
      `;
    }
  } else {
    html += `<p class="text-dim">No messages in this session.</p>`;
  }

  content.innerHTML = html;
  document.getElementById("detail-modal").classList.remove("hidden");
}

document.getElementById("detail-close").addEventListener("click", () => {
  document.getElementById("detail-modal").classList.add("hidden");
});

document.getElementById("detail-modal").addEventListener("click", (e) => {
  if (e.target.id === "detail-modal") {
    document.getElementById("detail-modal").classList.add("hidden");
  }
});

// ── Index material form ────────────────────────────────

document.getElementById("index-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = document.getElementById("index-text").value.trim();
  const tag = document.getElementById("index-tag").value.trim();
  if (!text) return;

  const metadata = tag ? { tag } : undefined;

  try {
    const resp = await fetch("/api/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, metadata }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      showIndexAlert(data.error || "Failed to index material", "error");
      return;
    }
    showIndexAlert("Material indexed successfully!", "success");
    document.getElementById("index-text").value = "";
    document.getElementById("index-tag").value = "";
  } catch (err) {
    showIndexAlert("Network error", "error");
  }
});

function showIndexAlert(msg, type) {
  const el = document.getElementById("index-alert");
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type === "success" ? "success" : "error"}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ""; }, 3000);
}

// ── Helpers ────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
