import Foundation
import Combine
import CoreFoundation
import Security

@MainActor
final class GroundResearchStore: ObservableObject {
    static let shared = GroundResearchStore()
    @Published private(set) var consent: ResearchLedger.Consent = .undecided
    @Published private(set) var status = "측정 수치 공유는 선택 사항입니다."
    private var ledger = ResearchLedger()
    private var credentials: ResearchCredentials?
    private var worker: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var storageReady = true
    private let apiKey = "AIzaSyAEuFJs3RD_TjNDEWJ70FwrTEDEEGOZIf4"
    private let projectID = "parkcaddy-ground-2026"
    private let consentVersion = "2026-09-27-native-v1"
    private let fileURL: URL
    private let defaults: UserDefaults

    private init() {
        defaults = .standard
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        fileURL = base.appendingPathComponent("GroundResearch/ledger.json")
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                ledger = try JSONDecoder().decode(ResearchLedger.self, from: Data(contentsOf: fileURL))
            }
            // The separate revocation marker survives a failure to update the ledger.
            if defaults.bool(forKey: "ground.research.revoked") { ledger.revokeAndDelete() }
            consent = ledger.consent
            credentials = try ResearchKeychain.load()
            if consent == .enabled { status = "동의한 측정 수치가 관리자 서버로 자동 전송됩니다." }
        } catch {
            storageReady = false
            consent = .disabled
            status = "기기 기록을 확인할 수 없어 자동 전송을 중지했습니다."
        }
    }

    func decideConsent(_ allowed: Bool) {
        guard storageReady else { return }
        if allowed {
            ledger.consent = .enabled
            if persist() {
                defaults.set(false, forKey: "ground.research.revoked")
                consent = .enabled
                status = "측정 수치 자동 공유 중 · 사진과 GPS는 전송하지 않습니다."
                flush()
            }
        } else {
            revokeAndDelete()
        }
    }

    func revokeAndDelete() {
        defaults.set(true, forKey: "ground.research.revoked")
        consent = .disabled
        ledger.revokeAndDelete()
        guard persist() else { return }
        status = ledger.entries.isEmpty ? "공유를 중지했습니다." : "공유 중지 · 기존 서버 기록 삭제 처리 중"
        flush()
    }

    func record(_ terrain: TerrainSession) {
        guard storageReady, consent == .enabled, ledger.consent == .enabled,
              terrain.diagnostics.accepted > 0 else { return }
        let pointSamples = terrain.lastMeasurementKind == "target" ? terrain.latest.map { [$0] } ?? [] : terrain.samples
        let points: [[String: Any]] = pointSamples.map { point in
            ["xMeters": point.worldPosition.x, "yMeters": point.worldPosition.y, "zMeters": point.worldPosition.z,
             "horizontalDistanceMeters": point.distanceMeters, "relativeHeightMeters": point.relativeHeightMeters,
             "sensorConfidenceLevel": point.confidence.rawValue]
        }
        let origin: Any = terrain.origin.map { ["xMeters": $0.x, "yMeters": $0.y, "zMeters": $0.z] as Any } ?? NSNull()
        let metadata: [String: Any] = [
            "measurementKind": terrain.lastMeasurementKind,
            "sessionId": terrain.sessionID.uuidString,
            "sensorFrameTimestampSeconds": terrain.diagnostics.frameTimestamp.map { $0 as Any } ?? NSNull(),
            "acceptedPoints": terrain.diagnostics.accepted,
            "pixelAttempts": terrain.diagnostics.attempted,
            "distinctFrames": terrain.diagnostics.uniqueFrames,
            "repeatSpreadMillimeters": terrain.diagnostics.repeatSpreadMeters.map { ($0 * 1000) as Any } ?? NSNull(),
            "minimumConfidence": terrain.minimumConfidence,
            "maxRangeMeters": terrain.maxRangeMeters,
            "origin": origin,
            "points": points,
            "rejected": terrain.diagnostics.rejected,
            "accuracyValidated": false,
            "photo": NSNull(), "location": NSNull(),
            "coordinateSystem": "arkit-gravity-session-local-meters"
        ]
        let payload: [String: Any] = ["schemaVersion": 1, "platform": "ios",
            "createdAt": ISO8601DateFormatter().string(from: Date()), "consentVersion": consentVersion,
            "metadata": metadata]
        guard JSONSerialization.isValidJSONObject(payload), let data = try? JSONSerialization.data(withJSONObject: payload),
              ledger.append(payload: data) else {
            status = "자동 전송 대기 저장 공간을 확인해 주세요."
            return
        }
        if persist() { flush() }
    }

    func flush() {
        guard storageReady, worker == nil else { return }
        retry?.cancel()
        retry = nil
        worker = Task { [weak self] in
            guard let self else { return }
            await self.processQueue()
            self.worker = nil
            if self.ledger.entries.contains(where: { $0.phase == .deleting || ($0.phase == .pending && self.consent == .enabled) }) {
                self.retry = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 60_000_000_000)
                    guard !Task.isCancelled else { return }
                    self?.flush()
                }
            }
        }
    }

    private func processQueue() async {
        while storageReady {
            let candidate = ledger.entries.first(where: { $0.phase == .deleting && $0.retryAfter <= Date() })
                ?? (consent == .enabled ? ledger.entries.first(where: { $0.phase == .pending && $0.retryAfter <= Date() }) : nil)
            guard let candidate else { return }
            do {
                let auth = try await authenticate()
                guard let index = ledger.entries.firstIndex(where: { $0.id == candidate.id }) else { continue }
                if let owner = ledger.entries[index].ownerUID, owner != auth.uid { throw ResearchError.ownerMismatch }
                if ledger.entries[index].phase == .deleting {
                    let commit = Self.deletionCommit(projectID: projectID, uid: auth.uid, id: candidate.id)
                    let body = try JSONSerialization.data(withJSONObject: commit)
                    let url = URL(string: "https://firestore.googleapis.com/v1/projects/\(projectID)/databases/(default)/documents:commit")!
                    let code = try await request(method: "POST", url: url, token: auth.idToken, body: body)
                    guard (200...299).contains(code) else { throw ResearchError.http(code) }
                    // The same atomic commit both deletes the data and installs a
                    // permanent server barrier against any late create for this ID.
                    ledger.acknowledgeDeletion(id: candidate.id, serverBarrierEstablished: true)
                    guard persist() else { return }
                    if consent == .enabled {
                        status = "측정 수치 자동 공유 중 · 이전 삭제 요청도 처리합니다."
                    } else {
                        status = ledger.entries.contains(where: { $0.phase == .deleting }) ? "공유 중지 · 삭제 요청을 계속 처리합니다." : "공유 중지 · 이 기기의 서버 기록을 삭제했습니다."
                    }
                    continue
                }
                guard consent == .enabled, ledger.consent == .enabled, let data = ledger.entries[index].payload else { continue }
                let earlierUploadWasUncertain = ledger.entries[index].uncertainUpload
                ledger.entries[index].ownerUID = auth.uid
                ledger.entries[index].uncertainUpload = true
                guard persist() else { return }
                let value = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                let fields = value.mapValues(Self.firestoreValue)
                let body = try JSONSerialization.data(withJSONObject: ["fields": fields])
                let url = collectionURL(uid: auth.uid, id: candidate.id)
                let code = try await request(method: "POST", url: url, token: auth.idToken, body: body)
                if (200...299).contains(code) || code == 409 {
                    ledger.acknowledgeUpload(id: candidate.id, definitive: !earlierUploadWasUncertain)
                    guard persist() else { return }
                    if consent == .enabled { status = "측정 수치 자동 공유 중 · 관리자만 자료를 볼 수 있습니다." }
                } else {
                    // Preserve uncertainty from earlier timed-out requests, even if this request is rejected.

                    throw ResearchError.http(code)
                }
            } catch {
                if let index = ledger.entries.firstIndex(where: { $0.id == candidate.id }) {
                    ledger.entries[index].retryAfter = Date().addingTimeInterval(60)
                    guard persist() else { return }
                }
                if case ResearchError.ownerMismatch = error {
                    status = "이 기기의 이전 전송 계정을 확인할 수 없어 전송·삭제를 중지했습니다."
                } else {
                    status = consent == .enabled ? "연결되면 측정 수치를 자동으로 다시 전송합니다." : "공유 중지 · 연결되면 삭제를 다시 처리합니다."
                }
                return
            }
        }
    }

    private func persist() -> Bool {
        do {
            let data = try JSONEncoder().encode(ledger)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return true
        } catch {
            storageReady = false
            consent = .disabled
            status = "기기에 대기 기록을 저장할 수 없어 자동 전송을 중지했습니다."
            return false
        }
    }

    private func authenticate() async throws -> ResearchCredentials {
        if let credentials, credentials.expiresAt > Date().addingTimeInterval(60) { return credentials }
        var request: URLRequest
        if let previous = credentials {
            request = URLRequest(url: URL(string: "https://securetoken.googleapis.com/v1/token?key=\(apiKey)")!)
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            var parts = URLComponents()
            parts.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token"), URLQueryItem(name: "refresh_token", value: previous.refreshToken)]
            request.httpBody = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        } else {
            guard !ledger.entries.contains(where: { $0.ownerUID != nil }) else { throw ResearchError.ownerMismatch }
            guard consent == .enabled else { throw ResearchError.revoked }
            request = URLRequest(url: URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=\(apiKey)")!)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{\"returnSecureToken\":true}".utf8)
        }
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let uid = object["localId"] as? String ?? object["user_id"] as? String,
              let idToken = object["idToken"] as? String ?? object["id_token"] as? String,
              let refresh = object["refreshToken"] as? String ?? object["refresh_token"] as? String else { throw ResearchError.http(code) }
        if let previous = credentials, previous.uid != uid { throw ResearchError.ownerMismatch }
        let seconds = Double(object["expiresIn"] as? String ?? object["expires_in"] as? String ?? "3600") ?? 3600
        let updated = ResearchCredentials(uid: uid, idToken: idToken, refreshToken: refresh, expiresAt: Date().addingTimeInterval(seconds))
        try ResearchKeychain.save(updated)
        credentials = updated
        return updated
    }

    private func collectionURL(uid: String, id: String) -> URL {
        URL(string: "https://firestore.googleapis.com/v1/projects/\(projectID)/databases/(default)/documents/users/\(uid)/measurements?documentId=\(id)")!
    }
    nonisolated static func deletionCommit(projectID: String, uid: String, id: String) -> [String: Any] {
        let root = "projects/\(projectID)/databases/(default)/documents/users/\(uid)"
        let writes: [[String: Any]] = [
            ["update": ["name": "\(root)/measurementDeletions/\(id)",
                        "fields": ["deleted": ["booleanValue": true]]]],
            ["delete": "\(root)/measurements/\(id)"]
        ]
        return ["writes": writes]
    }
    private func request(method: String, url: URL, token: String, body: Data? = nil) async throws -> Int {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }

    nonisolated static func firestoreValue(_ value: Any) -> [String: Any] {
        if value is NSNull { return ["nullValue": NSNull()] }
        if let value = value as? String { return ["stringValue": value] }
        if let value = value as? NSNumber {
            if CFGetTypeID(value) == CFBooleanGetTypeID() { return ["booleanValue": value.boolValue] }
            return ["doubleValue": value.doubleValue]
        }
        if let value = value as? [String: Any] { return ["mapValue": ["fields": value.mapValues(firestoreValue)]] }
        if let value = value as? [Any] { return ["arrayValue": ["values": value.map(firestoreValue)]] }
        return ["nullValue": NSNull()]
    }
}

private enum ResearchError: Error { case http(Int), ownerMismatch, revoked }
private struct ResearchCredentials: Codable {
    let uid: String
    let idToken: String
    let refreshToken: String
    let expiresAt: Date
}

private enum ResearchKeychain {
    private static let service = "app.playpark.parkcaddy.ground-research"
    static func load() throws -> ResearchCredentials? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "firebase-anonymous",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ResearchError.ownerMismatch }
        return try JSONDecoder().decode(ResearchCredentials.self, from: data)
    }
    static func save(_ value: ResearchCredentials) throws {
        let data = try JSONEncoder().encode(value)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "firebase-anonymous"]
        let changes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(query.merging(changes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) }
        guard status == errSecSuccess else { throw ResearchError.ownerMismatch }
    }
}
