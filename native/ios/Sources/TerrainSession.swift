import ARKit
import simd

struct TerrainSample: Identifiable {
    let id = UUID()
    let worldPosition: SIMD3<Float>
    let distanceMeters: Float
    let relativeHeightMeters: Float
    let confidence: ARConfidenceLevel
}

final class TerrainSession: NSObject, ARSessionDelegate {
    let sceneView = ARSCNView(frame: .zero)
    private(set) var origin: SIMD3<Float>?
    private(set) var samples: [TerrainSample] = []

    func start() throws {
        guard ARCapability.check() == .supported else { throw TerrainError.unsupportedDevice }
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal]
        config.frameSemantics = [.sceneDepth, .smoothedSceneDepth]
        sceneView.session.delegate = self
        sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    /// Called after tracking becomes normal. The user's current ground point is
    /// the fixed distance origin; it is never recomputed from screen orientation.
    func setOrigin(at screenPoint: CGPoint) {
        guard let result = sceneView.raycastQuery(from: screenPoint, allowing: .estimatedPlane, alignment: .horizontal)
            .flatMap({ sceneView.session.raycast($0).first }) else { return }
        origin = SIMD3(result.worldTransform.columns.3.x, result.worldTransform.columns.3.y, result.worldTransform.columns.3.z)
    }

    /// Samples real world-space hit-test locations. Their y values form the
    /// heatmap; horizontal distance is calculated from the fixed user origin.
    func scanGrid(screenPoints: [CGPoint]) {
        guard let origin else { return }
        samples = screenPoints.compactMap { point in
            guard let query = sceneView.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .horizontal),
                  let hit = sceneView.session.raycast(query).first else { return nil }
            let p = SIMD3(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
            let horizontal = simd_length(SIMD2(p.x - origin.x, p.z - origin.z))
            return TerrainSample(worldPosition: p, distanceMeters: horizontal,
                                 relativeHeightMeters: p.y - origin.y, confidence: .high)
        }
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        // The UI must suppress distance/heatmap rendering unless tracking is .normal.
    }

    enum TerrainError: Error { case unsupportedDevice }
}
