export type InstallPlatform = "ios" | "android" | "desktop";

export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const agent = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(agent) || (agent.includes("macintosh") && maxTouchPoints > 1)) {
    return "ios";
  }
  if (agent.includes("android")) return "android";
  return "desktop";
}

export function manualInstallSteps(platform: InstallPlatform): string {
  if (platform === "ios") return "In Safari, tap Share, then Add to Home Screen.";
  if (platform === "android") return "Open the browser menu, then choose Install app or Add to Home screen.";
  return "Open the browser menu or address-bar install icon, then choose Install app.";
}
