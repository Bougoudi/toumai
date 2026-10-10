// Price, shipping and trust lines come from the live store configuration and the
// product facts confirmed in the admin, so the home page never claims more than is true.
Promise.all([HL.config(), HL.catalog()]).then(([c, p]) => {
  document.querySelectorAll("[data-price]").forEach(n => { n.textContent = HL.fmt(c.priceCents); });
  const launch = document.getElementById("launchPrice");
  if (launch) launch.hidden = false;
  if (c.shippingCents === 0) document.querySelectorAll("[data-free-shipping]").forEach(n => { n.hidden = false; });

  const f = p.facts || {};
  const conv = document.getElementById("convenienceFacts");
  const known = [f.powerInput && `Power input: ${f.powerInput}.`, f.dimensions && `Size: ${f.dimensions}.`].filter(Boolean);
  if (conv && known.length) conv.textContent = `${known.join(" ")} See every detail on the product page.`;
  document.querySelectorAll('[data-fact-answer="powerBankIncluded"]').forEach(n => { n.textContent = HL.powerBankText(f); });

  const ship = document.getElementById("trustShipping");
  if (ship) ship.textContent = [
    "We ship to the United States.",
    c.shippingCents === 0 ? "Shipping is included in the price." : `Shipping is ${HL.fmt(c.shippingCents)} per order.`,
    c.deliveryVerified ? `Most orders arrive within ${c.deliveryMinDays}–${c.deliveryMaxDays} business days after dispatch.` : "Delivery times depend on the carrier and your address; we don't promise a date we can't support.",
  ].join(" ");
  const pay = document.getElementById("trustPayment");
  if (pay) pay.textContent = HL.paymentText(c);
  const icons = HL.paymentIcons(c);
  if (icons) document.getElementById("trustPaymentIcons").append(icons);
  if (c.supportEmail) {
    const t = document.getElementById("trustContact");
    t.replaceChildren("Questions before or after your order? Email ", HL.el("a", { href: `mailto:${c.supportEmail}`, text: c.supportEmail }), " or use our ", HL.el("a", { href: "/contact", text: "contact form" }), ".");
  }
}).catch(() => {});
