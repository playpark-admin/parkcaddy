import ARKit

enum ARCapability {
    enum Result: Equatable {
        case supported
        case noWorldTracking
        case noSceneDepth
    }

    /// Numeric terrain flow is enabled only when both stable world tracking and
    /// LiDAR scene depth are available. Do not fall back to guessed camera tilt.
    static func check() -> Result {
        guard ARWorldTrackingConfiguration.isSupported else { return .noWorldTracking }
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            return .noSceneDepth
        }
        return .supported
    }
}
