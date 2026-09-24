import Foundation

/// Tracks user activity and notifies when the user becomes active or goes idle after a period without activity
@MainActor
public final class InactivityTimer {
    private let timeout: Duration
    private let onActive: () -> Void
    private let onIdle: () -> Void
    private var timeoutTask: Task<Void, Never>?

    public private(set) var isActive = false

    public init(timeout: Duration, onActive: @escaping () -> Void, onIdle: @escaping () -> Void) {
        self.timeout = timeout
        self.onActive = onActive
        self.onIdle = onIdle
    }

    /// Starts tracking activity, as if the user had just interacted
    public func start() {
        recordActivity()
    }

    /// Stops tracking activity and cancels the pending timeout without notifying `onIdle`
    public func stop() {
        timeoutTask?.cancel()
        timeoutTask = nil
        isActive = false
    }

    /// Records a user interaction, notifying `onActive` if the user was idle, and resets the idle timeout
    public func recordActivity() {
        if !isActive {
            isActive = true
            onActive()
        }

        timeoutTask?.cancel()
        timeoutTask = Task { [timeout] in
            try? await Task.sleep(for: timeout)
            guard !Task.isCancelled else {
                return
            }

            self.isActive = false
            self.onIdle()
        }
    }
}
