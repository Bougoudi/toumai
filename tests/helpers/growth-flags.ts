/**
 * Active les leviers de croissance fermés par défaut, **avant** que
 * `src/config/env.ts` ne soit chargé.
 *
 * Les drapeaux sont lus une fois, à l'import du module de configuration. Les
 * poser dans un `before()` arrive donc trop tard : le module est déjà chargé et
 * figé. Ce fichier doit être le **premier import** du fichier de test — les
 * modules ES sont évalués dans l'ordre où ils sont importés.
 *
 * Ce n'est pas un contournement du drapeau : c'est la façon d'exercer le code
 * qu'il protège. Le comportement « fermé » a son propre contrôle.
 */
process.env.TOUMA_GROWTH_REFERRALS_ENABLED = 'true';
process.env.TOUMA_GROWTH_FLASH_SALES_ENABLED = 'true';
