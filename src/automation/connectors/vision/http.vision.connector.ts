import { logger } from '../../../utils/logger.js';
import { stripDataUrl, type VisionConnector, type VisionLabel } from './base.vision.connector.js';

/**
 * Connecteur de vision HTTP (service réel).
 *
 * Contrat attendu par défaut : POST {url} avec l'en-tête
 * `Authorization: Bearer {key}` et un corps JSON `{ "image": "<base64>" }`,
 * renvoyant `{ "labels": [{ "label": "gourde", "confidence": 0.93 }, ...] }`.
 *
 * `mapLabels` accepte aussi des formats voisins (Google Cloud Vision :
 * `labelAnnotations[{ description, score }]` ; tableau simple de chaînes) afin
 * de fonctionner avec la plupart des fournisseurs — adaptez-la si besoin.
 */
export class HttpVisionConnector implements VisionConnector {
  readonly name = 'http-vision';

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  async detectLabels(image: string): Promise<VisionLabel[]> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ image: stripDataUrl(image) }),
    });
    if (!res.ok) {
      logger.error('HttpVisionConnector: réponse non OK', { status: res.status });
      throw new Error(`Service de vision : HTTP ${res.status}`);
    }
    const body = await res.json();
    return this.mapLabels(body);
  }

  /** Normalise plusieurs formats de réponse courants vers VisionLabel[]. */
  private mapLabels(body: any): VisionLabel[] {
    const raw: any[] =
      body?.labels ??
      body?.labelAnnotations ?? // Google Cloud Vision
      body?.Labels ?? // AWS Rekognition
      (Array.isArray(body) ? body : []);
    return raw
      .map((x): VisionLabel | null => {
        if (typeof x === 'string') return { label: x, confidence: 1 };
        const label = x.label ?? x.description ?? x.Name ?? x.name;
        if (!label) return null;
        const confidence = Number(x.confidence ?? x.score ?? (x.Confidence != null ? x.Confidence / 100 : 1)) || 0;
        return { label: String(label), confidence };
      })
      .filter((x): x is VisionLabel => !!x)
      .sort((a, b) => b.confidence - a.confidence);
  }
}
