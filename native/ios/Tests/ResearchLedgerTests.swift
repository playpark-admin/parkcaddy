import XCTest
@testable import ParkCaddyAR

final class ResearchLedgerTests: XCTestCase {
    func testFirestoreEncodingPreservesBooleanNullAndMetricValuesAfterJSONRoundTrip() throws {
        let snapshot: [String: Any] = ["accuracyValidated": false, "photo": NSNull(),
            "heightMeters": Float(-0.0125), "points": [["xMeters": Float(1.25)]]]
        let data = try JSONSerialization.data(withJSONObject: snapshot)
        let object = try JSONSerialization.jsonObject(with: data)
        let encoded = GroundResearchStore.firestoreValue(object)
        let map = try XCTUnwrap(encoded["mapValue"] as? [String: Any])
        let fields = try XCTUnwrap(map["fields"] as? [String: [String: Any]])
        XCTAssertEqual(fields["accuracyValidated"]?["booleanValue"] as? Bool, false)
        XCTAssertNil(fields["accuracyValidated"]?["doubleValue"])
        XCTAssertTrue(fields["photo"]?["nullValue"] is NSNull)
        XCTAssertEqual(try XCTUnwrap(fields["heightMeters"]?["doubleValue"] as? Double), -0.0125, accuracy: 0.000001)
        XCTAssertNotNil(fields["points"]?["arrayValue"])
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: encoded))
    }
    func testConfirmedAtomicDeletionBarrierClearsEvenUncertainUploadHandle() {
        var ledger = ResearchLedger(consent: .enabled)
        XCTAssertTrue(ledger.append(payload: Data(), id: "one"))
        ledger.entries[0].ownerUID = "owner-a"
        ledger.entries[0].uncertainUpload = true
        ledger.revokeAndDelete()
        ledger.acknowledgeDeletion(id: "one", serverBarrierEstablished: true)
        XCTAssertTrue(ledger.entries.isEmpty)
        ledger.acknowledgeUpload(id: "one", definitive: true)
        XCTAssertTrue(ledger.entries.isEmpty)
    }

    func testDeletionCommitUsesSameOwnerAndRecordForMarkerAndRawData() throws {
        let commit = GroundResearchStore.deletionCommit(projectID: "project", uid: "owner-a", id: "one")
        let writes = try XCTUnwrap(commit["writes"] as? [[String: Any]])
        XCTAssertEqual(writes.count, 2)
        let update = try XCTUnwrap(writes[0]["update"] as? [String: Any])
        XCTAssertEqual(update["name"] as? String, "projects/project/databases/(default)/documents/users/owner-a/measurementDeletions/one")
        let fields = try XCTUnwrap(update["fields"] as? [String: [String: Any]])
        XCTAssertEqual(Set(fields.keys), Set(["deleted"]))
        XCTAssertEqual(fields["deleted"]?["booleanValue"] as? Bool, true)
        XCTAssertEqual(writes[1]["delete"] as? String, "projects/project/databases/(default)/documents/users/owner-a/measurements/one")
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: commit))
    }
    func testRefusalNeverQueuesPayload() {
        var ledger = ResearchLedger()
        XCTAssertFalse(ledger.append(payload: Data("private".utf8)))
        ledger.revokeAndDelete()
        XCTAssertFalse(ledger.append(payload: Data("private".utf8)))
        XCTAssertTrue(ledger.entries.isEmpty)
    }

    func testRevokeDiscardsUnownedDataAndRetainsDeletionIDForInFlightWrite() {
        var ledger = ResearchLedger(consent: .enabled)
        XCTAssertTrue(ledger.append(payload: Data("private".utf8), id: "local"))
        XCTAssertTrue(ledger.append(payload: Data("private".utf8), id: "in-flight"))
        ledger.entries[1].ownerUID = "owner-a"
        ledger.entries[1].uncertainUpload = true
        ledger.revokeAndDelete()
        XCTAssertEqual(ledger.entries.map(\.id), ["in-flight"])
        XCTAssertEqual(ledger.entries[0].phase, .deleting)
        XCTAssertNil(ledger.entries[0].payload)
        XCTAssertEqual(ledger.entries[0].ownerUID, "owner-a")
    }

    func testLateAcknowledgementCannotResurrectRevokedPayload() {
        var ledger = ResearchLedger(consent: .enabled)
        XCTAssertTrue(ledger.append(payload: Data(), id: "one"))
        ledger.entries[0].ownerUID = "owner-a"
        ledger.revokeAndDelete()
        ledger.acknowledgeUpload(id: "one", definitive: true)
        XCTAssertEqual(ledger.entries[0].phase, .deleting)
        XCTAssertNil(ledger.entries[0].payload)
        ledger.acknowledgeDeletion(id: "one")
        XCTAssertTrue(ledger.entries.isEmpty)
    }

    func testUncertainNetworkOutcomeRetainsDeletionTombstoneAcrossRelaunch() throws {
        var ledger = ResearchLedger(consent: .enabled)
        XCTAssertTrue(ledger.append(payload: Data(), id: "one"))
        ledger.entries[0].ownerUID = "owner-a"
        ledger.entries[0].uncertainUpload = true
        ledger.revokeAndDelete()
        ledger.acknowledgeDeletion(id: "one", now: Date(timeIntervalSince1970: 100))
        let restored = try JSONDecoder().decode(ResearchLedger.self, from: JSONEncoder().encode(ledger))
        XCTAssertEqual(restored.consent, .disabled)
        XCTAssertEqual(restored.entries[0].ownerUID, "owner-a")
        XCTAssertEqual(restored.entries[0].phase, .deleting)
        XCTAssertNil(restored.entries[0].payload)
        XCTAssertEqual(restored.entries[0].retryAfter, Date(timeIntervalSince1970: 160))
    }

    func testRetrySuccessStillPreservesEarlierUncertainCreateForDeletion() {
        var ledger = ResearchLedger(consent: .enabled)
        XCTAssertTrue(ledger.append(payload: Data(), id: "one"))
        ledger.entries[0].ownerUID = "owner-a"
        ledger.entries[0].uncertainUpload = true
        ledger.acknowledgeUpload(id: "one", definitive: false)
        XCTAssertEqual(ledger.entries[0].phase, .sent)
        XCTAssertNil(ledger.entries[0].payload)
        ledger.revokeAndDelete()
        ledger.acknowledgeDeletion(id: "one")
        XCTAssertEqual(ledger.entries.count, 1)
        XCTAssertTrue(ledger.entries[0].uncertainUpload)
    }
    func testSuccessfulUploadKeepsOnlyOwnerAndIDForLaterDeletion() {
        var ledger = ResearchLedger(consent: .enabled)
        XCTAssertTrue(ledger.append(payload: Data("private".utf8), id: "one"))
        ledger.entries[0].ownerUID = "owner-a"
        ledger.acknowledgeUpload(id: "one", definitive: true)
        XCTAssertEqual(ledger.entries[0].phase, .sent)
        XCTAssertNil(ledger.entries[0].payload)
        ledger.revokeAndDelete()
        XCTAssertEqual(ledger.entries[0].phase, .deleting)
        XCTAssertEqual(ledger.entries[0].ownerUID, "owner-a")
    }
}
