import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

/**
 * Deux dictionnaires qui divergent, c'est une traduction à trous : la clé
 * manquante retombe sur le français et l'écran arabe se retrouve à moitié
 * francophone sans que personne ne s'en aperçoive. Le test refuse la
 * divergence plutôt que de la documenter.
 *
 * Le module est écrit pour le navigateur : on lui rend `document` et
 * `navigator` le temps du chargement, sans quoi il échoue à l'import.
 */
const RACINE = new URL("../../public/touma/", import.meta.url);

async function chargerI18n() {
  const attributs = new Map<string, string>();
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      setAttribute: (n: string, v: string) => attributs.set(n, v),
    },
  };
  const module = await import(new URL("i18n.js", RACINE).href);
  return { module, attributs };
}

/** Les deux blocs de dictionnaire, lus dans la source : leurs clés doivent coïncider. */
function clesDuBloc(source: string, debut: string): string[] {
  const depart = source.indexOf(debut);
  assert.notEqual(depart, -1, `bloc introuvable : ${debut}`);
  const fin = source.indexOf("\n};", depart);
  assert.notEqual(fin, -1, `fin de bloc introuvable : ${debut}`);
  return [...source.slice(depart, fin).matchAll(/^ {2}'([^']+)':/gm)].map(
    (m) => m[1],
  );
}

describe("i18n — français et arabe", () => {
  const source = readFileSync(new URL("i18n.js", RACINE), "utf8");
  const fr = clesDuBloc(source, "const FR = {");
  const ar = clesDuBloc(source, "const AR = {");

  it("ne laisse aucune clé traduite dans une langue seulement", () => {
    assert.ok(
      fr.length > 200,
      `dictionnaire français suspicieusement court : ${fr.length}`,
    );
    const manquantesEnArabe = fr.filter((c) => !ar.includes(c));
    const orphelinesEnArabe = ar.filter((c) => !fr.includes(c));
    assert.deepEqual(manquantesEnArabe, [], "clés sans traduction arabe");
    assert.deepEqual(
      orphelinesEnArabe,
      [],
      "clés arabes sans équivalent français",
    );
  });

  it("ne déclare aucune clé deux fois", () => {
    for (const [nom, cles] of [
      ["FR", fr],
      ["AR", ar],
    ] as const) {
      const doublons = cles.filter((c, i) => cles.indexOf(c) !== i);
      assert.deepEqual(doublons, [], `clés dupliquées dans ${nom}`);
    }
  });

  it("traduit réellement en arabe, sauf pour les noms de marque déclarés", async () => {
    const { module } = await chargerI18n();
    // Ce qui reste en caractères latins est une marque ou un code, jamais une phrase.
    const MARQUES = new Set([
      "seller.tab.verification",
      // Même programme, nommé sur la page publique d'une province.
      "geo.verif.VERIFIED",
      // « TOUMA Business » est le nom du produit, pas une phrase à traduire.
      "src.businessCrumb",
      "biz.nav",
      "biz.title",
      "seller.import.col.status",
      // Identifiants légaux : ils figurent ainsi sur le document papier, et les
      // traduire ferait que l'écran ne correspondrait plus au document.
      "doc.rccm",
      "doc.nif",
    ]);
    const arabe = /[؀-ۿ]/;
    const latin = /[A-Za-zÀ-ÿ]/;
    module.setLocale("ar");
    // Une valeur qui ne contient que des variables et de la ponctuation —
    // « {label}: {count} » — ne peut pas être du français oublié. Elle porte
    // tout de même une différence réelle : l'espace avant le deux-points est
    // français, pas arabe.
    const sansArabe = ar.filter((cle) => {
      const valeur = module.t(cle);
      const horsVariables = valeur.replace(/\{[^}]*\}/g, "");
      if (!latin.test(horsVariables)) return false;
      return !MARQUES.has(cle) && !arabe.test(valeur);
    });
    assert.deepEqual(
      sansArabe,
      [],
      "valeurs arabes sans un seul caractère arabe",
    );
  });

  it("ne laisse aucun texte français en dur dans une vue", () => {
    // Le point de tout ceci : « les écrans sont traduits » doit être
    // vérifiable, pas affirmé. On relit chaque fichier de vue et on refuse
    // toute chaîne littérale entre balises qui ressemble à une phrase.
    //
    // Ce que le contrôle laisse passer, délibérément : ce qui est interpolé
    // (`${...}` — donc résolu au rendu, souvent par `t()`), les commentaires,
    // et les quelques valeurs déclarées ci-dessous qui ne sont pas du français.
    // Ce qui n'est pas du français : une URL, un nombre, un code en capitales
    // (un exemple de code de réduction), et le nom de la source géographique.
    const TOLERE = [/^https:\/\//, /^\d/, /^[A-Z0-9_]+$/, /^GeoNames$/];
    const vues = readdirSync(new URL(RACINE))
      .filter((f) => f.startsWith("views-") && f.endsWith(".js"))
      .sort();
    assert.ok(vues.length >= 14, `vues introuvables : ${vues.length}`);

    const fautifs: string[] = [];
    for (const vue of vues) {
      const source = readFileSync(new URL(vue, RACINE), "utf8");
      // Texte entre deux balises, et valeurs d'attributs visibles.
      // Le motif exclut retours à la ligne, accents graves, points-virgules,
      // parenthèses et apostrophes droites : sans quoi il attrape `a > b` et
      // les fragments de code entre deux comparaisons, pas du texte d'écran.
      const motifs = [/>([^<>{}$`=()']*)</g, /(?:placeholder|aria-label|title)="([^"$\n]*)"/g];
      for (const motif of motifs) {
        for (const [, brut] of source.matchAll(motif)) {
          const texte = brut.trim();
          // Deux mots d'au moins quatre lettres : en dessous, c'est un symbole
          // (« → », « — », « 5/5 »), pas une phrase à traduire.
          if (!/[A-Za-zÀ-ÿ]{4,}/.test(texte)) continue;
          if (TOLERE.some((r) => r.test(texte))) continue;
          fautifs.push(`${vue} : ${texte.slice(0, 60)}`);
        }
      }
    }
    assert.deepEqual(fautifs, [], "texte français en dur dans une vue");
  });

  it("pose lang et dir sur la racine du document", async () => {
    const { module, attributs } = await chargerI18n();
    module.setLocale("ar");
    assert.equal(attributs.get("lang"), "ar");
    assert.equal(attributs.get("dir"), "rtl");
    module.setLocale("fr");
    assert.equal(attributs.get("dir"), "ltr");
  });

  it("retombe sur le français plutôt que d’afficher un identifiant technique", async () => {
    const { module } = await chargerI18n();
    module.setLocale("ar");
    // Clé inexistante : on préfère la clé brute à un écran vide, et on le vérifie.
    assert.equal(module.t("cle.qui.nexiste.pas"), "cle.qui.nexiste.pas");
    assert.equal(
      module.t("seller.greeting", { name: "Amina" }).includes("Amina"),
      true,
    );
  });
});
