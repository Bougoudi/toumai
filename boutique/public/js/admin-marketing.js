// Marketing center (admin). Shows only data the store really has; nothing is posted to
// social networks from here. Every write goes through the CSRF-protected admin API.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  let A; // HLAdmin helpers, set on first load
  let data = null;
  let section = "campaigns";
  const SECTIONS = [["campaigns", "Campaigns"], ["content", "Content calendar"], ["promotions", "Promo codes"], ["banner", "Banner"], ["margin", "Margin calculator"]];
  const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const fromLocal = (v) => v ? new Date(v).toISOString() : "";
  const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${A.esc(k)}"${k === sel ? " selected" : ""}>${A.esc(v)}</option>`).join("");
  const nf = (n) => new Intl.NumberFormat("en-US").format(n || 0);
  const formData = (f) => Object.fromEntries(new FormData(f));

  async function load() {
    A = window.HLAdmin;
    const box = $("#marketing");
    if (!data) box.innerHTML = '<div class="admin-card an-state">Loading marketing…</div>';
    try { data = await A.api("/api/admin/marketing"); }
    catch (e) { box.innerHTML = `<div class="admin-card an-state error" role="alert">Could not load marketing data: ${A.esc(e.message)}</div>`; return; }
    render();
  }
  const reload = async (msg) => { if (msg) A.toast(msg); data = await A.api("/api/admin/marketing"); render(); };

  function render() {
    const box = $("#marketing");
    box.innerHTML = `<div class="admin-card an-controls" role="tablist">${SECTIONS.map(([k, l]) => `<button type="button" class="admin-btn ${k === section ? "" : "ghost"}" data-sec="${k}" aria-pressed="${k === section}">${l}</button>`).join("")}</div><div id="mkBody"></div>`;
    box.querySelectorAll("[data-sec]").forEach(b => b.addEventListener("click", () => { section = b.dataset.sec; render(); }));
    ({ campaigns, content, promotions, banner, margin })[section]();
  }

  const copyBtn = (text, label = "Copy link") => `<button type="button" class="admin-btn ghost" data-copy="${A.esc(text)}">${label}</button>`;
  function wireCopy(root) {
    root.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); A.toast("Copied."); } catch { A.toast(b.dataset.copy); }
    }));
  }
  function wireForm(form, fn) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await fn(formData(form)); } catch (err) { A.toast(err.message); }
    });
  }

  // ------------------------------------------------------------ campaigns
  function campaigns(editId) {
    const r = data.report; const o = data.options;
    const edit = editId ? r.campaigns.find(c => c.id === editId) : null;
    const urlNote = data.publicUrlConfigured ? "" : '<p class="micro">PUBLIC_URL is not set: links use http://localhost:3000 until it is configured.</p>';
    $("#mkBody").innerHTML = `
      <div class="admin-card"><h2 class="admin-h2">Campaign results</h2>
        <p class="micro">Visits and shopping steps come from the store's own analytics (only visitors who did not opt out, and only links carrying the campaign's UTM tag). Orders and payments come from your order database; “paid” means confirmed by iyzico. Ad spend is what you enter — it is not imported from ad platforms. Nothing here is estimated or recommended automatically.</p>
        ${r.campaigns.length ? `<div class="table-scroll"><table class="admin-table compact"><thead><tr>
          <th>Campaign</th><th class="num">Visits</th><th class="num">Product views</th><th class="num">Add to cart</th><th class="num">Checkout</th>
          <th class="num">Orders created</th><th class="num">Paid orders</th><th class="num">Revenue</th><th class="num">Ad spend</th><th class="num">Cost / customer</th><th class="num">ROAS</th><th class="num">Profit after ads</th><th></th></tr></thead><tbody>
          ${r.campaigns.map(c => `<tr${c.archived ? ' class="muted"' : ""}>
            <td><b>${A.esc(c.name)}</b><br><span class="muted">${A.esc(c.channel_label)} · ${A.esc(c.slug)}${c.start_date ? ` · ${A.esc(c.start_date)} → ${A.esc(c.end_date || "…")}` : ""}</span>
              ${c.flags.length ? `<ul class="flags">${c.flags.map(f => `<li>${A.esc(f)}</li>`).join("")}</ul>` : ""}</td>
            <td class="num">${nf(c.tracked.sessions)}</td><td class="num">${nf(c.tracked.product_views)}</td><td class="num">${nf(c.tracked.add_to_cart)}</td><td class="num">${nf(c.tracked.begin_checkout)}</td>
            <td class="num">${nf(c.orders_created)}</td><td class="num"><b>${nf(c.paid_orders)}</b></td><td class="num">${A.money(c.revenue_cents)}</td>
            <td class="num">${A.money(c.spend_cents)}${c.budget_cents ? `<br><span class="muted">of ${A.money(c.budget_cents)}</span>` : ""}</td>
            <td class="num">${c.cac_cents === null ? "—" : A.money(c.cac_cents)}</td><td class="num">${c.roas === null ? "—" : c.roas + "×"}</td>
            <td class="num">${c.profit_after_spend_cents === null ? "—" : A.money(c.profit_after_spend_cents)}</td>
            <td>${copyBtn(c.url)}<button type="button" class="admin-btn ghost" data-edit="${c.id}">Edit</button></td></tr>`).join("")}
          </tbody></table></div>` : '<p class="muted">No campaigns yet. Create one below to get a tracking link.</p>'}
      </div>
      <div class="admin-card"><h2 class="admin-h2">${edit ? `Edit “${A.esc(edit.name)}”` : "New campaign"}</h2>
        <form id="campaignForm" class="admin-form grid-form">
          <label>Name<input name="name" required maxlength="100" value="${A.esc(edit?.name || "")}" placeholder="Fall launch – TikTok"></label>
          <label>Channel<select name="channel" id="cChannel">${opt(o.channels, edit?.channel || "tiktok")}</select></label>
          <label>utm_source<input name="utmSource" id="cSource" maxlength="60" value="${A.esc(edit?.utm_source || "")}" placeholder="auto from channel"></label>
          <label>utm_medium<select name="utmMedium">${opt(Object.fromEntries(o.mediums.map(m => [m, m])), edit?.utm_medium || "social")}</select></label>
          <label>Campaign tag (utm_campaign)<input name="slug" maxlength="60" value="${A.esc(edit?.slug || "")}" placeholder="auto from name, e.g. fall-launch-tiktok"></label>
          <label>Landing page<input name="landingPath" value="${A.esc(edit?.landing_path || "/product")}" maxlength="100"></label>
          <label class="span2">Objective<input name="objective" maxlength="300" value="${A.esc(edit?.objective || "")}" placeholder="e.g. first 20 paid orders, test the work-from-home angle"></label>
          <label>Budget (USD)<input name="budget" type="number" step="0.01" min="0" value="${edit?.budget_cents != null ? A.dollars(edit.budget_cents) : ""}"></label>
          <label>Actual ad spend so far (USD)<input name="spend" type="number" step="0.01" min="0" value="${edit ? A.dollars(edit.spend_cents) : ""}"></label>
          <label>Start date<input name="startDate" type="date" value="${A.esc(edit?.start_date || "")}"></label>
          <label>End date<input name="endDate" type="date" value="${A.esc(edit?.end_date || "")}"></label>
          <label class="span2">Notes<textarea name="notes" rows="2" maxlength="2000">${A.esc(edit?.notes || "")}</textarea></label>
          ${edit ? `<label class="check span2"><input type="checkbox" name="archived" value="1" ${edit.archived ? "checked" : ""}> Archived</label>` : ""}
          <button class="admin-btn span2">${edit ? "Save campaign" : "Create campaign"}</button>
          ${edit ? '<button type="button" class="admin-btn ghost span2" id="cancelEdit">Cancel</button>' : ""}
        </form>${urlNote}</div>
      <div class="grid2">
        <div class="admin-card"><h2 class="admin-h2">Visits by source (all time)</h2>${r.sources.length ? `<table class="admin-table compact"><tbody>${r.sources.map(s => `<tr><td>${A.esc(s.source)}</td><td class="num">${nf(s.sessions)} ${s.sessions === 1 ? "visit" : "visits"}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No visits recorded yet.</p>'}</div>
        <div class="admin-card"><h2 class="admin-h2">Orders by source (all time)</h2>${r.orderSources.length ? `<table class="admin-table compact"><thead><tr><th>Source</th><th class="num">Created</th><th class="num">Paid</th></tr></thead><tbody>${r.orderSources.map(s => `<tr><td>${A.esc(s.source)}</td><td class="num">${nf(s.orders)}</td><td class="num">${nf(s.paid)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No real orders yet (demo orders are excluded).</p>'}</div>
      </div>`;
    const body = $("#mkBody");
    wireCopy(body);
    body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => campaigns(Number(b.dataset.edit))));
    $("#cancelEdit")?.addEventListener("click", () => campaigns());
    $("#cChannel").addEventListener("change", () => { if (!edit) $("#cSource").placeholder = `auto: ${o.defaultSources[$("#cChannel").value]}`; });
    wireForm($("#campaignForm"), async (d) => {
      if (edit && !d.archived) d.archived = "0";
      await A.post(edit ? `/api/admin/marketing/campaigns/${edit.id}` : "/api/admin/marketing/campaigns", d);
      await reload(edit ? "Campaign saved." : "Campaign created — copy its tracking link from the table.");
    });
  }

  // ------------------------------------------------------------ content calendar
  function content(editId) {
    const o = data.options;
    const edit = editId ? data.content.find(c => c.id === editId) : null;
    const camps = { "": "— none —", ...Object.fromEntries(data.report.campaigns.map(c => [String(c.id), c.name])) };
    const statusLabel = { idea: "Idea", to_produce: "To produce", ready: "Ready", published: "Published" };
    $("#mkBody").innerHTML = `
      <div class="admin-card"><h2 class="admin-h2">Content calendar</h2>
        <p class="micro">Plan videos and posts for the three HavenLume angles. Publishing is done by you on each platform — the store does not post anything automatically.</p>
        ${data.content.length ? `<div class="table-scroll"><table class="admin-table compact"><thead><tr><th>Date</th><th>Content</th><th>Angle</th><th>Channel</th><th>Status</th><th></th></tr></thead><tbody>
          ${data.content.map(c => `<tr><td>${A.esc(c.publish_date || "—")}</td><td><b>${A.esc(c.title)}</b>${c.hook ? `<br><span class="muted">“${A.esc(c.hook)}”</span>` : ""}${c.published_url ? `<br><a href="${A.esc(c.published_url)}" target="_blank" rel="noopener">View post</a>` : ""}</td>
            <td>${A.esc(o.angles[c.angle] || c.angle)}</td><td>${A.esc(o.channels[c.channel] || c.channel)}</td><td><span class="pill pill-${c.status === "published" ? "paid" : "pending"}">${statusLabel[c.status]}</span></td>
            <td>${c.tracking_url ? copyBtn(c.tracking_url, "Copy tracking link") : '<span class="muted">link to a campaign for a tracking link</span>'}<button type="button" class="admin-btn ghost" data-edit="${c.id}">Edit</button></td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">No content planned yet.</p>`}
        <button type="button" class="admin-btn ghost" id="starters">Add 3 starter ideas (one per angle)</button>
      </div>
      <div class="admin-card"><h2 class="admin-h2">${edit ? "Edit content" : "New content"}</h2>
        <form id="contentForm" class="admin-form grid-form">
          <label class="span2">Title<input name="title" required maxlength="120" value="${A.esc(edit?.title || "")}"></label>
          <label>Angle<select name="angle">${opt(o.angles, edit?.angle || "work_from_home")}</select></label>
          <label>Channel<select name="channel">${opt(o.channels, edit?.channel || "tiktok")}</select></label>
          <label class="span2">Hook<input name="hook" maxlength="300" value="${A.esc(edit?.hook || "")}" placeholder="The first line or the first 2 seconds"></label>
          <label class="span2">Script<textarea name="script" rows="6" maxlength="6000">${A.esc(edit?.script || "")}</textarea></label>
          <label>Status<select name="status">${opt(statusLabel, edit?.status || "idea")}</select></label>
          <label>Publish date<input name="publishDate" type="date" value="${A.esc(edit?.publish_date || "")}"></label>
          <label class="span2">Published URL (https)<input name="publishedUrl" maxlength="500" value="${A.esc(edit?.published_url || "")}" placeholder="Required to mark as published"></label>
          <label>Campaign<select name="campaignId">${opt(camps, edit?.campaign_id ? String(edit.campaign_id) : "")}</select></label>
          <label>utm_content<input name="utmContent" maxlength="60" value="${A.esc(edit?.utm_content || "")}" placeholder="auto from title"></label>
          <label class="span2">Notes<textarea name="notes" rows="2" maxlength="2000">${A.esc(edit?.notes || "")}</textarea></label>
          <button class="admin-btn span2">${edit ? "Save" : "Add to calendar"}</button>
          ${edit ? '<button type="button" class="admin-btn ghost" id="cancelEdit">Cancel</button><button type="button" class="admin-btn danger-btn" id="deleteContent">Delete</button>' : ""}
        </form></div>`;
    const body = $("#mkBody");
    wireCopy(body);
    body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => content(Number(b.dataset.edit))));
    $("#cancelEdit")?.addEventListener("click", () => content());
    $("#deleteContent")?.addEventListener("click", async () => { if (!confirm("Delete this content item?")) return; try { await A.post(`/api/admin/marketing/content/${edit.id}/delete`); await reload("Deleted."); } catch (e) { A.toast(e.message); } });
    $("#starters").addEventListener("click", async () => { try { const r = await A.post("/api/admin/marketing/content-starters"); await reload(r.created ? `${r.created} starter idea(s) added.` : "Starter ideas are already in the calendar."); } catch (e) { A.toast(e.message); } });
    wireForm($("#contentForm"), async (d) => {
      await A.post(edit ? `/api/admin/marketing/content/${edit.id}` : "/api/admin/marketing/content", d);
      await reload(edit ? "Saved." : "Added to the calendar.");
    });
  }

  // ------------------------------------------------------------ promotions
  function promotions(editId) {
    const edit = editId ? data.promotions.find(p => p.id === editId) : null;
    $("#mkBody").innerHTML = `
      <div class="admin-card"><h2 class="admin-h2">Promo codes</h2>
        <p class="micro">Discounts are calculated and checked on the server, applied to the product subtotal, and included in the amount charged by iyzico. Customers see the exact conditions below at checkout. No countdowns, no fake “was” prices.</p>
        ${data.promotions.length ? `<table class="admin-table compact"><thead><tr><th>Code</th><th>Conditions</th><th>Status</th><th class="num">Paid orders</th><th class="num">Discount given</th><th></th></tr></thead><tbody>
          ${data.promotions.map(p => `<tr><td><b>${A.esc(p.code)}</b>${p.description ? `<br><span class="muted">${A.esc(p.description)}</span>` : ""}</td><td>${A.esc(p.conditions)}</td>
            <td>${p.live ? '<span class="pill pill-paid">live</span>' : `<span class="pill pill-pending">${p.active ? "scheduled / ended" : "off"}</span>`}</td>
            <td class="num">${nf(p.paid_redemptions)}${p.max_redemptions ? ` / ${nf(p.max_redemptions)}` : ""}</td><td class="num">${A.money(p.discount_given_cents)}</td>
            <td><button type="button" class="admin-btn ghost" data-edit="${p.id}">Edit</button></td></tr>`).join("")}</tbody></table>` : '<p class="muted">No promo codes yet.</p>'}
      </div>
      <div class="admin-card"><h2 class="admin-h2">${edit ? `Edit ${A.esc(edit.code)}` : "New promo code"}</h2>
        <form id="promoForm" class="admin-form grid-form">
          <label>Code<input name="code" required maxlength="24" value="${A.esc(edit?.code || "")}" placeholder="COZY10" style="text-transform:uppercase"></label>
          <label>Internal description<input name="description" maxlength="200" value="${A.esc(edit?.description || "")}"></label>
          <label>Type<select name="kind"><option value="percent"${edit?.kind !== "fixed" ? " selected" : ""}>Percentage of subtotal</option><option value="fixed"${edit?.kind === "fixed" ? " selected" : ""}>Fixed amount (USD)</option></select></label>
          <label>Value (% or USD)<input name="value" type="number" step="0.01" min="0" required value="${edit ? (edit.kind === "fixed" ? A.dollars(edit.value) : edit.value) : ""}"></label>
          <label>Minimum subtotal (USD)<input name="minSubtotal" type="number" step="0.01" min="0" value="${edit ? A.dollars(edit.min_subtotal_cents) : "0"}"></label>
          <label>Usage limit (paid orders, optional)<input name="maxRedemptions" type="number" min="1" value="${edit?.max_redemptions || ""}"></label>
          <label>Starts<input name="startsAt" type="datetime-local" required value="${toLocal(edit?.starts_at)}"></label>
          <label>Ends<input name="endsAt" type="datetime-local" required value="${toLocal(edit?.ends_at)}"></label>
          <label class="check span2"><input type="checkbox" name="active" value="1" ${!edit || edit.active ? "checked" : ""}> Active</label>
          <button class="admin-btn span2">${edit ? "Save" : "Create code"}</button>
          ${edit ? '<button type="button" class="admin-btn ghost span2" id="cancelEdit">Cancel</button>' : ""}
        </form></div>`;
    const body = $("#mkBody");
    body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => promotions(Number(b.dataset.edit))));
    $("#cancelEdit")?.addEventListener("click", () => promotions());
    wireForm($("#promoForm"), async (d) => {
      d.startsAt = fromLocal(d.startsAt); d.endsAt = fromLocal(d.endsAt); d.active = d.active ? "1" : "0";
      await A.post(edit ? `/api/admin/marketing/promotions/${edit.id}` : "/api/admin/marketing/promotions", d);
      await reload(edit ? "Promo code saved." : "Promo code created.");
    });
  }

  // ------------------------------------------------------------ banner
  function banner() {
    const b = data.banner;
    const codes = { "": "— no code —", ...Object.fromEntries(data.promotions.map(p => [p.code, p.code])) };
    $("#mkBody").innerHTML = `
      <div class="admin-card"><h2 class="admin-h2">Promotional banner</h2>
        <p>${data.bannerLive ? `<span class="pill pill-paid">Live now</span> “${A.esc(data.bannerLive.text)}”` : '<span class="pill pill-pending">Not showing</span> (disabled, outside its dates, or its promo code is not valid right now)'}</p>
        <form id="bannerForm" class="admin-form grid-form">
          <label class="span2">Text (max 120 characters)<input name="text" maxlength="120" value="${A.esc(b.text)}" placeholder="Launch offer: 10% off your first throw"></label>
          <label>Link (optional page)<input name="link" maxlength="100" value="${A.esc(b.link)}" placeholder="/product"></label>
          <label>Promo code shown (optional)<select name="promo">${opt(codes, b.promo)}</select></label>
          <label>Starts<input name="startsAt" type="datetime-local" value="${toLocal(b.startsAt)}"></label>
          <label>Ends<input name="endsAt" type="datetime-local" value="${toLocal(b.endsAt)}"></label>
          <label class="check span2"><input type="checkbox" name="enabled" value="1" ${b.enabled ? "checked" : ""}> Show the banner between these dates</label>
          <button class="admin-btn span2">Save banner</button>
        </form>
        <p class="micro">When a code is attached, its exact conditions are shown under “Terms”, and the banner disappears automatically if the code expires or is switched off.</p></div>`;
    wireForm($("#bannerForm"), async (d) => {
      d.startsAt = fromLocal(d.startsAt); d.endsAt = fromLocal(d.endsAt); d.enabled = d.enabled ? "1" : "0";
      await A.post("/api/admin/marketing/banner", d);
      await reload("Banner saved.");
    });
  }

  // ------------------------------------------------------------ margin calculator
  function margin() {
    const s = data.settings;
    $("#mkBody").innerHTML = `
      <div class="admin-card"><h2 class="admin-h2">Margin per order (simulation)</h2>
        <p class="micro">A “what if” calculation, not a result. Uses your cost settings: product $${A.esc(s.product_cost_usd)} + shipping $${A.esc(s.shipping_cost_usd)} per unit (= $${(Number(s.product_cost_usd) + Number(s.shipping_cost_usd)).toFixed(2)}), payment fee ${A.esc(s.payment_fee_percent)}% + $${A.esc(s.payment_fee_fixed_usd)}.</p>
        <form id="marginForm" class="admin-form grid-form">
          <label>Price per unit (USD)<input name="price" type="number" step="0.01" min="0" value="${A.dollars(data.priceCents)}"></label>
          <label>Units<input name="units" type="number" min="1" max="100" value="1"></label>
          <label>Discount on the order (USD)<input name="discount" type="number" step="0.01" min="0" value="0"></label>
          <label>Ad cost to win this order (USD)<input name="adPerOrder" type="number" step="0.01" min="0" value="0"></label>
          <label>Other costs (USD)<input name="other" type="number" step="0.01" min="0" value="0"></label>
          <button class="admin-btn span2">Calculate</button>
        </form>
        <div id="marginOut"></div></div>`;
    const run = async (d) => {
      const r = await A.post("/api/admin/marketing/unit-economics", d);
      $("#marginOut").innerHTML = `<table class="admin-table compact"><tbody>
        <tr><td>Amount charged</td><td class="num">${A.money(r.charged_cents)}</td></tr>
        <tr><td>Supplier product</td><td class="num">− ${A.money(r.product_cost_cents)}</td></tr>
        <tr><td>Supplier shipping</td><td class="num">− ${A.money(r.shipping_cost_cents)}</td></tr>
        <tr><td>Payment fees ${r.fee_configured ? "" : '<span class="muted">(not configured — set them in Settings)</span>'}</td><td class="num">− ${A.money(r.payment_fee_cents)}</td></tr>
        <tr><td>Other costs</td><td class="num">− ${A.money(r.other_cents)}</td></tr>
        <tr><td>Margin before ads</td><td class="num">${A.money(r.profit_before_ads_cents)}</td></tr>
        <tr><td>Ad cost</td><td class="num">− ${A.money(r.ad_cents)}</td></tr>
        <tr class="total-row"><td>Profit per order</td><td class="num">${A.money(r.profit_cents)}${r.margin_percent === null ? "" : ` (${r.margin_percent}%)`}</td></tr>
        </tbody></table>
        <p class="micro">Break-even: you can spend at most <b>${A.money(r.break_even_ad_cents)}</b> in ads per paid order before losing money on it (before taxes, refunds and returns).</p>`;
    };
    wireForm($("#marginForm"), run);
    run(formData($("#marginForm"))).catch(e => A.toast(e.message));
  }

  window.HLMarketing = { load };
})();
