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
    /** 'google' pour Google Cloud Vision, sinon contrat générique. */
    private readonly provider = '',
  ) {}

  async detectLabels(image: string): Promise<VisionLabel[]> {
    const base64 = stripDataUrl(image);
    const isGoogle = this.provider === 'google';

    // Google Cloud Vision : clé en query, corps « annotate », pas d'en-tête Bearer.
    const endpoint = isGoogle
      ? `${this.url || 'https://vision.googleapis.com/v1/images:annotate'}?key=${encodeURIComponent(this.key)}`
      : this.url;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!isGoogle) headers.Authorization = `Bearer ${this.key}`;
    const body = isGoogle
      ? { requests: [{ image: { content: base64 }, features: [{ type: 'LABEL_DETECTION', maxResults: 8 }] }] }
      : { image: base64 };

    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      logger.error('HttpVisionConnector: réponse non OK', { status: res.status });
      throw new Error(`Service de vision : HTTP ${res.status}`);
    }
    return this.mapLabels(await res.json());
  }

  /** Normalise plusieurs formats de réponse courants vers VisionLabel[]. */
  private mapLabels(body: any): VisionLabel[] {
    const g = body?.responses?.[0]; // Google Cloud Vision imbrique sous responses[0]
    const raw: any[] =
      body?.labels ??
      g?.labelAnnotations ??
      body?.labelAnnotations ?? // Google Cloud Vision (à plat)
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
