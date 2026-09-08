import { isNative } from "@/lib/platform/native";
export interface StorageEstimate {
  usage?: number;
  quota?: number;
}

export async function requestPersistentStorage(): Promise<boolean> {
  // App-bound WKWebView storage belongs to the app itself: iOS does not run the
  // 7-day ITP eviction against it, so inside the shell "persistent" is simply
  // true — saying otherwise would nag the hiker about an eviction that cannot
  // happen. On the web this remains the browser's own answer.
  if (isNative()) return true;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isStoragePersistent(): Promise<boolean> {
  if (isNative()) return true;
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}
