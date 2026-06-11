/** Remember the last-used FTP across sessions via chrome.storage.local. */

const FTP_KEY = 'gwi.ftp';

export async function getStoredFtp(): Promise<number | null> {
  try {
    const result = await chrome.storage?.local.get(FTP_KEY);
    const value = result?.[FTP_KEY];
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function setStoredFtp(ftp: number): Promise<void> {
  if (!(ftp > 0)) return;
  try {
    await chrome.storage?.local.set({ [FTP_KEY]: Math.round(ftp) });
  } catch {
    /* storage unavailable — ignore */
  }
}
