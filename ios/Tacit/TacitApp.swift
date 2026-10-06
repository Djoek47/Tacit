import SwiftUI

/// Tacit on iPhone: the same page as the web app, with a native voice.
/// Everything Tacit decides lives in the page; this app gives it ears and a mouth.
@main
struct TacitApp: App {
    var body: some Scene {
        WindowGroup {
            TacitView()
                .ignoresSafeArea(.container, edges: .bottom)
                .background(Color(red: 0.933, green: 0.941, blue: 0.918))
        }
    }
}
