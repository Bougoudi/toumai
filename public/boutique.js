'use strict';
// Boutique publique : pop-up d'inscription (code de bienvenue) et pré-remplissage
// du code promo. La boutique fonctionne entièrement sans ce script.
(function () {
  var KEY = 'tm_newsletter';
  var WEEK = 7 * 24 * 3600 * 1000;

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    } catch (e) {
      return {};
    }
  }
  function write(v) {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch (e) {
      /* stockage indisponible : la pop-up reviendra à la prochaine visite */
    }
  }

  var state = read();

  // Code déjà obtenu : on le place dans le champ « Code promo » de la commande.
  var promo = document.getElementById('promo');
  if (promo && state.code && !promo.value) promo.value = state.code;

  var box = document.getElementById('nl');
  if (!box) return;
  if (state.code || state.done) return;
  if (state.dismissedAt && Date.now() - state.dismissedAt < WEEK) return;

  var lastFocus = null;
  var shown = false;

  function open() {
    if (shown) return;
    shown = true;
    lastFocus = document.activeElement;
    box.hidden = false;
    var email = document.getElementById('nl-email');
    if (email) email.focus({ preventScroll: true });
    document.addEventListener('keydown', onKey);
  }
  function close() {
    box.hidden = true;
    document.removeEventListener('keydown', onKey);
    var s = read();
    if (!s.code) {
      s.dismissedAt = Date.now();
      write(s);
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  box.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', close);
  });

  // Ouverture : après 8 s, ou dès que le visiteur a parcouru 40 % de la page.
  var timer = setTimeout(open, 8000);
  window.addEventListener(
    'scroll',
    function onScroll() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (h > 0 && window.scrollY / h > 0.4) {
        clearTimeout(timer);
        window.removeEventListener('scroll', onScroll);
        open();
      }
    },
    { passive: true },
  );

  var form = document.getElementById('nl-form');
  var err = document.getElementById('nl-err');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    var data = { email: form.email.value, source: 'popup', website: form.website.value };
    fetch('/boutique/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Inscription impossible, réessayez.');
          return j;
        });
      })
      .then(function (j) {
        var s = read();
        delete s.dismissedAt;
        if (j.code) {
          s.code = j.code;
          document.getElementById('nl-code').textContent = j.code;
          if (promo && !promo.value) promo.value = j.code;
        } else {
          s.done = true;
          document.getElementById('nl-code').textContent = 'Déjà utilisé';
        }
        write(s);
        document.getElementById('nl-step1').hidden = true;
        document.getElementById('nl-step2').hidden = false;
      })
      .catch(function (ex) {
        err.textContent = ex.message || 'Inscription impossible, réessayez.';
        err.hidden = false;
      })
      .finally(function () {
        btn.disabled = false;
      });
  });

  var copy = document.getElementById('nl-copy');
  copy.addEventListener('click', function () {
    var code = document.getElementById('nl-code').textContent;
    var done = function () {
      copy.textContent = 'Copié';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () {
        selectCode();
      });
    } else {
      selectCode();
    }
  });
  function selectCode() {
    var r = document.createRange();
    r.selectNodeContents(document.getElementById('nl-code'));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
})();

// Fiche produit : total en direct (lot + code de bienvenue estimé) et
// récapitulatif avant paiement. Sans JavaScript, le formulaire s'envoie tel quel ;
// les montants définitifs sont toujours recalculés par le serveur.
(function () {
  var form = document.querySelector('form.buy[data-prices]');
  if (!form) return;
  var prices;
  try {
    prices = JSON.parse(form.getAttribute('data-prices')) || [];
  } catch (e) {
    return;
  }
  var currency = form.getAttribute('data-currency') || 'EUR';
  var pct = Number(form.getAttribute('data-promo-pct')) || 0;
  var fmt;
  try {
    fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency });
  } catch (e) {
    fmt = { format: function (n) { return n.toFixed(2) + ' ' + currency; } };
  }
  var $ = function (id) { return document.getElementById(id); };
  var promoInput = $('promo');

  function checked(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function totals() {
    var q = Number(checked('quantity')) || 1;
    var sub = prices[q - 1] || prices[0] || 0;
    var code = promoInput ? promoInput.value.trim() : '';
    var off = pct && /^BIENVENUE-/i.test(code) ? Math.round(sub * pct) / 100 : 0;
    return { q: q, sub: sub, off: off, total: sub - off };
  }
  function render() {
    var t = totals();
    $('sum-sub').textContent = fmt.format(t.sub);
    $('sum-promo-row').hidden = !t.off;
    $('sum-promo').textContent = '−' + fmt.format(t.off);
    $('sum-total').textContent = fmt.format(t.total);
  }
  form.addEventListener('change', render);
  if (promoInput) promoInput.addEventListener('input', render);
  render();

  var rv = $('rv');
  if (!rv) return;
  var lastFocus = null;
  function text(tag, s) {
    var el = document.createElement(tag);
    el.textContent = s;
    return el;
  }
  function row(label, value) {
    var d = document.createElement('div');
    d.className = 'rv-row';
    d.appendChild(text('span', label));
    d.appendChild(text('b', value));
    return d;
  }
  function openReview() {
    var t = totals();
    var variant = [checked('color'), checked('size')].filter(Boolean).join(' / ');
    var p = $('rv-product');
    p.replaceChildren(text('b', form.getAttribute('data-name') || ''));
    if (variant) p.appendChild(text('span', variant));
    p.appendChild(row('Quantité', String(t.q)));
    if (t.off) p.appendChild(row('Code de bienvenue', '−' + fmt.format(t.off)));
    p.appendChild(row('Livraison', 'Offerte'));
    p.appendChild(row('Total', fmt.format(t.total)));
    var f = form.elements;
    $('rv-address').replaceChildren(
      text('span', 'Livraison à'),
      text('b', f.name.value),
      text('span', f.address.value),
      text('span', [f.zip.value, f.city.value, f.country.value].filter(Boolean).join(' ')),
      text('span', [f.email.value, f.phone.value].filter(Boolean).join(' · ')),
    );
    $('rv-wait').hidden = true;
    $('rv-pay').disabled = false;
    lastFocus = document.activeElement;
    rv.hidden = false;
    $('rv-pay').focus({ preventScroll: true });
    document.addEventListener('keydown', onKey);
  }
  function closeReview() {
    rv.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape' && $('rv-wait').hidden) closeReview();
  }
  rv.querySelectorAll('[data-rv-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      if ($('rv-wait').hidden) closeReview();
    });
  });
  form.addEventListener('submit', function (e) {
    if (form.getAttribute('data-confirmed') === '1') return;
    e.preventDefault();
    openReview();
  });
  $('rv-pay').addEventListener('click', function () {
    $('rv-pay').disabled = true;
    $('rv-wait').hidden = false;
    form.setAttribute('data-confirmed', '1');
    // requestSubmit garde la validation native ; submit() en repli (anciens navigateurs).
    if (form.requestSubmit) form.requestSubmit();
    else form.submit();
  });
  // Retour arrière depuis la page de paiement (cache navigateur) : on réinitialise.
  window.addEventListener('pageshow', function () {
    form.removeAttribute('data-confirmed');
    rv.hidden = true;
  });
})();
