import Foundation
import CoreLocation
import Capacitor

/**
 * Magnetometer heading for the navigate screen.
 *
 * GPS course only exists while moving; this closes the "which way am I facing
 * while standing still" gap. CLHeading.trueHeading is declination-corrected by
 * the OS and is negative when unknown — the JS seam maps negative to null and
 * falls back to magneticHeading plus the app's own declination model, so this
 * plugin reports raw values and never invents a correction.
 */
@objc(HeadingPlugin)
public class HeadingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "HeadingPlugin"
    public let jsName = "Heading"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let manager = CLLocationManager()

    @objc override public func load() {
        manager.delegate = self
        manager.headingFilter = 2
    }

    @objc func start(_ call: CAPPluginCall) {
        guard CLLocationManager.headingAvailable() else {
            call.reject("Heading is not available on this device")
            return
        }
        DispatchQueue.main.async {
            self.manager.startUpdatingHeading()
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager.stopUpdatingHeading()
        }
        call.resolve()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        notifyListeners("heading", data: [
            "magneticHeading": newHeading.magneticHeading,
            "trueHeading": newHeading.trueHeading,
            "accuracyDeg": newHeading.headingAccuracy,
            "atMs": newHeading.timestamp.timeIntervalSince1970 * 1000.0,
        ])
    }
}
