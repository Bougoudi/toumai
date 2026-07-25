/** Helpers d'affichage terminal (couleurs ANSI, tableaux) — sans dépendance. */

const useColor = process.stdout.isTTY && process.env.NO_COLOR == null;

function wrap(code: string, s: string): string {
  return useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  bold: (s: string) => wrap('1', s),
  dim: (s: string) => wrap('2', s),
  red: (s: string) => wrap('31', s),
  green: (s: string) => wrap('32', s),
  yellow: (s: string) => wrap('33', s),
  blue: (s: string) => wrap('34', s),
  magenta: (s: string) => wrap('35', s),
  cyan: (s: string) => wrap('36', s),
  gray: (s: string) => wrap('90', s),
};

/** Colore un statut selon sa nature. */
export function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (['SHIPPED', 'DELIVERED', 'COMPLETED', 'ACTIVE', 'PAID', 'IMPORTED'].includes(s)) return c.green(s);
  if (['FULFILLING', 'RUNNING', 'PENDING', 'EVALUATED', 'NEW', 'DRAFT'].includes(s)) return c.yellow(s);
  if (['FAILED', 'CANCELLED', 'REJECTED'].includes(s)) return c.red(s);
  return s;
}

export function clear() {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
}

export function hr(width = 64): string {
  return c.gray('─'.repeat(width));
}

export function money(value: number, currency = 'EUR'): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Rend un tableau texte aligné. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(stripLen(h), ...rows.map((r) => stripLen(r[i] ?? ''))),
  );
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stripLen(s)));
  const head = headers.map((h, i) => c.bold(pad(h, widths[i]))).join('  ');
  const sep = widths.map((w) => c.gray('─'.repeat(w))).join('  ');
  const body = rows.map((r) => r.map((cell, i) => pad(cell ?? '', widths[i])).join('  ')).join('\n');
  return `${head}\n${sep}\n${body || c.dim('(vide)')}`;
}

/** Longueur visible (hors codes ANSI). */
function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export const banner = `
${c.cyan('╔══════════════════════════════════════════════════════════╗')}
${c.cyan('║')}   ${c.bold('TOUMAI')} — ${c.dim('Logiciel d’automatisation e-commerce')}         ${c.cyan('║')}
${c.cyan('║')}   ${c.gray('Marché · Produits · Fournisseurs · Achat & Envoi')}       ${c.cyan('║')}
${c.cyan('╚══════════════════════════════════════════════════════════╝')}`;
