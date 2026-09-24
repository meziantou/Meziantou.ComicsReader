import Foundation
import Testing
@testable import ComicsReaderKit

@MainActor
struct InactivityTimerTests {
    private static let shortTimeout = Duration.milliseconds(50)

    @Test
    func startNotifiesActiveOnce() {
        var activeCount = 0
        let timer = InactivityTimer(timeout: Self.shortTimeout, onActive: { activeCount += 1 }, onIdle: {})

        timer.start()
        timer.recordActivity()
        timer.recordActivity()

        #expect(activeCount == 1)
        #expect(timer.isActive)
    }

    @Test
    func idleNotifiedAfterTimeout() async {
        var idleCount = 0
        let timer = InactivityTimer(timeout: Self.shortTimeout, onActive: {}, onIdle: { idleCount += 1 })

        timer.start()
        try? await Task.sleep(for: .milliseconds(150))

        #expect(idleCount == 1)
        #expect(!timer.isActive)
    }

    @Test
    func recordActivityResetsTimeout() async {
        var idleCount = 0
        let timer = InactivityTimer(timeout: Self.shortTimeout, onActive: {}, onIdle: { idleCount += 1 })

        timer.start()
        // Keep resetting the timer before it can expire
        for _ in 0..<3 {
            try? await Task.sleep(for: .milliseconds(30))
            timer.recordActivity()
        }

        #expect(idleCount == 0)
        #expect(timer.isActive)
    }

    @Test
    func stopCancelsPendingTimeoutWithoutNotifyingIdle() async {
        var idleCount = 0
        let timer = InactivityTimer(timeout: Self.shortTimeout, onActive: {}, onIdle: { idleCount += 1 })

        timer.start()
        timer.stop()
        try? await Task.sleep(for: .milliseconds(150))

        #expect(idleCount == 0)
        #expect(!timer.isActive)
    }

    @Test
    func becomingActiveAgainAfterIdleNotifiesActive() async {
        var activeCount = 0
        var idleCount = 0
        let timer = InactivityTimer(timeout: Self.shortTimeout, onActive: { activeCount += 1 }, onIdle: { idleCount += 1 })

        timer.start()
        try? await Task.sleep(for: .milliseconds(150))
        #expect(idleCount == 1)

        timer.recordActivity()

        #expect(activeCount == 2)
    }
}
