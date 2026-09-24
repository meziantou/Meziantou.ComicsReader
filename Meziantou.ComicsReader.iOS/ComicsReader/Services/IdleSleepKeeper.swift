import ComicsReaderKit
import UIKit

/// Keeps the screen awake while the app is active, allowing it to sleep again after a period without user interaction
@MainActor
final class IdleSleepKeeper {
    private var timeoutMinutes = 0
    private var isSceneActive = false
    private var timer: InactivityTimer?

    /// Sets the duration of inactivity after which the screen is allowed to sleep. `0` disables the feature entirely.
    func configure(timeoutMinutes: Int) {
        guard timeoutMinutes != self.timeoutMinutes else {
            return
        }

        self.timeoutMinutes = timeoutMinutes
        rebuildTimer()
    }

    func sceneDidBecomeActive() {
        isSceneActive = true
        timer?.start()
    }

    func sceneDidResignActive() {
        isSceneActive = false
        timer?.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func recordActivity() {
        guard isSceneActive else {
            return
        }

        timer?.recordActivity()
    }

    private func rebuildTimer() {
        timer?.stop()
        UIApplication.shared.isIdleTimerDisabled = false

        guard timeoutMinutes > 0 else {
            timer = nil
            return
        }

        let timer = InactivityTimer(
            timeout: .seconds(timeoutMinutes * 60),
            onActive: { UIApplication.shared.isIdleTimerDisabled = true },
            onIdle: { UIApplication.shared.isIdleTimerDisabled = false })
        self.timer = timer

        if isSceneActive {
            timer.start()
        }
    }
}
