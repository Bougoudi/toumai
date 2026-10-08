'use strict';
// Tableau de bord visiteurs (/admin/login, /admin/analytics). Aucune donnée
// sensible côté navigateur : la session est un cookie HttpOnly posé par le serveur.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var form = $('f');
  if (form) {
    if (/[?&]e=1/.test(location.search)) $('err').textContent = 'Code incorrect.';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      $('err').textContent = '';
      var btn = form.querySelector('button');
      btn.disabled = true;
      fetch('/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: 'token=' + encodeURIComponent($('t').value),
      })
        .then(function (r) {
          if (r.ok) return location.replace('/admin/analytics');
          $('err').textContent = r.status === 429 ? 'Trop d’essais. Réessayez dans 15 minutes.' : 'Code incorrect.';
        })
        .catch(function () { $('err').textContent = 'Connexion impossible, réessayez.'; })
        .finally(function () { btn.disabled = false; });
    });
    return;
  }

  if (!$('active')) return;
  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }
  function load() {
    fetch('/admin/analytics/data', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 401) { location.replace('/admin/login'); throw new Error('session'); }
        return r.json();
      })
      .then(function (d) {
        $('active').textContent = d.activeVisitors;
        $('visitors').textContent = d.visitorsToday;
        $('views').textContent = d.pageViewsToday;
        var max = Math.max.apply(null, [1].concat(d.daily.map(function (x) { return x.views; })));
        $('daily').replaceChildren.apply($('daily'), d.daily.slice().reverse().map(function (x) {
          var tr = document.createElement('tr');
          tr.appendChild(cell(new Date(x.day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })));
          tr.appendChild(cell(String(x.visitors), 'n'));
          tr.appendChild(cell(String(x.views), 'n'));
          var td = cell('');
          var bar = document.createElement('div');
          bar.className = 'bar';
          bar.style.width = Math.round((x.views / max) * 100) + '%';
          if (!x.views) bar.style.display = 'none';
          td.appendChild(bar);
          tr.appendChild(td);
          return tr;
        }));
        var rows = d.topPages.length
          ? d.topPages.map(function (x) {
              var tr = document.createElement('tr');
              tr.appendChild(cell(x.page, 'page'));
              tr.appendChild(cell(String(x.views), 'n'));
              return tr;
            })
          : [(function () { var tr = document.createElement('tr'); var td = cell('Aucune visite enregistrée pour l’instant.'); td.colSpan = 2; tr.appendChild(td); return tr; })()];
        $('pages').replaceChildren.apply($('pages'), rows);
        $('updated').textContent = 'Mis à jour à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      })
      .catch(function () {});
  }
  $('refresh').addEventListener('click', load);
  load();
  setInterval(function () { if (!document.hidden) load(); }, 30000);
})();
