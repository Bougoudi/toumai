// Shows the status stored on the server, which only becomes "paid" after the payment was
// verified with iyzico's API — never from these URL parameters.
(async function () {
  const { el, fmt, cart } = HL;
  const q = new URLSearchParams(location.search);
  const order = q.get("order");
  const set = (e, t, x) => { document.getElementById("eyebrow").textContent = e; document.getElementById("title").textContent = t; document.getElementById("text").textContent = x; };
  if (!order) return set("ORDER", "We could not find this payment.", "If you were charged, please contact us with the email address you used.");
  document.getElementById("ref").textContent = `Order number: ${order}`;
  const params = new URLSearchParams(); if (q.get("k")) params.set("k", q.get("k"));
  try {
    const r = await fetch(`/api/orders/${encodeURIComponent(order)}/status?${params}`);
    if (!r.ok) throw new Error();
    const o = await r.json();
    if (o.is_test) set("DEMO ORDER", "Demo order received.", "This was a test: no payment was taken and nothing will be shipped.");
    else if (["paid", "partially_refunded"].includes(o.payment_status)) { cart.clear(); set("THANK YOU", "Your payment is confirmed.", "We are preparing your order and will email you tracking details as soon as it ships."); }
    else if (o.payment_status === "refunded") set("REFUNDED", "This order has been refunded.", "Contact us if you have any question.");
    else if (o.payment_status === "pending") set("PAYMENT PENDING", "We have not received payment confirmation yet.", "If you completed the payment, it will be confirmed shortly — refresh this page in a minute. You will not be charged twice.");
    else set("PAYMENT NOT COMPLETED", "Your payment did not go through.", "No order will be shipped. Your cart is still saved — you can try again.");
    if (o.items) document.getElementById("details").append(el("div", { class: "summary" },
      ...o.items.map(i => el("div", { class: "summary-row" }, el("span", { text: `${i.quantity} × ${i.name} — ${i.variant}` }))),
      el("div", { class: "summary-row total" }, el("span", { text: "Total" }), el("span", { text: fmt(o.total_cents) })),
      o.tracking_url ? el("p", {}, "Tracking: ", el("a", { href: o.tracking_url, rel: "noopener", target: "_blank", text: o.tracking_number || "track parcel" })) : null));
  } catch { set("ORDER", "We could not load this order.", "Please try again later."); }
})();
