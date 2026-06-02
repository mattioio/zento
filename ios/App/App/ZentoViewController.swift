import UIKit
import WebKit
import Capacitor

class ZentoViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.navigationDelegate = self
    }
}

extension ZentoViewController: WKNavigationDelegate {
    // Reload the web view if iOS kills the content process (low memory, background, etc.)
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
