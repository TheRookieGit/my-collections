import AppKit
import UniformTypeIdentifiers
import WebKit

/// 我的心愿单 in a window of its own. The page stays loaded after the window closes, so it comes back at once.
@MainActor
final class WebWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
    private static let site = URL(string: "https://therookiegit.github.io/my-collections/")!
    private static let title = "我的心愿单"
    // The page looks at the clipboard each time it comes forward, for a share link. WebKit only allows that right
    // after a click, so the read comes from here instead.
    private static let clipboardBridge = """
    Object.defineProperty(navigator.clipboard, "readText", { value: () => webkit.messageHandlers.clipboardText.postMessage(null) });
    """

    private var window: NSWindow?
    private var web: WKWebView?

    func show() {
        let window = self.window ?? makeWindow()
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func reload() { web?.reloadFromOrigin() }

    private func makeWindow() -> NSWindow {
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "clipboardText")
        config.userContentController.addUserScript(WKUserScript(source: Self.clipboardBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 860), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.load(URLRequest(url: Self.site))
        self.web = web

        let window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = Self.title
        window.contentView = web
        window.contentMinSize = NSSize(width: 420, height: 500)
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("WishlistWindow")
        if !window.setFrameUsingName("WishlistWindow") { window.center() }
        self.window = window
        return window
    }

    func windowWillClose(_ notification: Notification) { NSApp.setActivationPolicy(.accessory) }

    // MARK: Links stay in the window only while they are the site; anything else goes to the browser

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { decisionHandler(.download); return }
        guard let url = action.request.url, action.targetFrame?.isMainFrame == true, url.host != nil, url.host != Self.site.host else {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        webView.loadHTMLString("""
            <meta charset="utf-8"><style>:root{color-scheme:light dark}body{font:15px -apple-system;display:grid;place-items:center;height:90vh;text-align:center}</style>
            <div>打不开我的心愿单，请检查网络。<br><br><a href="\(Self.site.absoluteString)">重试</a></div>
            """, baseURL: nil)
    }

    // MARK: What a browser would have done

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        sheet(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        sheet(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    private func sheet(_ alert: NSAlert, done: @escaping @MainActor (NSApplication.ModalResponse) -> Void) {
        guard let window else { done(alert.runModal()); return }
        alert.beginSheetModal(for: window) { response in MainActor.assumeIsolated { done(response) } }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.begin { response in
            MainActor.assumeIsolated { completionHandler(response == .OK ? panel.urls : nil) }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        replyHandler(NSPasteboard.general.string(forType: .string) ?? "", nil)
    }

    // MARK: The JSON export

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.begin { result in
            MainActor.assumeIsolated {
                guard result == .OK, let url = panel.url else { completionHandler(nil); return }
                try? FileManager.default.removeItem(at: url) // the panel already asked about replacing it
                completionHandler(url)
            }
        }
    }
}
