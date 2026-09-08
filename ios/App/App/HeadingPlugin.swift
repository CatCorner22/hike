import Foundation
import CoreLocation
import UIKit
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
        // CLLocationManager reports heading relative to `headingOrientation`,
        // which defaults to .portrait and is NOT tracked for you. Left unset,
        // every heading is 90 degrees wrong whenever the phone is held sideways
        // — silently, and on the one screen whose whole job is which way to
        // walk. The web path guards against this by refusing samples unless the
        // screen orientation is exactly 0; the native path has to correct
        // instead, because it has the real device orientation available.
        syncHeadingOrientation()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(deviceOrientationChanged),
            name: UIDevice.orientationDidChangeNotification,
            object: nil
        )
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        UIDevice.current.endGeneratingDeviceOrientationNotifications()
    }

    @objc private func deviceOrientationChanged() {
        syncHeadingOrientation()
    }

    /**
     * Face-up, face-down and unknown are deliberately not mapped: they say
     * nothing about which way the screen is pointing, so the last real
     * orientation is the better answer than a guess.
     */
    private func syncHeadingOrientation() {
        let orientation: CLDeviceOrientation
        switch UIDevice.current.orientation {
        case .portrait: orientation = .portrait
        case .portraitUpsideDown: orientation = .portraitUpsideDown
        case .landscapeLeft: orientation = .landscapeLeft
        case .landscapeRight: orientation = .landscapeRight
        default: return
        }
        DispatchQueue.main.async {
            self.manager.headingOrientation = orientation
        }
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
