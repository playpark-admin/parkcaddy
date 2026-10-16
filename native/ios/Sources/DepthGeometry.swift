import Foundation
import simd

/// ARKit camera space looks along -Z; the image v axis points down.
/// Depth is distance from the camera plane, not length along the viewing ray.
enum DepthGeometry {
    static func worldPoint(
        depth: Float,
        pixel: SIMD2<Float>,
        intrinsics: simd_float3x3,
        imageSize: SIMD2<Float>,
        depthSize: SIMD2<Float>,
        cameraTransform: simd_float4x4
    ) -> SIMD3<Float>? {
        guard depth.isFinite, depth > 0,
              imageSize.x > 0, imageSize.y > 0, depthSize.x > 0, depthSize.y > 0 else { return nil }
        let scale = imageSize / depthSize
        let fx = intrinsics.columns.0.x / scale.x
        let fy = intrinsics.columns.1.y / scale.y
        let cx = intrinsics.columns.2.x / scale.x
        let cy = intrinsics.columns.2.y / scale.y
        guard fx.isFinite, fy.isFinite, fx > 0, fy > 0 else { return nil }
        let cameraPoint = SIMD4<Float>(
            (pixel.x - cx) * depth / fx,
            -(pixel.y - cy) * depth / fy,
            -depth, 1
        )
        let world = cameraTransform * cameraPoint
        let result = SIMD3(world.x, world.y, world.z)
        return result.x.isFinite && result.y.isFinite && result.z.isFinite ? result : nil
    }

    /// Component medians and radial median deviation describe repeatability
    /// only. They do not estimate absolute error, drift, or independent samples.
    static func robustPosition(_ points: [SIMD3<Float>], minimumCount: Int) -> (position: SIMD3<Float>, medianDeviation: Float, inlierIndices: [Int])? {
        guard points.count >= minimumCount, minimumCount >= 3,
              points.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }) else { return nil }
        func median(_ values: [Float]) -> Float {
            let sorted = values.sorted()
            let middle = sorted.count / 2
            return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
        }
        func center(_ values: [SIMD3<Float>]) -> SIMD3<Float> {
            SIMD3(median(values.map(\.x)), median(values.map(\.y)), median(values.map(\.z)))
        }
        let initial = center(points)
        let deviation = median(points.map { simd_distance($0, initial) })
        guard deviation <= 0.025 else { return nil }
        let threshold = max(0.010, 3 * deviation)
        let inlierIndices = points.indices.filter { simd_distance(points[$0], initial) <= threshold }
        let inliers = inlierIndices.map { points[$0] }
        guard inliers.count >= minimumCount else { return nil }
        return (center(inliers), deviation, inlierIndices)
    }
    /// Only timestamps belonging to spatial inliers may refresh an estimate.
    /// A newer rejected frame must never make an old observation appear fresh.
    static func newestFreshInlierTimestamp(
        _ timestamps: [TimeInterval], inlierIndices: [Int],
        now: TimeInterval, maxAge: TimeInterval = 0.5
    ) -> TimeInterval? {
        guard now.isFinite, maxAge.isFinite, maxAge > 0, !inlierIndices.isEmpty,
              inlierIndices.allSatisfy({ timestamps.indices.contains($0) && timestamps[$0].isFinite }),
              let latest = inlierIndices.map({ timestamps[$0] }).max(),
              now >= latest, now - latest < maxAge else { return nil }
        return latest
    }
    static func horizontalDistance(from origin: SIMD3<Float>, to point: SIMD3<Float>) -> Float {
        simd_length(SIMD2(point.x - origin.x, point.z - origin.z))
    }

    static func slopePercent(distance: Float, height: Float) -> Float? {
        guard distance >= 0.20 else { return nil }
        return 100 * height / distance
    }
}
