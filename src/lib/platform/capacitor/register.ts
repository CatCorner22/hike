/**
 * The Capacitor implementations of the platform seams.
 *
 * This module is loaded ONLY by the native bootstrap, via dynamic import, and
 * only when `isNative()` is true — the web bundle downloads it as an unused
 * async chunk at worst, and vitest never imports it (the adapters are faked
 * through `setPlatformAdapters` instead). Every implementation degrades to a
 * truthful failure value rather than throwing into a caller.
 */
import { registerPlugin } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { Device } from "@capacitor/device";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { LocalNotifications } from "@capacitor/local-notifications";
import { KeepAwake } from "@capacitor-community/keep-awake";

/**
 * Metres of movement between GNSS fixes. See the comment at the watcher below:
 * zero means kCLDistanceFilterNone, which never lets the radio sleep.
 */
const NAVIGATION_DISTANCE_FILTER_M = 10;
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location,
} from "@capacitor-community/background-geolocation";
import type {
  BatteryAdapter,
  GeolocationAdapter,
  HapticsAdapter,
  NetworkAdapter,
  NotificationsAdapter,
  PlatformAdapters,
  SaveFileAdapter,
  WakeLockAdapter,
} from "@/lib/platform/adapters";

const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

interface HeadingEventData {
  magneticHeading: number;
  trueHeading: number;
  accuracyDeg: number;
  atMs: number;
}

interface HeadingNativePlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "heading",
    listener: (sample: HeadingEventData) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/** App-local Swift plugin (ios/App/App/HeadingPlugin.swift). */
const Heading = registerPlugin<HeadingNativePlugin>("Heading");

/**
 * Capacitor's Network API is async; the seam's isOnline() is sync because the
 * web call sites read navigator.onLine inline. Cache the last status and keep
 * it fresh with the change listener. Until the first read resolves, report
 * online — the same optimistic default navigator.onLine effectively has, and
 * the safer direction for gates that would otherwise refuse to warm caches.
 */
function buildNetworkAdapter(): NetworkAdapter {
  let lastKnownOnline = true;
  const subscribers = new Set<(online: boolean) => void>();
  void Network.getStatus()
    .then((status) => {
      lastKnownOnline = status.connected;
    })
    .catch(() => undefined);
  void Network.addListener("networkStatusChange", (status) => {
    lastKnownOnline = status.connected;
    for (const subscriber of [...subscribers]) subscriber(status.connected);
  });
  return {
    isOnline: () => lastKnownOnline,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },
  };
}

function buildBatteryAdapter(): BatteryAdapter {
  return {
    async read() {
      try {
        const info = await Device.getBatteryInfo();
        if (
          typeof info.batteryLevel !== "number" ||
          !Number.isFinite(info.batteryLevel) ||
          info.batteryLevel < 0 ||
          info.batteryLevel > 1
        ) {
          return null;
        }
        return { level: info.batteryLevel, charging: info.isCharging === true };
      } catch {
        return null;
      }
    },
  };
}

/**
 * iOS has no vibration-duration API — impacts are discrete taps. The adapter
 * walks the same [buzz, pause, …] arrays the web path uses, firing a heavy
 * impact at each buzz start and repeating every 150 ms for the buzz duration,
 * so Morse timing (dot vs dash) survives even though amplitude is approximate.
 */
function buildHapticsAdapter(): HapticsAdapter {
  return {
    vibrate(pattern) {
      let atMs = 0;
      for (let index = 0; index < pattern.length; index += 1) {
        const segmentMs = pattern[index];
        const isBuzz = index % 2 === 0;
        if (isBuzz && segmentMs > 0) {
          for (let tick = 0; tick < segmentMs; tick += 150) {
            const fireAt = atMs + tick;
            setTimeout(() => {
              void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => undefined);
            }, fireAt);
          }
        }
        atMs += segmentMs;
      }
      return true;
    },
  };
}

