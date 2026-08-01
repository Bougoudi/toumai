/**
 * Contrat commun à toute source de reconnaissance d'image (vision par ordinateur).
 *
 * Un connecteur vision reçoit une photo (base64 / data URL) et renvoie des
 * étiquettes décrivant ce qu'elle contient (« gourde », « lampe », « chaussure »…).
 * Ces étiquettes alimentent ensuite la recherche de produits et de fournisseurs.
 *
 * Pour brancher un vrai service (Google Cloud Vision, AWS Rekognition, un modèle
 * auto-hébergé…), fournissez `VISION_API_URL` + `VISION_API_KEY` et adaptez au
 * besoin `HttpVisionConnector.mapLabels`.
 */
export interface VisionLabel {
  label: string;
  /** Confiance 0..1. */
  confidence: number;
}

export interface VisionConnector {
  /** Nom court, sert de trace (`source`) dans les résultats. */
  readonly name: string;
  /**
   * Analyse une image et renvoie des étiquettes triées par confiance décroissante.
   * @param image data URL (`data:image/jpeg;base64,...`) ou base64 brut.
   */
  detectLabels(image: string): Promise<VisionLabel[]>;
}

/** Retire l'éventuel préfixe data-URL pour ne garder que le base64. */
export function stripDataUrl(image: string): string {
  const i = image.indexOf('base64,');
  return i >= 0 ? image.slice(i + 'base64,'.length) : image;
}
