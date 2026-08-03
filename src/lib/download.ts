/** Trigger a browser download of in-memory content, without touching the page DOM state. */

export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(data: unknown, filename: string): void {
  downloadText(JSON.stringify(data, null, 2), filename, 'application/json');
}

/**
 * Turn a workout name into a safe file name stem — accents flattened, anything
 * that is not a letter, digit, or dash collapsed to a single dash.
 */
export function fileStem(name: string, fallback = 'workout'): string {
  const stem = name
    .normalize('NFKD')
    // strip the combining marks NFKD split off, so "Café" becomes "Cafe"
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return stem || fallback;
}