function buildSaveFileAdapter(): SaveFileAdapter {
  return {
    async saveText(filename, text) {
      let fileUri: string;
      try {
        const written = await Filesystem.writeFile({
          path: filename,
          data: text,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        fileUri = written.uri;
      } catch {
        return false;
      }
      try {
        await Share.share({ url: fileUri });
        return true;
      } catch (error) {
        // A dismissed share sheet is the person choosing not to send the file
        // they were shown — the feature worked. Anything else is a failure.
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        return message.includes("cancel");
      }
    },
  };
}

function buildNotificationsAdapter(): NotificationsAdapter {
  return {
    async scheduleAt(id, atMs, title, body) {
      try {
        const permission = await LocalNotifications.requestPermissions();
        if (permission.display !== "granted") return false;
        // Cancel-then-schedule keeps the id idempotent even if the platform
        // treats duplicate ids differently across versions.
        await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
        await LocalNotifications.schedule({
          notifications: [{ id, title, body, schedule: { at: new Date(atMs) } }],
        });
        return true;
      } catch {
        return false;
      }
    },
    async cancel(id) {
      await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
    },
  };
}

function buildWakeLockAdapter(): WakeLockAdapter {
  return {
    async acquire() {
      try {
        await KeepAwake.keepAwake();
        return true;
      } catch {
        return false;
      }
    },
    async release() {
      await KeepAwake.allowSleep().catch(() => undefined);
    },
  };
}

function positionFromLocation(location: Location): GeolocationPosition {
  return {
    coords: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      altitude: location.altitude,
      altitudeAccuracy: location.altitudeAccuracy,
      heading: location.bearing,
      speed: location.speed,
      toJSON() {
        return this;
      },
    },
    // A null time is not "now": inventing a fresh timestamp would defeat the
    // stale-fix trust logic downstream. Epoch 0 reads as maximally stale.
    timestamp: location.time ?? 0,
    toJSON() {
      return this;
    },
  } as GeolocationPosition;
}

function errorFromCallback(error: CallbackError): GeolocationPositionError {
  const denied = error.code === "NOT_AUTHORIZED";
  return {
    code: denied ? 1 : 2,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: error.message ?? "Location unavailable",
  } as GeolocationPositionError;
}

/**
 * Background watchers keep CLLocationManager delivering fixes with the screen
 * locked — the reason track recording can survive a pocket. The foreground
 * variant is the same watcher without the background message, which iOS treats
 * as foreground-only.
 */
function buildGeolocationAdapter(): GeolocationAdapter {
  return {
    watch(onFix, onError, options) {
      let removed = false;
      let watcherId: string | null = null;
      // distanceFilter 0 is kCLDistanceFilterNone: the GNSS runs flat out with no
      // duty cycling, which is the single most expensive thing an app can ask an
      // iPhone to do — in an app whose own advice at field-ops.ts is "dim the
      // screen to save battery". Ten metres is roughly a fix every ten seconds at
      // walking pace, which is denser than either off-route alerting or a
      // breadcrumb needs, and it lets the radio sleep between fixes.
      void BackgroundGeolocation.addWatcher(
        options.background
          ? {
              backgroundMessage: "Keeping your position and breadcrumb while the screen is off.",
              backgroundTitle: "Klandagi is navigating",
              requestPermissions: true,
              distanceFilter: NAVIGATION_DISTANCE_FILTER_M,
            }
          : { requestPermissions: true, distanceFilter: NAVIGATION_DISTANCE_FILTER_M },
        (position, error) => {
          if (removed) return;
          if (error) {
            onError(errorFromCallback(error));
            return;
          }
          if (position) onFix(positionFromLocation(position));
        },
      )
        .then((id) => {
          watcherId = id;
          // Stopped before the id resolved: remove immediately.
          if (removed) void BackgroundGeolocation.removeWatcher({ id }).catch(() => undefined);
        })
        .catch((error: unknown) => {
          if (!removed) {
            onError(
              errorFromCallback(
                error instanceof Error ? (error as CallbackError) : new Error("watcher failed"),
              ),
            );
          }
        });
      return {
        stop() {
          removed = true;
          if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => undefined);
        },
      };
    },
  };
}

/**
 * CLHeading values pass through raw: trueHeading is negative when the OS could
 * not correct it, and the JS seam (subscribeHeading) is the single place that
 * maps negative to null and normalizes — one contract for every consumer.
 */
function buildHeadingAdapter(): NonNullable<PlatformAdapters["heading"]> {
  return {
    subscribe(onSample) {
      let removed = false;
      let handle: { remove: () => Promise<void> } | null = null;
      void Heading.addListener("heading", (sample) => {
        if (!removed) onSample(sample);
      }).then((h) => {
        handle = h;
        if (removed) void h.remove().catch(() => undefined);
      });
      void Heading.start().catch(() => undefined);
      return () => {
        removed = true;
        if (handle) void handle.remove().catch(() => undefined);
        void Heading.stop().catch(() => undefined);
      };
    },
  };
}

export function buildCapacitorAdapters(): PlatformAdapters {
  return {
    network: buildNetworkAdapter(),
    battery: buildBatteryAdapter(),
    haptics: buildHapticsAdapter(),
    saveFile: buildSaveFileAdapter(),
    notifications: buildNotificationsAdapter(),
    wakeLock: buildWakeLockAdapter(),
    geolocation: buildGeolocationAdapter(),
    heading: buildHeadingAdapter(),
  };
}
