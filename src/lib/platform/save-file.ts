import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * Saving a text file (GPX exports, the safety dossier, paper backups), through the
 * platform seam.
 *
 * Web fallback is the existing anchor-download flow. Inside WKWebView that flow is a
 * dead end — `<a download>` does nothing there — so the Capacitor shell registers a
 * SaveFileAdapter (Filesystem write + Share sheet), which is also how iOS users expect
 * to receive a file. Returns whether a save path actually ran.
 */
export async function saveTextFile(
  filename: string,
  text: string,
  mime = "text/plain",
): Promise<boolean> {
  const adapter = getPlatformAdapters().saveFile;
  if (adapter) {
    try {
      return await adapter.saveText(filename, text, mime);
    } catch {
      return false;
    }
  }
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
