import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * L'application ne doit pas annoncer un corridor ouvert quand il ne l'est pas.
 *
 * Elle le faisait à deux endroits. Le bandeau de l'ossature construisait
 * « Corridor ouvert : Cameroun ↔ Tchad » en joignant les noms renvoyés par
 * `/countries` : il annonçait donc l'ouverture dès que deux pays figuraient au
 * référentiel, ce qui ne dit rien de la possibilité d'expédier. La pastille de
 * l'accueil, elle, était écrite en dur — « corridor pilote ouvert » — donc vraie
 * même suspendu. Mesuré sur l'instance de développement au moment de la
 * correction : les deux corridors Tchad ↔ Cameroun étaient `COMING_SOON`, aucun
 * opérationnel, tous deux bloqués par `ONLY_SIMULATED_CARRIER`.
 *
 * La vitrine avait été corrigée du même défaut en V24 (§72) ; l'application ne
 * l'avait pas été. Ce test est ce qui empêche la récidive, et il porte sur deux
 * choses distinctes :
 *
 * 1. **La décision**, vérifiée en appelant `corridors.js` — pur, sans requête.
 * 2. **Le câblage**, vérifié dans la source : une phrase d'ouverture ne doit
 *    jamais être écrite en dur, ni dérivée du référentiel des pays.
 *
 * Le module est écrit pour le navigateur : `i18n.js` a besoin de `document` le
 * temps du chargement.
 */
const RACINE = new URL("../../public/touma/", import.meta.url);

async function chargerCorridors() {
  (globalThis as Record<string, unknown>).document ??= {
    documentElement: { setAttribute: () => {} },
  };
  const i18n = await import(new URL("i18n.js", RACINE).href);
  const module = await import(new URL("corridors.js", RACINE).href);
  return { module, i18n };
}

/** Un corridor tel que `/trade/corridors` le renvoie, réduit à l'essentiel. */
function corridor(
  origine: string,
  destination: string,
  operational: boolean,
  declaredStatus = "ACTIVE",
) {
  return {
    originCountry: origine,
    destinationCountry: destination,
    operational,
    declaredStatus,
  };
}

