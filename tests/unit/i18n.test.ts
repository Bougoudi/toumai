import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      "seller.import.col.status",
      // Identifiants légaux : ils figurent ainsi sur le document papier, et les
      // traduire ferait que l'écran ne correspondrait plus au document.
      "doc.rccm",
      "doc.nif",
    ]);
    const arabe = /[؀-ۿ]/;
    module.setLocale("ar");
    const sansArabe = ar.filter(
      (cle) => !MARQUES.has(cle) && !arabe.test(module.t(cle)),
    );
    assert.deepEqual(
      sansArabe,
      [],
      "valeurs arabes sans un seul caractère arabe",
    );
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
