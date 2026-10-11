// Customer reviews on the product page. Everything shown comes from GET /api/reviews (approved
// reviews only). The form validates with the same rules as the server, but only the server's
// answer decides: a confirmation is shown only after a real 201 response.
(async function () {
  const { el } = HL;
  const R = window.HLReviewRules;
  const $ = (id) => document.getElementById(id);
  const form = $("reviewForm");
  if (!form || !R) return;
  // The section stays hidden unless the store owner enabled reviews (REVIEWS_ENABLED=true).
  const storeCfg = await HL.config().catch(() => ({}));
  if (!storeCfg.reviewsEnabled) return;
  $("reviews").hidden = false;
  const jump = $("reviewsJump"); if (jump) jump.hidden = false;
  const PRODUCT_ID = "usb-heated-throw";

  // Single-use verification link (?review=…): kept in memory only and removed from the address bar.
  const params = new URLSearchParams(location.search);
  const token = /^[A-Za-z0-9_-]{43}$/.test(params.get("review") || "") ? params.get("review") : null;
  let verifyToken = token;
  if (params.has("review")) { params.delete("review"); history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash); }

  // ------------------------------------------------------------ public list
  let page = 1;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const stars = (n) => el("span", { class: "stars", role: "img", "aria-label": `${n} out of 5 stars` },
    ...[1, 2, 3, 4, 5].map(i => el("span", { class: i <= n ? "star on" : "star", "aria-hidden": "true", text: "★" })));

  function renderSummary(s) {
    const box = $("reviewSummary");
    if (!s.count) {
      box.replaceChildren(el("p", { class: "no-reviews", text: "No reviews yet. Be the first to share your experience." }),
        el("a", { class: "button", href: "#write-review" }, "Write a review"));
      return;
    }
    const avg = s.average.toFixed(1);
    box.replaceChildren(
      el("p", { class: "avg" }, el("strong", { text: avg }), el("span", { text: " out of 5" })),
      stars(Math.round(s.average)),
      el("p", { class: "micro", text: `Based on ${s.count} published review${s.count === 1 ? "" : "s"}` }),
      el("ul", { class: "distribution", "aria-label": "Rating distribution" }, [5, 4, 3, 2, 1].map(n => {
        const c = s.distribution[n] || 0; const pct = Math.round((c / s.count) * 100);
        return el("li", {}, el("span", { class: "dist-label", text: `${n} star${n === 1 ? "" : "s"}` }),
          el("span", { class: "bar", "aria-hidden": "true" }, el("span", { class: "fill", style: `width:${pct}%` })),
          el("span", { class: "dist-count", text: `${c}` }), el("span", { class: "sr-only", text: ` reviews (${pct}%)` }));
      })),
      el("a", { class: "button secondary", href: "#write-review" }, "Write a review"));
  }

  function renderList(data) {
    $("reviewList").replaceChildren(...data.reviews.map(r => el("article", { class: "review-card" },
      el("div", { class: "review-head" }, stars(r.rating),
        r.verifiedPurchase ? el("a", { class: "verified", href: "/review-policy#verified", text: "Verified Purchase" }) : null),
      r.title ? el("h3", { text: r.title }) : null,
      el("p", { class: "review-text", text: r.comment }),
      el("p", { class: "micro review-meta", text: `${r.displayName} · ${fmtDate(r.publishedAt)}${r.wouldRecommend === "yes" ? " · Recommends this product" : ""}` }))));
    const pager = $("reviewPager");
    pager.hidden = data.pages <= 1;
    $("pageInfo").textContent = `Page ${data.page} of ${data.pages}`;
    $("prevReviews").disabled = data.page <= 1;
    $("nextReviews").disabled = data.page >= data.pages;
  }

  async function load(p) {
    try {
      const r = await fetch(`/api/reviews?productId=${PRODUCT_ID}&page=${p}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      page = data.page; renderSummary(data.summary); renderList(data);
    } catch { $("reviewSummary").replaceChildren(el("p", { class: "micro", text: "Reviews couldn't be loaded. Please refresh the page." })); }
  }
  $("prevReviews").addEventListener("click", () => { load(page - 1); $("reviews").scrollIntoView(); });
  $("nextReviews").addEventListener("click", () => { load(page + 1); $("reviews").scrollIntoView(); });
  load(1);

  // ------------------------------------------------------------ verification box
  HL.config().then(cfg => {
    const box = $("verifyBox");
    if (token) {
      fetch(`/api/reviews/verification?token=${encodeURIComponent(token)}`).then(r => r.json()).then(v => {
        box.replaceChildren(el("p", { class: v.valid ? "verify-ok" : "form-error",
          text: v.valid ? "Your single-use link is active: we'll check this review against your order. If the order is eligible, it will show the Verified Purchase badge."
            : "This review link is invalid, expired or already used. You can still write a review; it won't show the Verified Purchase badge." }));
        if (!v.valid) verifyToken = null;
      }).catch(() => {});
      return;
    }
    if (!cfg.reviewVerificationAvailable) {
      box.replaceChildren(el("p", { class: "micro", text: "Verified Purchase badges are given only when we can confirm your order through a single-use link sent to your order email. This isn't available yet, so new reviews are published without the badge." }));
      return;
    }
    const f = el("form", { class: "verify-form", novalidate: "" },
      el("p", { class: "micro", text: "Bought from HavenLume? Get a single-use link at your order email to add the Verified Purchase badge (optional)." }),
      el("label", { for: "vOrder", text: "Order number" }), el("input", { id: "vOrder", name: "orderNumber", maxlength: "40", autocomplete: "off", placeholder: "HL-…" }),
      el("label", { for: "vEmail", text: "Email used for the order" }), el("input", { id: "vEmail", name: "email", type: "email", maxlength: "254", autocomplete: "email" }),
      el("button", { class: "button secondary", type: "submit", text: "Email me a link" }),
      el("p", { class: "form-status", role: "status", "aria-live": "polite" }));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = f.querySelector("button"); const out = f.querySelector(".form-status");
      btn.disabled = true; out.textContent = "Sending…";
      try {
        const r = await fetch("/api/reviews/verification-request", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderNumber: f.orderNumber.value, email: f.email.value }) });
        const j = await r.json().catch(() => ({}));
        out.textContent = j.message || j.error || "Something went wrong. Please try again.";
      } catch { out.textContent = "Network error. Please try again."; }
      btn.disabled = false;
    });
    box.replaceChildren(f);
  });

  // ------------------------------------------------------------ form
  const btn = $("submitReview");
  const fields = ["rating", "displayName", "title", "comment", "purchasedFromHavenLume", "publicationConsent"];
  const touched = new Set();
  let submitting = false;

  function values() {
    const fd = new FormData(form);
    return {
      rating: Number(fd.get("rating")),
      displayName: fd.get("displayName") || "",
      title: fd.get("title") || "",
      comment: fd.get("comment") || "",
      purchasedFromHavenLume: fd.get("purchasedFromHavenLume"),
      wouldRecommend: fd.get("wouldRecommend") || null,
      publicationConsent: $("publicationConsent").checked,
    };
  }
  const inputFor = { displayName: "displayName", title: "reviewTitle", comment: "reviewComment", publicationConsent: "publicationConsent" };

  function showErrors(errors, all) {
    for (const f of fields) {
      const msg = (all || touched.has(f)) ? errors[f] || "" : "";
      $(`err-${f}`).textContent = msg;
      const input = inputFor[f] && $(inputFor[f]);
      if (input) { if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
    }
  }

  function refresh() {
    const v = values();
    const { errors } = R.validate(v);
    const n = R.length(R.normalize(v.comment, true));
    $("commentCount").textContent = `${n.toLocaleString("en-US")} / 1,500 characters${n < 20 ? " (minimum 20)" : ""}`;
    $("commentCount").classList.toggle("over", n > 1500);
    $("ratingText").textContent = `${v.rating} out of 5`;
    showErrors(errors, false);
    btn.disabled = submitting || Object.keys(errors).length > 0;
  }
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  for (const [f, id] of Object.entries(inputFor)) $(id).addEventListener("blur", () => { touched.add(f); refresh(); });
  $("publicationConsent").addEventListener("change", () => { touched.add("publicationConsent"); refresh(); });
  refresh();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    const v = values();
    const { errors } = R.validate(v);
    if (Object.keys(errors).length) { fields.forEach(f => touched.add(f)); showErrors(errors, true); return; }
    submitting = true; btn.disabled = true;
    form.setAttribute("aria-busy", "true");
    form.querySelectorAll("input, textarea").forEach(i => { i.disabled = true; });
    $("reviewError").textContent = ""; $("reviewStatus").textContent = "Sending your review…";
    try {
      const body = { productId: PRODUCT_ID, ...v, title: v.title || undefined, website: $("website").value || undefined, verificationToken: verifyToken || undefined };
      const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status !== 201) {
        if (j.errors) { fields.forEach(f => touched.add(f)); showErrors(j.errors, true); }
        throw new Error(r.status === 429 ? "Too many reviews from this connection. Please try again later." : j.error || "Your review could not be sent. Please try again.");
      }
      verifyToken = null;
      $("write-review").replaceChildren(el("div", { class: "review-thanks", role: "status" },
        el("h3", { text: "Thank you — we received your review." }),
        el("p", { text: `It will be published after a quick check by our team${j.verifiedPurchase ? ", with the Verified Purchase badge" : ""}. We publish positive and negative reviews alike.` })));
    } catch (err) {
      $("reviewStatus").textContent = "";
      $("reviewError").textContent = err.message === "Failed to fetch" ? "Network error — your review was not sent. Please try again." : err.message;
      submitting = false; form.removeAttribute("aria-busy");
      form.querySelectorAll("input, textarea").forEach(i => { i.disabled = false; });
      refresh();
    }
  });
})();
