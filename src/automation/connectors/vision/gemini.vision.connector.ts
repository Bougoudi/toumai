import { logger } from '../../../utils/logger.js';
import { stripDataUrl, type VisionConnector, type VisionLabel } from './base.vision.connector.js';

/**
 * Reconnaissance d'image via Gemini (multimodal). Réutilise la clé IA que
 * l'utilisateur a déjà configurée (service client). Renvoie des mots-clés
 * produit en anglais, prêts pour la recherche AliExpress.
 */
export class GeminiVisionConnector implements VisionConnector {
  readonly name = 'gemini-vision';

  constructor(
    private readonly apiKey: string,
    private model = 'gemini-3.6-flash',
  ) {}

  async detectLabels(image: string, retry = true): Promise<VisionLabel[]> {
    const base64 = stripDataUrl(image);
    const mime = /data:(image\/[a-z0-9.+-]+);/i.exec(image)?.[1] || 'image/jpeg';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const prompt =
      'Identifie le PRODUIT principal sur cette photo pour une recherche e-commerce. ' +
      'Réponds uniquement par 2 à 4 mots-clés de recherche EN ANGLAIS (type de produit + attribut clé), ' +
      'séparés par des virgules, sans phrase ni ponctuation superflue. Exemple : "insulated water bottle, stainless steel".';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 60 },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg = String(data?.error?.message || res.status);
      const suggested = msg.match(/models\/([\w.-]+)\s+for the latest/)?.[1];
      if (retry && suggested && suggested !== this.model) {
        this.model = suggested;
        return this.detectLabels(image, false);
      }
      logger.warn('GeminiVision: réponse non OK', { status: res.status });
      throw new Error(`Reconnaissance d’image (Gemini) : ${msg}`);
    }
    const text: string = (data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '').trim();
    // Gemini a explicitement dit qu'il ne reconnaît rien → aucune étiquette.
    if (/\b(cannot|can't|unable|no product|not a product|ne peux pas|aucun produit)\b/i.test(text)) return [];

    let parts = text
      .split(/[,\n;]/)
      .map((s) => s.trim().replace(/^["'`\-•*\d.)\]]+\s*/, '').replace(/["'`.]+$/, '').toLowerCase())
      .filter((s) => s.length > 1 && s.length <= 40);

    // Repli : réponse en un seul bloc (phrase courte) → on la garde comme mot-clé.
    if (!parts.length && text && text.length <= 60) {
      const cleaned = text.replace(/[.\n]+/g, ' ').trim().toLowerCase();
      if (cleaned.length > 1) parts = [cleaned.split(/\s+/).slice(0, 5).join(' ')];
    }

    return parts.slice(0, 4).map((label, i): VisionLabel => ({ label, confidence: 1 - i * 0.1 }));
  }
}
