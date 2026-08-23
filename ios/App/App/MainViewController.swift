import UIKit
import Capacitor

/**
 * App-local plugins register here: Capacitor discovers packaged plugins on its
 * own, but a plugin that lives in the app target must be handed to the bridge.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeadingPlugin())
    }
}
