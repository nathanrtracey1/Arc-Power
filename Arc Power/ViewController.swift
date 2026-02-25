//
//  ViewController.swift
//  Arc Power
//
//  Created by Nathan Tracey on 2/22/26.
//

import Cocoa
import SafariServices
import WebKit

/// Bundle identifier of the Safari Web Extension to open when the user clicks
/// “Open Safari Extensions” from the host app. Loaded from `Secrets.plist` so
/// contributors can keep their own IDs private.
let extensionBundleIdentifier: String = {
    if let url = Bundle.main.url(forResource: "Secrets", withExtension: "plist"),
       let dict = NSDictionary(contentsOf: url),
       let value = dict["ExtensionBundleIdentifier"] as? String,
       !value.isEmpty {
        return value
    }
    // Safe placeholder; must be overridden in a local Secrets.plist.
    return "YOUR_TEAM_ID.ArcPower.Extension"
}()

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        // Liquid glass: vibrancy backdrop so content floats over blur
        let effectView = NSVisualEffectView(frame: view.bounds)
        effectView.autoresizingMask = [.width, .height]
        effectView.material = .hudWindow
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        view.addSubview(effectView, positioned: .below, relativeTo: webView)

        view.wantsLayer = true
        view.layer?.backgroundColor = .clear
        webView.wantsLayer = true
        webView.setValue(false, forKey: "drawsBackground")

        self.webView.navigationDelegate = self
        self.webView.configuration.userContentController.add(self, name: "controller")
        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show(\(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show(\(state.isEnabled), false)")
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.body as? String == "open-preferences" else { return }

        // Open Safari first so it’s running before we quit
        NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Safari.app"))

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                NSApplication.shared.terminate(nil)
            }
        }
    }

}