describe("application — annonce de corridor", () => {
  describe("la décision", () => {
    it("ne dit rien quand l'API n'a pas répondu", async () => {
      const { module } = await chargerCorridors();
      // `null` n'est pas une liste vide : l'un est « je ne sais pas », l'autre
      // « aucun ». Les confondre, c'est l'ancien défaut sous une autre forme.
      assert.equal(module.operationnels(null), null);
      assert.equal(module.operationnels(undefined), null);
      assert.equal(module.phraseBandeau(null), null);
      assert.equal(module.corridorNomme(null), null);
    });

    it("ne dit rien quand aucun corridor n'est ouvert", async () => {
      const { module } = await chargerCorridors();
      assert.equal(module.phraseBandeau([]), null);
      assert.equal(module.corridorNomme([]), null);
    });

    it("ne dit rien d'un corridor déclaré actif mais non opérationnel", async () => {
      const { module } = await chargerCorridors();
      // Le cas réel : l'exploitant a déclaré le corridor, mais seul un
      // adaptateur de simulation le couvre. Le statut déclaré ne doit rien
      // ouvrir à lui seul.
      const declares = [
        corridor("TD", "CM", false, "ACTIVE"),
        corridor("CM", "TD", false, "COMING_SOON"),
      ];
      assert.deepEqual(module.operationnels(declares), []);
      assert.equal(module.phraseBandeau(declares), null);
      assert.equal(module.corridorNomme(declares), null);
    });

    it("annonce le corridor réellement opérationnel, et lui seul", async () => {
      const { module } = await chargerCorridors();
      const melange = [
        corridor("TD", "CM", true),
        corridor("CM", "TD", false, "ACTIVE"),
      ];
      const phrase = module.phraseBandeau(melange);
      assert.match(phrase, /TD → CM/);
      assert.doesNotMatch(
        phrase,
        /CM → TD/,
        "un corridor non opérationnel s'est retrouvé dans le bandeau",
      );
      assert.equal(module.corridorNomme(melange), "TD → CM");
    });

    it("accorde la phrase au nombre de corridors ouverts", async () => {
      const { module } = await chargerCorridors();
      const un = module.phraseBandeau([corridor("TD", "CM", true)]);
      const deux = module.phraseBandeau([
        corridor("TD", "CM", true),
        corridor("CM", "TD", true),
      ]);
      assert.notEqual(un, deux);
      assert.match(deux, /TD → CM/);
      assert.match(deux, /CM → TD/);
    });

    it("désigne les pays par leur code, lisible en arabe comme en français", async () => {
      const { module, i18n } = await chargerCorridors();
      const ouvert = [corridor("TD", "CM", true)];
      i18n.setLocale("ar");
      const arabe = module.phraseBandeau(ouvert);
      i18n.setLocale("fr");
      const francais = module.phraseBandeau(ouvert);

      // Le référentiel ne porte pas de nom arabe fiable (le `nativeName` du
      // Cameroun vaut « Cameroun ») : un code évite d'intercaler un nom
      // français au milieu d'un écran arabe.
      for (const phrase of [arabe, francais]) assert.match(phrase, /TD → CM/);
      assert.notEqual(arabe, francais, "la phrase n'a pas été traduite");
      assert.match(arabe, /[؀-ۿ]/, "la phrase arabe est en français");
    });
  });

  describe("le câblage", () => {
    const sources = readdirSync(RACINE)
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ nom: f, texte: readFileSync(new URL(f, RACINE), "utf8") }));

    it("n'écrit aucune ouverture de corridor en dur dans les libellés", async () => {
      const i18n = readFileSync(new URL("i18n.js", RACINE), "utf8");
      // Les valeurs du dictionnaire, pas les commentaires : un commentaire qui
      // cite l'ancienne phrase pour expliquer la correction est légitime.
      const valeurs = [...i18n.matchAll(/^ {2}'[^']+':\s*(.+)$/gm)].map(
        (m) => m[1],
      );
      for (const valeur of valeurs) {
        const nommePays = /Tchad|Cameroun|تشاد|الكاميرون/.test(valeur);
        const annonceOuvert = /ouvert|مفتوح/.test(valeur);
        assert.ok(
          !(nommePays && annonceOuvert),
          `libellé qui annonce un corridor ouvert entre des pays nommés en dur : ${valeur}`,
        );
      }
    });

    it("ne construit aucune annonce à partir du référentiel des pays", async () => {
      for (const { nom, texte } of sources) {
        if (!/countries/.test(texte)) continue;
        // Le défaut d'origine, dans sa forme exacte : joindre les noms de
        // `/countries` pour en faire une phrase de corridor.
        assert.doesNotMatch(
          texte,
          /countries[\s\S]{0,400}?join\(' ↔ '\)/,
          `${nom} rejoint les pays du référentiel pour en faire un corridor`,
        );
      }
    });

    it("ne prononce une ouverture qu'après avoir lu l'état réel", async () => {
      // Les clés qui affirment qu'un corridor fonctionne. Toute vue qui en
      // écrit une doit avoir lu `corridorsOuverts()` ou reçu sa liste.
      const CLES_OUVERTURE = [
        "sh.corridorOpen",
        "sh.corridorsOpen",
        "home.corridorOpen",
        "home.corridorsOpen",
        "home.ctaTitleCorridor",
        "home.productCountHintCorridor",
      ];
      const porteuses = sources.filter(
        ({ nom, texte }) =>
          nom !== "i18n.js" &&
          CLES_OUVERTURE.some((cle) => texte.includes(`'${cle}'`)),
      );
      assert.ok(
        porteuses.length > 0,
        "aucune vue n'annonce plus de corridor : le test ne garde plus rien",
      );
      for (const { nom, texte } of porteuses) {
        assert.match(
          texte,
          /corridorsOuverts|phraseBandeau|corridorNomme|operationnels/,
          `${nom} annonce un corridor ouvert sans lire l'état réel`,
        );
      }
    });

    it("laisse le bandeau muet plutôt que de supposer une ouverture", async () => {
      const bandeau = readFileSync(new URL("touma.js", RACINE), "utf8");
      const bloc = bandeau.slice(bandeau.indexOf("// Bandeau du corridor."));
      assert.match(bloc.slice(0, 900), /phraseBandeau\(await corridorsOuverts\(\)\)/);
      // Le repli quand la phrase est nulle est la signature de TOUMA, pas une
      // promesse de corridor.
      assert.match(bloc.slice(0, 900), /phrase === null[\s\S]{0,120}sh\.tagline/);
    });
  });
});
