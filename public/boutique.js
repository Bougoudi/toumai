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
