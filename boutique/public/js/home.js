// Price and shipping lines come from the live store configuration, so the home page always
// matches what checkout actually charges.
HL.config().then(c => {
  document.querySelectorAll("[data-price]").forEach(n => { n.textContent = HL.fmt(c.priceCents); });
  const launch = document.getElementById("launchPrice");
  if (launch) launch.hidden = false;
  // Only claim "shipping included" while shipping really is free at checkout.
  if (c.shippingCents === 0) document.querySelectorAll("[data-free-shipping]").forEach(n => { n.hidden = false; });
}).catch(() => {});
