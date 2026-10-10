document.getElementById("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("error"); err.textContent = "";
  try {
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) location.href = "/admin"; else err.textContent = j.error || "Sign-in failed.";
  } catch { err.textContent = "Network error."; }
});
