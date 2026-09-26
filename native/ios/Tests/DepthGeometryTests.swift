import XCTest
import simd
@testable import ParkCaddyAR

final class DepthGeometryTests: XCTestCase {
    private let intrinsics = simd_float3x3(columns: (
        SIMD3<Float>(400, 0, 0), SIMD3<Float>(0, 400, 0), SIMD3<Float>(320, 240, 1)
    ))

    func testCenterPixelLooksAlongNegativeCameraZ() throws {
        let point = try XCTUnwrap(project(pixel: SIMD2(160, 120), depth: 2))
        XCTAssertEqual(point.x, 0, accuracy: 0.00001)
        XCTAssertEqual(point.y, 0, accuracy: 0.00001)
        XCTAssertEqual(point.z, -2, accuracy: 0.00001)
    }

    func testIntrinsicsScaleAndImageYAxis() throws {
        let point = try XCTUnwrap(project(pixel: SIMD2(180, 140), depth: 2))
        XCTAssertEqual(point.x, 0.2, accuracy: 0.00001)
        XCTAssertEqual(point.y, -0.2, accuracy: 0.00001)
        XCTAssertEqual(point.z, -2, accuracy: 0.00001)
    }

    func testWorldTranslationIsApplied() throws {
        var transform = matrix_identity_float4x4
        transform.columns.3 = SIMD4(4, 1.2, -3, 1)
        let point = try XCTUnwrap(DepthGeometry.worldPoint(
            depth: 2, pixel: SIMD2(160, 120), intrinsics: intrinsics,
            imageSize: SIMD2(640, 480), depthSize: SIMD2(320, 240), cameraTransform: transform
        ))
        XCTAssertEqual(point.x, 4, accuracy: 0.00001)
        XCTAssertEqual(point.y, 1.2, accuracy: 0.00001)
        XCTAssertEqual(point.z, -5, accuracy: 0.00001)
    }

    func testDepthIsCameraPlaneDistanceNotRayLength() throws {
        let point = try XCTUnwrap(project(pixel: SIMD2(260, 120), depth: 2))
        XCTAssertEqual(point.z, -2, accuracy: 0.00001)
        XCTAssertEqual(point.x, 1, accuracy: 0.00001)
        XCTAssertGreaterThan(simd_length(point), 2)
    }

    func testHorizontalDistanceDoesNotIncludeHeight() {
        XCTAssertEqual(DepthGeometry.horizontalDistance(from: SIMD3(0, 10, 0), to: SIMD3(3, 11, 4)),
                       5, accuracy: 0.00001)
    }

    func testSlopeIsSignedAndTinyBaselineSuppressed() {
        XCTAssertEqual(DepthGeometry.slopePercent(distance: 2, height: 0.04)!, 2, accuracy: 0.00001)
        XCTAssertEqual(DepthGeometry.slopePercent(distance: 2, height: -0.04)!, -2, accuracy: 0.00001)
        XCTAssertNil(DepthGeometry.slopePercent(distance: 0.1, height: 0.04))
    }

    func testInvalidDepthAndIntrinsicsAreRejected() {
        XCTAssertNil(project(pixel: SIMD2(160, 120), depth: .nan))
        XCTAssertNil(project(pixel: SIMD2(160, 120), depth: 0))
        XCTAssertNil(project(pixel: SIMD2(160, 120), depth: -1))
        XCTAssertNil(DepthGeometry.worldPoint(
            depth: 2, pixel: SIMD2(160, 120),
            intrinsics: simd_float3x3(diagonal: SIMD3<Float>(repeating: 0)),
            imageSize: SIMD2(640, 480), depthSize: SIMD2(320, 240),
            cameraTransform: matrix_identity_float4x4
        ))
    }

    func testBurstMedianRejectsIsolatedOutlier() throws {
        var points = (0..<11).map { SIMD3<Float>(Float($0 - 5) * 0.001, 0, -2) }
        points.append(SIMD3(0.10, 0.10, -1.9))
        let estimate = try XCTUnwrap(DepthGeometry.robustPosition(points, minimumCount: 8))
        XCTAssertEqual(estimate.position.x, 0, accuracy: 0.001)
        XCTAssertEqual(estimate.position.y, 0, accuracy: 0.001)
        XCTAssertEqual(estimate.position.z, -2, accuracy: 0.001)
        XCTAssertFalse(estimate.inlierIndices.contains(11))
    }

    func testBurstRejectsInsufficientAndUnstableObservations() {
        XCTAssertNil(DepthGeometry.robustPosition(Array(repeating: SIMD3(0, 0, -2), count: 7), minimumCount: 8))
        let points = (0..<12).map { SIMD3<Float>(Float($0 - 6) * 0.03, 0, -2) }
        XCTAssertNil(DepthGeometry.robustPosition(points, minimumCount: 8))
    }

    func testRepeatedBiasIsNotPretendedToBeCorrected() throws {
        let estimate = try XCTUnwrap(DepthGeometry.robustPosition(
            Array(repeating: SIMD3<Float>(0, 0.05, -2), count: 12), minimumCount: 8
        ))
        XCTAssertEqual(estimate.position.y, 0.05, accuracy: 0.00001)
        XCTAssertEqual(estimate.medianDeviation, 0, accuracy: 0.00001)
    }

    func testRejectedNewerFrameDoesNotRefreshOldInliers() {
        XCTAssertNil(DepthGeometry.newestFreshInlierTimestamp(
            [10.0, 10.1, 12.45], inlierIndices: [0, 1], now: 12.5
        ))
    }

    func testFreshnessUsesActualAcceptedTimestamp() throws {
        let timestamp = try XCTUnwrap(DepthGeometry.newestFreshInlierTimestamp(
            [10.0, 10.1, 10.25], inlierIndices: [0, 1], now: 10.3
        ))
        XCTAssertEqual(timestamp, 10.1, accuracy: 0.00001)
    }

    func testInvalidOrFutureInlierTimestampsAreRejected() {
        XCTAssertNil(DepthGeometry.newestFreshInlierTimestamp([10.1], inlierIndices: [], now: 10.2))
        XCTAssertNil(DepthGeometry.newestFreshInlierTimestamp([10.1], inlierIndices: [1], now: 10.2))
        XCTAssertNil(DepthGeometry.newestFreshInlierTimestamp([.nan], inlierIndices: [0], now: 10.2))
        XCTAssertNil(DepthGeometry.newestFreshInlierTimestamp([11], inlierIndices: [0], now: 10.2))
    }
    private func project(pixel: SIMD2<Float>, depth: Float) -> SIMD3<Float>? {
        DepthGeometry.worldPoint(
            depth: depth, pixel: pixel, intrinsics: intrinsics,
            imageSize: SIMD2(640, 480), depthSize: SIMD2(320, 240),
            cameraTransform: matrix_identity_float4x4
        )
    }
}
