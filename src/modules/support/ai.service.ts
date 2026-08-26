import { HttpError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { getAiCreds } from '../settings/settings.service.js';

/**
 * Petit client IA multi-fournisseurs (Gemini par défaut, OpenAI, Anthropic).
 * Utilisé par l'agent « service client » pour rédiger des réponses aux clients.
 * La clé API est fournie par l'utilisateur (stockée chiffrée dans les réglages).
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-3.6-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
};

export const aiService = {
  /** État de configuration (pour l'UI). */
  async status(): Promise<{ configured: boolean; provider: string }> {
    const creds = await getAiCreds();
    return { configured: Boolean(creds.apiKey), provider: creds.provider };
  },

  /** Envoie une conversation au modèle et renvoie la réponse texte. */
  async chat(system: string, messages: ChatMessage[]): Promise<string> {
    const creds = await getAiCreds();
    if (!creds.apiKey) throw new HttpError(400, 'Assistant IA non configuré : ajoute ta clé dans les Réglages.');
    const model = creds.model || DEFAULT_MODEL[creds.provider] || DEFAULT_MODEL.gemini;
    try {
      if (creds.provider === 'openai') return await this.openai(creds.apiKey, model, system, messages);
      if (creds.provider === 'anthropic') return await this.anthropic(creds.apiKey, model, system, messages);
      return await this.gemini(creds.apiKey, model, system, messages);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      logger.error('Appel IA échoué', { provider: creds.provider, err: String(e).slice(0, 160) });
      throw new HttpError(502, 'L’assistant IA est momentanément indisponible.');
    }
  },

  async gemini(apiKey: string, model: string, system: string, messages: ChatMessage[], retry = true): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: 900 },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg = String(data?.error?.message || res.status);
      // Modèle retiré : Google indique le remplaçant (« use models/<nom> ») → on réessaie.
      const suggested = msg.match(/models\/([\w.-]+)\s+for the latest/)?.[1];
      if (retry && suggested && suggested !== model) {
        logger.info('Gemini : modèle retiré, bascule sur le remplaçant', { from: model, to: suggested });
        return this.gemini(apiKey, suggested, system, messages, false);
      }
      throw new HttpError(502, `Gemini: ${msg}`);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    if (!text) throw new HttpError(502, 'Réponse IA vide.');
    return text.trim();
  },

  async openai(apiKey: string, model: string, system: string, messages: ChatMessage[]): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 900,
        messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new HttpError(502, `OpenAI: ${data?.error?.message || res.status}`);
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) throw new HttpError(502, 'Réponse IA vide.');
    return String(text).trim();
  },

  async anthropic(apiKey: string, model: string, system: string, messages: ChatMessage[]): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new HttpError(502, `Anthropic: ${data?.error?.message || res.status}`);
    const text = Array.isArray(data?.content) ? data.content.map((c: any) => c.text).join('') : '';
    if (!text) throw new HttpError(502, 'Réponse IA vide.');
    return String(text).trim();
  },
};
