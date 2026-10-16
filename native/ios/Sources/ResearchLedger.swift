import Foundation

/// Durable IDs are retained after upload because ordinary clients cannot list server data.
struct ResearchEntry: Codable, Equatable {
    enum Phase: String, Codable { case pending, sent, deleting }
    let id: String
    var ownerUID: String?
    var payload: Data?
    var phase: Phase = .pending
    var uncertainUpload = false
    var retryAfter: Date = .distantPast
}

struct ResearchLedger: Codable {
    enum Consent: String, Codable { case undecided, enabled, disabled }
    var consent: Consent = .undecided
    var entries: [ResearchEntry] = []

    mutating func append(payload: Data, id: String = UUID().uuidString) -> Bool {
        guard consent == .enabled, entries.count < 5000 else { return false }
        entries.append(ResearchEntry(id: id, payload: payload))
        return true
    }

    mutating func revokeAndDelete() {
        consent = .disabled
        entries = entries.compactMap { entry in
            guard entry.ownerUID != nil else { return nil }
            var deletion = entry
            deletion.phase = .deleting
            deletion.payload = nil
            deletion.retryAfter = .distantPast
            return deletion
        }
    }

    /// An acknowledgement can never turn a revoked entry back into an uploaded record.
    mutating func acknowledgeUpload(id: String, definitive: Bool) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].uncertainUpload = !definitive
        if entries[index].phase == .pending, consent == .enabled {
            entries[index].phase = .sent
            entries[index].payload = nil
        }
    }

    mutating func acknowledgeDeletion(id: String, serverBarrierEstablished: Bool = false, now: Date = Date()) {
        guard let index = entries.firstIndex(where: { $0.id == id && $0.phase == .deleting }) else { return }
        if entries[index].uncertainUpload && !serverBarrierEstablished {
            // A timed-out create might still reach the server. Keep its deletion ID
            // and retry on future activations instead of declaring irreversible success.
            entries[index].retryAfter = now.addingTimeInterval(60)
        } else { entries.remove(at: index) }
    }
}
