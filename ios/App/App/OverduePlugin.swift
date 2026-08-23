import Foundation
import Capacitor
import UIKit
import UserNotifications

/**
 * The return-time alarm, scheduled so that a Focus mode does not swallow it.
 *
 * `@capacitor/local-notifications` schedules `{id, title, body, schedule}` and
 * nothing else — it has no way to set an interruption level, so every alarm it
 * raises ships at `.active`, the default. iOS withholds `.active` notifications
 * during any Focus mode and can roll them into a Scheduled Summary, which means
 * the one alarm this app exists to raise — "you are past the time you said you
 * would be back" — is exactly the alarm that a phone in Sleep Focus, at the end
 * of a long day, quietly holds until morning.
 *
 * `.timeSensitive` is the level Apple defines for notifications that "demand
 * immediate attention"; it breaks through Focus and Do Not Disturb. It requires
 * the `com.apple.developer.usernotifications.time-sensitive` entitlement, which
 * this target declares in App.entitlements. Setting the level without the
 * entitlement is harmless — the notification simply delivers at the default
 * level — so a build signed by a team that cannot grant it still works, just
 * without the break-through.
 *
 * The trigger is built from UTC components rather than an elapsed interval so
 * that a return time survives crossing a timezone, which is an ordinary thing
 * to do on the drive to a trailhead.
 */
@objc(OverduePlugin)
public class OverduePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OverduePlugin"
    public let jsName = "OverdueAlarm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private func requestIdentifier(_ id: Int) -> String {
        return "klandagi-overdue-\(id)"
    }

    /// "granted" | "denied" | "prompt" — the three states the JS seam models.
    private func describe(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return "granted"
        case .denied:
            return "denied"
        case .notDetermined:
            return "prompt"
        @unknown default:
            return "prompt"
        }
    }

    @objc func permission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["status": self.describe(settings)])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            // Asking again after a denial does nothing except return false, and
            // the caller needs to know the difference between "they said no" and
            // "they have not been asked", so report the settled state instead.
            guard settings.authorizationStatus == .notDetermined else {
                call.resolve(["status": self.describe(settings)])
                return
            }
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                call.resolve(["status": granted ? "granted" : "denied"])
            }
        }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        guard let id = call.getInt("id"),
              let atMs = call.getDouble("at") else {
            call.reject("id and at are required")
            return
        }
        let title = call.getString("title") ?? "Return time reached"
        let body = call.getString("body") ?? ""
        let fireDate = Date(timeIntervalSince1970: atMs / 1000.0)
        guard fireDate.timeIntervalSinceNow > 0 else {
            // A trigger in the past either fires instantly or is dropped,
            // depending on iOS version. Neither is an alarm, so say so.
            call.resolve(["scheduled": false, "reason": "past"])
            return
        }

        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            let status = self.describe(settings)
            guard status == "granted" else {
                call.resolve(["scheduled": false, "reason": status])
                return
            }

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            if #available(iOS 15.0, *) {
                content.interruptionLevel = .timeSensitive
                content.relevanceScore = 1.0
            }

            var components = Calendar(identifier: .gregorian)
                .dateComponents(in: TimeZone(identifier: "UTC") ?? TimeZone.current, from: fireDate)
            components.nanosecond = nil
            components.weekday = nil
            components.weekdayOrdinal = nil
            components.quarter = nil
            components.weekOfMonth = nil
            components.weekOfYear = nil
            components.yearForWeekOfYear = nil
            components.dayOfYear = nil

            let request = UNNotificationRequest(
                identifier: self.requestIdentifier(id),
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            )
            // Replacing an identifier is a replace, not an add, but removing
            // first keeps the behaviour identical across iOS versions.
            center.removePendingNotificationRequests(withIdentifiers: [self.requestIdentifier(id)])
            center.add(request) { error in
                call.resolve(["scheduled": error == nil, "reason": error == nil ? "" : "add-failed"])
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let identifiers = [requestIdentifier(call.getInt("id") ?? 0)]
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: identifiers)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
        call.resolve()
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("Settings URL unavailable")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() } else { call.reject("Settings could not be opened") }
            }
        }
    }
}
