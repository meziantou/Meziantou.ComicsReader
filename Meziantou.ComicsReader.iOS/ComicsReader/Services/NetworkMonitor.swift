import ComicsReaderKit
import Foundation
import Network
import Observation

/// Tracks connectivity, Low Data Mode and expensive (cellular) connections
@Observable
final class NetworkMonitor {
    private(set) var conditions = NetworkConditions(isOnline: true)

    @ObservationIgnored var onChange: ((_ old: NetworkConditions, _ new: NetworkConditions) -> Void)?
    @ObservationIgnored private let monitor = NWPathMonitor()

    var isOnline: Bool { conditions.isOnline }

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            let conditions = NetworkConditions(
                isOnline: path.status == .satisfied,
                isConstrained: path.isConstrained,
                isExpensive: path.isExpensive)

            Task { @MainActor in
                self?.update(conditions)
            }
        }
        monitor.start(queue: DispatchQueue(label: "NetworkMonitor"))
    }

    private func update(_ newConditions: NetworkConditions) {
        guard newConditions != conditions else {
            return
        }

        let oldConditions = conditions
        conditions = newConditions
        onChange?(oldConditions, newConditions)
    }
}
