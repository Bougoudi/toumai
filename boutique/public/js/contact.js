document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target; const err = document.getElementById("contactError"); err.textContent = "";
  if (!f.checkValidity()) { f.reportValidity(); return; }
  const btn = f.querySelector("button"); btn.disabled = true;
  try {
    const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not send your message.");
    f.replaceWith(HL.el("p", { class: "lede", text: "Thank you — your message has been received. We will reply by email." }));
  } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
});
