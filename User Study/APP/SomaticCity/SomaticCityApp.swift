import SwiftUI

@main
struct SomaticCityApp: App {
    @StateObject private var recorder = StudyRecorder()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(recorder: recorder)
                .preferredColorScheme(.dark)
                .onChange(of: scenePhase) { _, phase in recorder.sceneChanged(String(describing: phase)) }
        }
    }
}
