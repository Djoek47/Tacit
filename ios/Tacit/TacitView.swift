import SwiftUI
import WebKit

/// The page, and the bridge between it and the voice.
///
/// Page → app (window.webkit.messageHandlers.tacit.postMessage):
///   { type: "speak", text }      say this aloud
///   { type: "listen" }           open the microphone for one turn
///   { type: "stop" }             stop talking and listening
///   { type: "conversation", on } hands-free: listen again after every reply
/// App → page:
///   TacitNative.heard(text, final)   what the person is saying, live
///   TacitNative.state(name)          "listening" | "speaking" | "idle" | "denied"
struct TacitView: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "tacit")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Tell the page it has a native voice before any of its scripts run.
        config.userContentController.addUserScript(WKUserScript(
            source: "window.TacitNative = window.TacitNative || {}; window.TacitNative.available = true;",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .always
        context.coordinator.web = web
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var web: WKWebView?
    private let voice = Voice()

    override init() {
        super.init()
        voice.onHeard = { [weak self] text, final in self?.call("heard", Self.js(text), final ? "true" : "false") }
        voice.onState = { [weak self] state in self?.call("state", Self.js(state)) }
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "speak": voice.speak((body["text"] as? String) ?? "")
        case "listen": voice.listen()
        case "stop": voice.stopAll()
        case "conversation": voice.handsFree = (body["on"] as? Bool) ?? false
        default: break
        }
    }

    private func call(_ fn: String, _ args: String...) {
        let js = "window.TacitNative && window.TacitNative.\(fn) && window.TacitNative.\(fn)(\(args.joined(separator: ",")));"
        DispatchQueue.main.async { self.web?.evaluateJavaScript(js) }
    }

    /// A Swift string as a JavaScript string literal, safely.
    private static func js(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }
}
