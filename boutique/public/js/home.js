HL.config().then(c => document.querySelectorAll("[data-price]").forEach(n => { n.textContent = HL.fmt(c.priceCents); })).catch(() => {});
