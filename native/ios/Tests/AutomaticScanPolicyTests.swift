import XCTest
@testable import ParkCaddyAR

final class AutomaticScanPolicyTests: XCTestCase {
    func testElevatedObjectsAndSmallIsolatedPatchesCannotEstablishReference() {
        XCTAssertTrue(GroundCandidatePolicy.heightMatches(measured: 1.2, expected: 1.2))
        XCTAssertFalse(GroundCandidatePolicy.heightMatches(measured: 0.2, expected: 1.2))
        XCTAssertFalse(GroundCandidatePolicy.heightMatches(measured: .nan, expected: 1.2))
        XCTAssertFalse(GroundCandidatePolicy.patchSupportsReference(validNeighbors: 6, horizontalSpan: 0.5))
        XCTAssertFalse(GroundCandidatePolicy.patchSupportsReference(validNeighbors: 8, horizontalSpan: 0.1))
        XCTAssertTrue(GroundCandidatePolicy.patchSupportsReference(validNeighbors: 7, horizontalSpan: 0.35))
    }
    func testDepthAndTrackingAreRequiredAndTimeCannotInventProgress() {
        var policy = AutomaticScanPolicy()
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1, now: 1, tracking: false, hasDepth: true, originTimestamp: nil, collecting: false), .none)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 2, now: 2, tracking: true, hasDepth: false, originTimestamp: nil, collecting: false), .none)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 2, now: 10, tracking: true, hasDepth: true, originTimestamp: nil, collecting: false), .none)
        XCTAssertEqual(policy.stableDepthFrames, 0)
        XCTAssertEqual(ScanEvidence().repetitionFraction, 0)
    }

    func testSixDistinctReadyFramesBeginOriginWithoutButton() {
        var policy = AutomaticScanPolicy()
        for index in 0..<5 {
            let time = 1 + Double(index) * 0.1
            XCTAssertEqual(policy.nextAction(frameTimestamp: time, now: time, tracking: true, hasDepth: true, originTimestamp: nil, collecting: false), .none)
        }
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1.4, now: 1.4, tracking: true, hasDepth: true, originTimestamp: nil, collecting: false), .none)
        XCTAssertEqual(policy.stableDepthFrames, 5)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1.5, now: 1.5, tracking: true, hasDepth: true, originTimestamp: nil, collecting: false), .acquireOrigin)
    }

    func testOriginAutomaticallyTransitionsToGridButNeverStartsOverlappingBurst() {
        var policy = AutomaticScanPolicy()
        policy.completed(success: true, wasOrigin: true, now: 1)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1.1, now: 1.1, tracking: true, hasDepth: true, originTimestamp: 1, collecting: false), .none)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1.3, now: 1.3, tracking: true, hasDepth: true, originTimestamp: 1, collecting: false), .observeGrid)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1.5, now: 1.5, tracking: true, hasDepth: true, originTimestamp: 1, collecting: true), .none)
    }

    func testFailureBackoffAndExpiredReferenceRequireNewEvidence() {
        var policy = AutomaticScanPolicy()
        policy.completed(success: false, wasOrigin: true, now: 1)
        XCTAssertEqual(policy.nextAttemptAt, 1.5)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 1.2, now: 1.2, tracking: true, hasDepth: true, originTimestamp: nil, collecting: false), .none)
        XCTAssertEqual(policy.stableDepthFrames, 0)
        policy.completed(success: false, wasOrigin: true, now: 2)
        XCTAssertEqual(policy.nextAttemptAt, 3)
        XCTAssertEqual(policy.nextAction(frameTimestamp: 32, now: 32, tracking: true, hasDepth: true, originTimestamp: 1, collecting: false), .renewOrigin)
        policy.reset()
        XCTAssertEqual(policy.phase, .paused)
        XCTAssertEqual(policy.stableDepthFrames, 0)
    }

    func testEvidenceCountsAreClampedAndUploadCadenceIsThirtySeconds() {
        XCTAssertEqual(ScanEvidence(minimumPointFrames: 6).repetitionFraction, 0.5)
        XCTAssertEqual(ScanEvidence(minimumPointFrames: 120).repetitionFraction, 1)
        let date = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(ResearchUploadCadence.allows(lastRecordedAt: nil, now: date))
        XCTAssertFalse(ResearchUploadCadence.allows(lastRecordedAt: date, now: date.addingTimeInterval(29.9)))
        XCTAssertFalse(ResearchUploadCadence.allows(lastRecordedAt: date, now: date.addingTimeInterval(-100)))
        XCTAssertTrue(ResearchUploadCadence.allows(lastRecordedAt: date, now: date.addingTimeInterval(30)))
    }
}
