// The objection FAQ is built from the confirmed product facts, so it never says more than is verified.
Promise.all([HL.config(), HL.catalog()]).then(([cfg, p]) => {
  HL.renderFaq(document.getElementById("objectionFaq"), HL.productFaq(p.facts, cfg));
  document.getElementById("payAnswer").textContent = HL.paymentText(cfg);
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target && target.tagName === "DETAILS") { target.open = true; target.scrollIntoView(); }
}).catch(() => {
  document.getElementById("objectionFaq").textContent = "Could not load the answers. Please refresh, or contact us.";
});
