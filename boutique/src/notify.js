// Emails and admin notifications.
// An email is only marked "sent" when the provider (Resend) accepted it. Without a
// provider, emails are stored as "prepared" so the admin can copy and send them.
const now = () => new Date().toISOString();

function emailConfigured(cfg) { return Boolean(cfg.email.resendApiKey && cfg.email.from); }

let fetchImpl = (...a) => fetch(...a);
function setFetchForTests(f) { fetchImpl = f; }

async function sendViaResend(cfg, to, subject, text) {
  const r = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.email.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.email.from, to: [to], subject, text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Email provider returned HTTP ${r.status}`);
  return j.id || "";
}

/** Stores an email and sends it when a provider is configured. Returns the email row. */
async function queueEmail(db, cfg, { orderId = null, kind, to, subject, body }) {
  const id = db.prepare("INSERT INTO emails(order_id,kind,to_addr,subject,body,status,created_at) VALUES(?,?,?,?,?,'prepared',?)")
    .run(orderId, kind, to, subject, body, now()).lastInsertRowid;
  if (emailConfigured(cfg)) await trySend(db, cfg, id);
  return db.prepare("SELECT * FROM emails WHERE id=?").get(id);
}

async function trySend(db, cfg, id) {
  const e = db.prepare("SELECT * FROM emails WHERE id=?").get(id);
  if (!e || e.status === "sent") return e;
  if (!emailConfigured(cfg)) return e;
  try {
    const providerId = await sendViaResend(cfg, e.to_addr, e.subject, e.body);
    db.prepare("UPDATE emails SET status='sent', provider_id=?, sent_at=?, error=NULL WHERE id=?").run(providerId, now(), id);
  } catch (err) {
    db.prepare("UPDATE emails SET status='failed', error=? WHERE id=?").run(String(err.message || err).slice(0, 500), id);
  }
  return db.prepare("SELECT * FROM emails WHERE id=?").get(id);
}

/** In-dashboard notification, plus email / webhook when configured. Never throws. */
async function notifyAdmin(db, cfg, { kind, title, body, orderId = null }) {
  db.prepare("INSERT INTO notifications(kind,title,body,order_id,created_at) VALUES(?,?,?,?,?)").run(kind, title, body || "", orderId, now());
  if (cfg.email.adminNotifyEmail) {
    await queueEmail(db, cfg, { orderId, kind: `admin_${kind}`, to: cfg.email.adminNotifyEmail, subject: `[${cfg.storeName}] ${title}`, body: body || title }).catch(() => {});
  }
  if (cfg.adminNotifyWebhookUrl) {
    // Works with Discord ("content") and Slack ("text") incoming webhooks.
    await fetchImpl(cfg.adminNotifyWebhookUrl, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${title}\n${body || ""}`, text: `${title}\n${body || ""}` }) }).catch(() => {});
  }
}

module.exports = { emailConfigured, queueEmail, trySend, notifyAdmin, setFetchForTests };
