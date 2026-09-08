import { getPlatformAdapters } from "@/lib/platform/adapters";
import { downloadTextFile } from "@/lib/safety/field";

/**
 * Saving a text file (GPX exports, the safety dossier, paper backups), through the
 * platform seam.
 *
 * Web fallback is the existing anchor-download flow. Inside WKWebView that flow is a
 * dead end — `<a download>` does nothing there — so the Capacitor shell registers a
 * SaveFileAdapter (Filesystem write + Share sheet), which is also how iOS users expect
 * to receive a file.
 *
 * Returns whether a save path actually ran, and every caller must branch on it. A
 * phone full of offline map packs is exactly where `Filesystem.writeFile` fails, and
 * that is exactly when a hiker is told "Backup downloaded." about a file that does not
 * exist. The share sheet is the visible outcome of a SUCCESS; a failure has no visible
 * outcome at all unless the caller supplies one.
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
  try {
    downloadTextFile(filename, text, mime);
    return true;
  } catch {
    return false;
  }
}
