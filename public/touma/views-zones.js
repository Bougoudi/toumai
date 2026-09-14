/**
 * Zones de service : où une boutique accepte de livrer.
 *
 * À ne pas confondre avec les zones d'un **transporteur**, qui disent où il va.
 * Les deux se combinent, et l'écran le dit : un vendeur qui sert tout le Tchad
 * ne fait pas arriver un colis à Faya-Largeau si personne n'y monte.
 *
 * **Sans déclaration, rien n'est restreint**, et l'écran commence par
 * l'annoncer. C'est l'inverse du paiement à la livraison, fermé par défaut :
 * encaisser du liquide est un engagement qu'on prend, refuser de livrer une
 * province est une limitation qu'on choisit. Un vendeur qui n'a rien déclaré
 * n'a rien promis de moins — il doit le lire en toutes lettres avant de
 * toucher à quoi que ce soit.
 *
 * Et une exclusion **porte un motif**, visible de l'acheteur. « Cette boutique
 * ne livre pas chez vous » sans raison est incompréhensible pour qui voulait
 * acheter ; le champ est donc là, à côté de la case.
 */
import { api, esc } from './core.js';
import { tabs } from './views-seller.js';

export async function serviceZones() {
  const mine = await api('/stores/mine');
  if (!mine.items.length) {
    return `<h1 style="font-size:var(--text-xl)">Zones de service</h1>${tabs('/touma/vendeur/zones')}
      <div class="card"><p class="muted">Créez d’abord une boutique.</p></div>`;
  }

  const store = mine.items[0];
  const [zones, provinces] = await Promise.all([
    api(`/stores/${store.id}/zones-service`),
    api('/geo/provinces?country=TD'),
  ]);

  // État courant, province par province. La règle nationale sert de base ;
  // une règle de province l'emporte sur elle.
  const nationale = zones.items.find((z) => !z.province && z.countryCode === 'TD');
  const parProvince = new Map(zones.items.filter((z) => z.province).map((z) => [z.province.id, z]));

  return `<h1 style="font-size:var(--text-xl)">Zones de service</h1>
    ${tabs('/touma/vendeur/zones')}

    ${
      zones.unrestricted
        ? `<div class="alert">
            <div>
              <strong>Vous ne restreignez rien pour l’instant</strong>
              <div class="small">
                Sans déclaration, votre boutique accepte toutes les destinations que les transporteurs
                desservent. Déclarer des zones sert à <strong>exclure</strong> ce que vous ne pouvez pas
                honorer — pas à ouvrir ce qui l’est déjà.
              </div>
            </div>
          </div>`
        : ''
    }

    <form class="card" id="service-zones-form" data-store="${esc(store.id)}">
      <h2 style="font-size:var(--text-base);margin-bottom:var(--space-3)">${esc(store.name)} — Tchad</h2>

      <label class="row" style="gap:var(--space-2);align-items:center;margin-bottom:var(--space-3)">
        <input type="checkbox" id="sz-national" ${!nationale || nationale.served ? 'checked' : ''} />
        <span>Je livre dans tout le Tchad, sauf les provinces décochées ci-dessous</span>
      </label>

      <div class="field" style="max-width:16rem">
        <label for="sz-handling">Préparation avant remise au transporteur (jours)</label>
        <input id="sz-handling" type="number" min="0" max="90" step="1"
               value="${nationale?.handlingDays ?? ''}" placeholder="non annoncé" inputmode="numeric" />
        <p class="xs muted">Laissé vide, aucun délai de préparation n’est annoncé à l’acheteur. Un délai deviné serait une promesse inventée.</p>
      </div>

      <h3 style="font-size:var(--text-base);margin:var(--space-4) 0 var(--space-2)">Provinces</h3>
      <p class="xs muted" style="margin-bottom:var(--space-3)">
        Décochez une province pour refuser d’y livrer. Le motif est <strong>visible de l’acheteur</strong> :
        un refus sans raison est incompréhensible pour qui voulait commander.
      </p>

      <div class="stack">
        ${provinces.items
          .map((p) => {
            const regle = parProvince.get(p.id);
            const servie = !regle || regle.served;
            return `<div class="row" style="gap:var(--space-3);align-items:center;flex-wrap:wrap">
              <label class="row" style="gap:var(--space-2);align-items:center;min-width:14rem">
                <input type="checkbox" class="sz-province" data-province="${esc(p.id)}" ${servie ? 'checked' : ''} />
                <span>${esc(p.name)}${p.nameAr ? ` <span dir="rtl" lang="ar" class="xs muted">${esc(p.nameAr)}</span>` : ''}</span>
              </label>
              <input class="input sz-note" data-note="${esc(p.id)}" style="flex:1;min-width:200px"
                     placeholder="Motif visible de l’acheteur (si décochée)"
                     value="${esc(regle && !regle.served ? (regle.note ?? '') : '')}" />
            </div>`;
          })
          .join('')}
      </div>

      <div class="row" style="gap:var(--space-2);margin-top:var(--space-4)">
        <button class="btn btn-primary" type="submit">Enregistrer</button>
        <button class="btn btn-ghost" type="button" data-clear-zones="${esc(store.id)}">Ne plus rien restreindre</button>
      </div>
    </form>

    <p class="small muted" style="margin-top:var(--space-4)">
      Ces zones disent où <strong>vous</strong> acceptez d’envoyer. Elles ne remplacent pas celles des
      transporteurs : une commande n’est livrable que si un transporteur dessert aussi la destination.
      Un acheteur voit les deux réponses séparément, et sait donc à qui s’adresser.
    </p>`;
}

/** Lit le formulaire et construit la déclaration envoyée au serveur. */
export function collectZones() {
  const national = document.getElementById('sz-national')?.checked ?? true;
  const handling = document.getElementById('sz-handling')?.value.trim();

  const zones = [
    {
      countryCode: 'TD',
      served: national,
      ...(handling ? { handlingDays: Number(handling) } : {}),
    },
  ];

  for (const boite of document.querySelectorAll('.sz-province')) {
    if (boite.checked) continue;
    const id = boite.dataset.province;
    const note = document.querySelector(`.sz-note[data-note="${id}"]`)?.value.trim();
    zones.push({ countryCode: 'TD', provinceId: id, served: false, ...(note ? { note } : {}) });
  }
  return zones;
}
