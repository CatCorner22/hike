import UIKit
import Capacitor

/**
 * Serves a Next.js static export the way it is laid out on disk.
 *
 * Capacitor's stock `CapacitorRouter` answers EVERY path with an empty file
 * extension using the root document:
 *
 *     if pathUrl.pathExtension.isEmpty { return basePath + "/index.html" }
 *
 * That is right for a single-page bundle and wrong for this one. `next build`
 * with `output: "export"` and `trailingSlash: true` emits a separate document
 * per route — out/navigate/index.html, out/plan/detail/index.html, and so on —
 * and none of those paths carries an extension. Under the stock router the
 * shell can only ever display the home page: fifteen of the sixteen exported
 * documents are unreachable by URL.
 *
 * The failure that matters is not a mistyped link. WKWebView's content process
 * is killed under memory pressure — a rendered map plus a live GPS watch on a
 * long hike is exactly the load that provokes it — and Capacitor's
 * `webViewWebContentProcessDidTerminate` responds with `webView.reload()`. That
 * reload re-requests capacitor://localhost/navigate/?target=… and, with the
 * stock router, is handed the home page. The hiker loses the navigation screen
 * mid-hike, silently, at the moment they are relying on it.
 *
 * So: resolve an extensionless path to that path's own index.html when one
 * exists on disk, and fall back to the root document when it does not (an
 * unknown client-side route, which the app router then handles itself).
 */
struct StaticExportRouter: Router {
    public var basePath: String = ""

    public func route(for path: String) -> String {
        let rootDocument = basePath + "/index.html"
        let requested = URL(fileURLWithPath: path)

        // A path that already names a file keeps Capacitor's behaviour.
        guard requested.pathExtension.isEmpty else { return basePath + path }

        // Never let a request walk out of the bundle. The check is on the raw
        // path because that is what gets concatenated below.
        guard !path.contains("..") else { return rootDocument }

        var directory = path
        while directory.hasSuffix("/") { directory.removeLast() }
        guard !directory.isEmpty else { return rootDocument }

        let candidate = basePath + directory + "/index.html"
        return FileManager.default.fileExists(atPath: candidate) ? candidate : rootDocument
    }
}

/**
 * App-local plugins register here: Capacitor discovers packaged plugins on its
 * own, but a plugin that lives in the app target must be handed to the bridge.
 */
class MainViewController: CAPBridgeViewController {
    override open func router() -> Router {
        return StaticExportRouter()
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeadingPlugin())
    }
}
