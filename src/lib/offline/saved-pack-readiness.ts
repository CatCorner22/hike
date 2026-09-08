import type { NavigateOfflineStatus } from "@/lib/offline/navigate-shell";
import type { RoutePackStatus } from "@/lib/offline/route-pack";

export type SavedPackLaunchState =
  | "checking"
  | "ready"
  | "finish-setup"
  | "update-required";

export function savedPackLaunchState(
  packStatus: RoutePackStatus,
  navigation?: NavigateOfflineStatus | null,
): SavedPackLaunchState {
  if (packStatus !== "ready") return "update-required";
  if (navigation == null) return "checking";
  return navigation.ready ? "ready" : "finish-setup";
}

export function savedPackLaunchCopy(state: SavedPackLaunchState): {
  label: string;
  detail: string;
} {
  if (state === "ready") {
    return {
      label: "Ready offline",
      detail: "The route and the app files needed to open it are saved on this device.",
    };
  }
  if (state === "finish-setup") {
    return {
      label: "Finish setup",
      detail: "The route is saved, but this device has not verified every file needed to start it offline.",
    };
  }
  if (state === "update-required") {
    return {
      label: "Update required",
      detail: "This saved route uses an older or invalid format. Reopen its plan or trail while online and prepare it again.",
    };
  }
  return { label: "Checking…", detail: "Verifying this route and its offline app files." };
}
