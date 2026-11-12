// ── Login / Register page logic ────────────────────────

const API = "/api/auth";

function showAlert(elId, msg, type = "error") {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

// Toggle between login and register views
document.getElementById("show-register")?.addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("register-view").classList.remove("hidden");
});

document.getElementById("show-login")?.addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("register-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
});

// Login form
document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  try {
    const resp = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      showAlert("login-alert", data.error || "Login failed");
      return;
    }
    window.location.href = data.role === "instructor" ? "/logs.html" : "/chat.html";
  } catch (err) {
    showAlert("login-alert", "Network error — check your connection");
  }
});

// Register form
document.getElementById("register-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("reg-name").value;
  const email = document.getElementById("reg-email").value;
  const password = document.getElementById("reg-password").value;
  const role = document.getElementById("reg-role").value;

  try {
    const resp = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      showAlert("register-alert", data.error || "Registration failed");
      return;
    }
    window.location.href = data.role === "instructor" ? "/logs.html" : "/chat.html";
  } catch (err) {
    showAlert("register-alert", "Network error — check your connection");
  }
});

// Check if already logged in — redirect
(async () => {
  try {
    const resp = await fetch(`${API}/me`);
    if (resp.ok) {
      const data = await resp.json();
      window.location.href = data.role === "instructor" ? "/logs.html" : "/chat.html";
    }
  } catch {}
})();
