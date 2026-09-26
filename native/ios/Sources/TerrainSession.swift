import ARKit
import AVFoundation
import Combine
import CoreVideo
import SceneKit
import simd

struct TerrainSample: Identifiable {
    let id = UUID()
    let worldPosition: SIMD3<Float>
    let distanceMeters: Float
    let relativeHeightMeters: Float
    let confidence: ARConfidenceLevel
    let capturedAt: Date
    let sensorDepthMeters: Float
    let localTiltDegrees: Float

    var slopePercent: Float? {
        DepthGeometry.slopePercent(distance: distanceMeters, height: relativeHeightMeters)
    }
}

struct TerrainDiagnostics {
    var attempted = 0
    var accepted = 0
    var rejected: [String: Int] = [:]
    var depthResolution = "—"
    var frameTimestamp: TimeInterval?
    var lastSensorDepth: Float?
    var lastConfidence: Int?
    var lastLocalTilt: Float?
    var cameraWorldY: Float?
    var uniqueFrames = 0
    var repeatSpreadMeters: Float?
}

/// UI, session delegates and depth-buffer reads all execute on the main queue.
final class TerrainSession: NSObject, ObservableObject, ARSessionDelegate {
    let sceneView = ARSCNView(frame: .zero)
    let capability = ARCapability.check()
    @Published private(set) var origin: SIMD3<Float>?
    @Published private(set) var samples: [TerrainSample] = []
    @Published private(set) var latest: TerrainSample?
    @Published private(set) var isRunning = false
    @Published private(set) var isCollecting = false
    @Published private(set) var trackingReady = false
    @Published private(set) var hasDepth = false
    @Published private(set) var trackingText = "시작 전"
    @Published private(set) var message = "지면을 비춘 뒤 측정을 시작하세요."
    @Published private(set) var diagnostics = TerrainDiagnostics()

    @Published var debugMode = UserDefaults.standard.bool(forKey: "terrain.debug") {
        didSet { UserDefaults.standard.set(debugMode, forKey: "terrain.debug") }
    }
    @Published var spokenGuidance = UserDefaults.standard.object(forKey: "terrain.speech") as? Bool ?? true {
        didSet { UserDefaults.standard.set(spokenGuidance, forKey: "terrain.speech") }
    }
    @Published var maxRangeMeters = Float(UserDefaults.standard.object(forKey: "terrain.range") as? Double ?? 3.0) {
        didSet {
            UserDefaults.standard.set(Double(maxRangeMeters), forKey: "terrain.range")
            clearMeasurement(message: "거리 설정이 바뀌었습니다. 기준점을 다시 정하세요.")
        }
    }
    @Published var minimumConfidence = UserDefaults.standard.object(forKey: "terrain.confidence") as? Int ?? 2 {
        didSet {
            UserDefaults.standard.set(minimumConfidence, forKey: "terrain.confidence")
            clearMeasurement(message: "센서 품질 설정이 바뀌었습니다. 기준점을 다시 정하세요.")
        }
    }

    var canMeasure: Bool { isRunning && !isCollecting && trackingReady && hasDepth && capability == .supported }
    private let speech = AVSpeechSynthesizer()
    private let pointsNode = SCNNode()
    private var lastUIFrame: TimeInterval = 0
    private var burst: DepthBurst?
    private var originTimestamp: TimeInterval?

    override init() {
        super.init()
        sceneView.scene = SCNScene()
        sceneView.scene.rootNode.addChildNode(pointsNode)
        sceneView.session.delegate = self
        sceneView.session.delegateQueue = .main
        sceneView.automaticallyUpdatesLighting = true
    }

    func start() {
        guard capability == .supported else {
            message = "이 기기는 사진·위치 기록을 사용하세요. LiDAR 지면 측정은 지원하지 않습니다."
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: runSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.runSession() }
                    else { self?.message = "설정 앱에서 카메라 사용을 허용해 주세요." }
                }
            }
        default: message = "설정 앱에서 카메라 사용을 허용해 주세요."
        }
    }

    private func runSession() {
        clearMeasurement(message: "잔디를 천천히 비추세요. 준비되면 기준점을 정할 수 있습니다.")
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        // Do not substitute estimated planes or temporal smoothing for observed depth.
        config.frameSemantics = [.sceneDepth]
        sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
        isRunning = true
        trackingReady = false
        hasDepth = false
    }

    func pause() {
        sceneView.session.pause()
        isRunning = false
        trackingReady = false
        hasDepth = false
        trackingText = "일시 정지"
        clearMeasurement(message: "다시 시작하면 새 기준점을 정해 주세요.")
    }

    func resetOrigin() {
        clearMeasurement(message: "기준으로 삼을 잔디를 가운데 십자선에 맞추세요.")
    }

    /// Samples distinct frame timestamps while reprojecting the same world
    /// target. Robust aggregation reduces observed jitter, not common bias.
    func captureOrigin() { beginBurst(kind: .origin) }
    func captureTarget() { beginBurst(kind: .target) }
    func captureGrid() { beginBurst(kind: .grid) }

    private func beginBurst(kind: CaptureKind) {
        if kind != .origin && origin == nil { message = "먼저 기준점을 정해 주세요."; return }
        guard let reader = prepareReader() else { return }
        let screenPoints: [CGPoint]
        if kind == .grid {
            let size = sceneView.bounds.size
            screenPoints = (0..<5).flatMap { row in
                (0..<7).map { column in
                    CGPoint(x: size.width * CGFloat(0.2 + Double(column) * 0.1),
                            y: size.height * CGFloat(0.30 + Double(row) * 0.07))
                }
            }
        } else { screenPoints = [crosshair] }
        var report = reader.diagnostics
        var targets: [BurstTarget] = []
        for point in screenPoints {
            report.attempted += 1
            switch reader.read(screenPoint: point) {
            case .success(let observed): targets.append(BurstTarget(seed: observed))
            case .failure(let reason): report.rejected[reason.rawValue, default: 0] += 1
            }
        }
        guard !targets.isEmpty else {
            latest = nil
            diagnostics = report
            message = "미측정 · " + (report.rejected.keys.sorted().first ?? "가까운 잔디를 비추세요.")
            return
        }
        let capture = DepthBurst(kind: kind, targets: targets, origin: origin,
                                 timestamp: reader.frame.timestamp, report: report)
        burst = capture
        isCollecting = true
        latest = nil
        message = "약 1초간 같은 잔디를 비추세요. 여러 프레임을 비교하고 있습니다."
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard self?.burst?.id == capture.id else { return }
            self?.finishBurst()
        }
    }

    private func advanceBurst(frame: ARFrame) {
        guard let capture = burst, frame.timestamp > capture.lastTimestamp + 0.07,
              case .normal = frame.camera.trackingState,
              ProcessInfo.processInfo.systemUptime - frame.timestamp < 0.5,
              let orientation = sceneView.window?.windowScene?.interfaceOrientation,
              orientation != .unknown,
              let reader = DepthFrameReader(frame: frame, viewport: sceneView.bounds.size,
                                            orientation: orientation, maxRange: maxRangeMeters,
                                            minimumConfidence: minimumConfidence) else { return }
        capture.lastTimestamp = frame.timestamp
        capture.report.uniqueFrames += 1
        for target in capture.targets where target.observations.count < 12 {
            let position = target.seed.position
            let cameraSpace = simd_inverse(frame.camera.transform) * SIMD4(position.x, position.y, position.z, 1)
            let projected = frame.camera.projectPoint(position, orientation: orientation, viewportSize: sceneView.bounds.size)
            capture.report.attempted += 1
            guard cameraSpace.z < 0 else {
                capture.report.rejected["동일 지점이 화면에서 벗어났습니다.", default: 0] += 1
                continue
            }
            switch reader.read(screenPoint: projected) {
            case .success(let point):
                guard simd_distance(point.position, target.seed.position) <= 0.12 else {
                    capture.report.rejected["같은 지점의 관측이 일치하지 않습니다.", default: 0] += 1
                    continue
                }
                target.observations.append(point)
            case .failure(let reason):
                capture.report.rejected[reason.rawValue, default: 0] += 1
            }
        }
        if capture.targets.allSatisfy({ $0.observations.count >= 12 }) { finishBurst() }
    }

    private func finishBurst() {
        guard let capture = burst else { return }
        burst = nil
        isCollecting = false
        guard trackingReady, isRunning,
              let activeFrame = sceneView.session.currentFrame,
              case .normal = activeFrame.camera.trackingState else {
            message = "미측정 · 최신 관측이 없습니다. 가까운 잔디를 비추고 다시 시도하세요."
            return
        }
        var points: [ObservedDepthPoint] = []
        var spreads: [Float] = []
        for target in capture.targets {
            guard let estimate = DepthGeometry.robustPosition(target.observations.map(\.position), minimumCount: 8) else {
                capture.report.rejected["반복 관측이 부족하거나 산포가 큽니다.", default: 0] += 1
                continue
            }
            guard let acceptedTimestamp = DepthGeometry.newestFreshInlierTimestamp(
                target.observations.map(\.frameTimestamp), inlierIndices: estimate.inlierIndices,
                now: ProcessInfo.processInfo.systemUptime
            ) else {
                capture.report.rejected["실제로 통과한 관측이 오래되었습니다.", default: 0] += 1
                continue
            }
            let inliers = estimate.inlierIndices.map { target.observations[$0] }
            let confidenceRaw = inliers.map { $0.confidence.rawValue }.min() ?? 0
            guard let confidence = ARConfidenceLevel(rawValue: confidenceRaw) else { continue }
            let middle = inliers[inliers.count / 2]
            points.append(ObservedDepthPoint(position: estimate.position, depth: middle.depth,
                                             confidence: confidence, tilt: middle.tilt, frameTimestamp: acceptedTimestamp))
            spreads.append(estimate.medianDeviation)
        }
        // For a grid, report the oldest retained point to avoid overstating freshness.
        capture.report.frameTimestamp = points.map(\.frameTimestamp).min()
        capture.report.accepted = points.count
        capture.report.repeatSpreadMeters = spreads.max()
        diagnostics = capture.report
        guard !points.isEmpty else {
            latest = nil
            if capture.kind == .grid { samples = []; renderMarkers() }
            message = "미측정 · 반복 관측이 충분히 일치하지 않았습니다. 가까운 잔디에서 다시 시도하세요."
            return
        }
        if let point = points.first {
            diagnostics.lastSensorDepth = point.depth
            diagnostics.lastConfidence = point.confidence.rawValue
            diagnostics.lastLocalTilt = point.tilt
        }
        switch capture.kind {
        case .origin:
            origin = points[0].position
            originTimestamp = points[0].frameTimestamp
            samples = []
            renderMarkers()
            message = "기준점을 정했습니다. 비교할 잔디를 비추고 ‘이곳 측정’을 누르세요."
            speak("기준점을 정했습니다. 비교할 잔디를 비추세요.")
        case .target:
            guard let origin = capture.origin else { return }
            let sample = makeSample(points[0], origin: origin)
            latest = sample
            samples.append(sample)
            if samples.count > 300 { samples.removeFirst(samples.count - 300) }
            renderMarkers()
            message = "반복 관측을 비교했습니다. 같은 세션의 상대값이며 실제 정확도는 미검증입니다."
            let direction = sample.relativeHeightMeters >= 0 ? "높습니다" : "낮습니다"
            speak(String(format: "기준점에서 %.1f 미터, 약 %.0f 센티미터 %@", sample.distanceMeters, abs(sample.relativeHeightMeters) * 100, direction))
        case .grid:
            guard let origin = capture.origin else { return }
            samples = points.map { makeSample($0, origin: origin) }
            renderMarkers()
            message = "35곳 중 \(points.count)곳의 반복 관측이 통과했습니다. 빈 곳은 미측정입니다."
            speak("\(points.count)곳을 관측했습니다.")
        }
    }
    private var crosshair: CGPoint {
        CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)
    }

    private func prepareReader() -> DepthFrameReader? {
        guard canMeasure, let frame = sceneView.session.currentFrame,
              case .normal = frame.camera.trackingState else {
            message = "아직 측정할 수 없습니다. 가까운 잔디를 천천히 비추세요."
            return nil
        }
        if let originTimestamp, frame.timestamp - originTimestamp > 30 {
            clearMeasurement(message: "기준점을 정한 지 30초가 지났습니다. 오랜 이동 오차를 줄이도록 새 기준점을 정해 주세요.")
            return nil
        }
        guard ProcessInfo.processInfo.systemUptime - frame.timestamp < 0.5 else {
            message = "카메라 정보가 오래되었습니다. 잠시 뒤 다시 시도하세요."
            return nil
        }
        guard let orientation = sceneView.window?.windowScene?.interfaceOrientation,
              orientation != .unknown,
              let reader = DepthFrameReader(frame: frame, viewport: sceneView.bounds.size,
                                            orientation: orientation,
                                            maxRange: maxRangeMeters,
                                            minimumConfidence: minimumConfidence) else {
            message = "깊이·센서 품질 정보를 아직 받지 못했습니다."
            return nil
        }
        return reader
    }

    private func makeSample(_ point: ObservedDepthPoint, origin: SIMD3<Float>) -> TerrainSample {
        TerrainSample(worldPosition: point.position,
                      distanceMeters: DepthGeometry.horizontalDistance(from: origin, to: point.position),
                      relativeHeightMeters: point.position.y - origin.y,
                      confidence: point.confidence,
                      capturedAt: Date(timeIntervalSinceNow: point.frameTimestamp - ProcessInfo.processInfo.systemUptime),
                      sensorDepthMeters: point.depth, localTiltDegrees: point.tilt)
    }

    private func clearMeasurement(message: String) {
        burst = nil
        isCollecting = false
        origin = nil
        originTimestamp = nil
        latest = nil
        samples = []
        diagnostics = TerrainDiagnostics()
        removeMarkers()
        self.message = message
    }

    private func removeMarkers() {
        pointsNode.childNodes.forEach { $0.removeFromParentNode() }
    }

    private func renderMarkers() {
        removeMarkers()
        if let origin { addMarker(origin, color: .white, radius: 0.025) }
        for sample in samples {
            let color: UIColor = sample.relativeHeightMeters > 0.015 ? .systemOrange
                : sample.relativeHeightMeters < -0.015 ? .systemCyan : .systemGreen
            addMarker(sample.worldPosition, color: color, radius: 0.014)
        }
    }

    private func addMarker(_ position: SIMD3<Float>, color: UIColor, radius: CGFloat) {
        let sphere = SCNSphere(radius: radius)
        sphere.firstMaterial?.diffuse.contents = color
        sphere.firstMaterial?.lightingModel = .constant
        let node = SCNNode(geometry: sphere)
        node.simdPosition = position
        pointsNode.addChildNode(node)
    }

    private func speak(_ text: String) {
        guard spokenGuidance else { return }
        speech.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        utterance.rate = 0.43
        speech.speak(utterance)
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        advanceBurst(frame: frame)
        guard isRunning, frame.timestamp - lastUIFrame > 0.2 else { return }
        lastUIFrame = frame.timestamp
        hasDepth = frame.sceneDepth?.confidenceMap != nil
        if case .normal = frame.camera.trackingState {
            trackingReady = true
            trackingText = hasDepth ? "측정 준비됨" : "깊이 정보 준비 중"
        }
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .normal:
            trackingReady = true
            trackingText = "위치 추적 정상"
        case .notAvailable:
            trackingReady = false
            trackingText = "위치 추적 불가"
        case .limited(let reason):
            trackingReady = false
            switch reason {
            case .initializing: trackingText = "주변을 살펴보는 중"
            case .excessiveMotion: trackingText = "휴대폰을 천천히 움직이세요"
            case .insufficientFeatures: trackingText = "무늬가 보이는 잔디를 비추세요"
            case .relocalizing: trackingText = "위치를 다시 찾는 중"
            @unknown default: trackingText = "위치 추적 준비 중"
            }
        }
        if !trackingReady {
            clearMeasurement(message: "추적이 준비되면 기준점을 다시 정해 주세요.")
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        trackingReady = false
        hasDepth = false
        trackingText = "측정 중단"
        clearMeasurement(message: "카메라가 중단되어 이전 기준점을 지웠습니다.")
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        isRunning = false
        message = "‘측정 시작’을 눌러 새로 측정해 주세요."
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        pause()
        message = "카메라 측정을 시작할 수 없습니다. 권한을 확인한 뒤 다시 시도하세요."
        trackingText = error.localizedDescription
    }
}

private enum CaptureKind: Equatable { case origin, target, grid }

private final class BurstTarget {
    let seed: ObservedDepthPoint
    var observations: [ObservedDepthPoint]
    init(seed: ObservedDepthPoint) {
        self.seed = seed
        self.observations = [seed]
    }
}

private final class DepthBurst {
    let id = UUID()
    let kind: CaptureKind
    let targets: [BurstTarget]
    let origin: SIMD3<Float>?
    var lastTimestamp: TimeInterval
    var report: TerrainDiagnostics
    init(kind: CaptureKind, targets: [BurstTarget], origin: SIMD3<Float>?,
         timestamp: TimeInterval, report: TerrainDiagnostics) {
        self.kind = kind
        self.targets = targets
        self.origin = origin
        self.lastTimestamp = timestamp
        self.report = report
        self.report.uniqueFrames = 1
    }
}
private struct ObservedDepthPoint {
    let position: SIMD3<Float>
    let depth: Float
    let confidence: ARConfidenceLevel
    let tilt: Float
    let frameTimestamp: TimeInterval
}

private enum DepthRejection: String, Error {
    case outside = "화면 밖이거나 깊이 정보가 없습니다."
    case lowConfidence = "센서 품질이 부족합니다. 가까운 잔디를 비추세요."
    case range = "측정 거리 범위를 벗어났습니다. 잔디에 조금 더 가까이 가세요."
    case notGround = "지면을 확인하지 못했습니다. 아래쪽 잔디를 비추세요."
    case edge = "표면 경계이거나 깊이 정보가 고르지 않습니다."
}

/// A short-lived, locked view of one raw scene-depth frame.
/// Never retain buffer addresses beyond this object's lifetime.
private final class DepthFrameReader {
    let frame: ARFrame
    let depthBuffer: CVPixelBuffer
    let confidenceBuffer: CVPixelBuffer
    let viewport: CGSize
    let imageTransform: CGAffineTransform
    let width: Int
    let height: Int
    let maxRange: Float
    let minimumConfidence: Int
    let depthBase: UnsafeMutableRawPointer
    let confidenceBase: UnsafeMutableRawPointer
    var diagnostics: TerrainDiagnostics {
        var value = TerrainDiagnostics()
        value.depthResolution = "\(width) × \(height)"
        value.frameTimestamp = frame.timestamp
        value.cameraWorldY = frame.camera.transform.columns.3.y
        return value
    }

    init?(frame: ARFrame, viewport: CGSize, orientation: UIInterfaceOrientation,
          maxRange: Float, minimumConfidence: Int) {
        guard viewport.width > 0, viewport.height > 0,
              let data = frame.sceneDepth, let confidence = data.confidenceMap,
              CVPixelBufferGetPixelFormatType(data.depthMap) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8,
              CVPixelBufferGetWidth(data.depthMap) == CVPixelBufferGetWidth(confidence),
              CVPixelBufferGetHeight(data.depthMap) == CVPixelBufferGetHeight(confidence) else { return nil }
        guard CVPixelBufferLockBaseAddress(data.depthMap, .readOnly) == kCVReturnSuccess else { return nil }
        guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else {
            CVPixelBufferUnlockBaseAddress(data.depthMap, .readOnly)
            return nil
        }
        guard let depthBase = CVPixelBufferGetBaseAddress(data.depthMap),
              let confidenceBase = CVPixelBufferGetBaseAddress(confidence) else {
            CVPixelBufferUnlockBaseAddress(confidence, .readOnly)
            CVPixelBufferUnlockBaseAddress(data.depthMap, .readOnly)
            return nil
        }
        self.frame = frame
        self.depthBuffer = data.depthMap
        self.confidenceBuffer = confidence
        self.viewport = viewport
        self.imageTransform = frame.displayTransform(for: orientation, viewportSize: viewport).inverted()
        self.width = CVPixelBufferGetWidth(data.depthMap)
        self.height = CVPixelBufferGetHeight(data.depthMap)
        self.maxRange = min(5, max(1, maxRange))
        self.minimumConfidence = min(2, max(1, minimumConfidence))
        self.depthBase = depthBase
        self.confidenceBase = confidenceBase
    }

    deinit {
        CVPixelBufferUnlockBaseAddress(confidenceBuffer, .readOnly)
        CVPixelBufferUnlockBaseAddress(depthBuffer, .readOnly)
    }

    func read(screenPoint: CGPoint) -> Result<ObservedDepthPoint, DepthRejection> {
        guard screenPoint.x >= 0, screenPoint.y >= 0, screenPoint.x < viewport.width, screenPoint.y < viewport.height else { return .failure(.outside) }
        let normalized = CGPoint(x: screenPoint.x / viewport.width,
                                 y: screenPoint.y / viewport.height).applying(imageTransform)
        guard normalized.x >= 0, normalized.x < 1, normalized.y >= 0, normalized.y < 1 else {
            return .failure(.outside)
        }
        let x = Int(normalized.x * CGFloat(width))
        let y = Int(normalized.y * CGFloat(height))
        guard x >= 2, y >= 2, x < width - 2, y < height - 2 else { return .failure(.outside) }
        guard let center = pixel(x: x, y: y) else { return .failure(.lowConfidence) }
        let camera = frame.camera.transform.columns.3
        let cameraPosition = SIMD3(camera.x, camera.y, camera.z)
        let range = simd_distance(center.position, cameraPosition)
        guard range >= 0.25, range <= maxRange else { return .failure(.range) }

        // A local normal is a rejection heuristic, not terrain classification.
        guard let left = pixel(x: x - 2, y: y), let right = pixel(x: x + 2, y: y),
              let up = pixel(x: x, y: y - 2), let down = pixel(x: x, y: y + 2) else {
            return .failure(.lowConfidence)
        }
        let neighbors = [left, right, up, down]
        guard neighbors.allSatisfy({ abs($0.depth - center.depth) < 0.20 }) else {
            return .failure(.edge)
        }
        let normal = simd_cross(right.position - left.position, down.position - up.position)
        let length = simd_length(normal)
        guard length > 0.00001 else { return .failure(.edge) }
        let upright = min(1, max(0, abs(normal.y / length)))
        let tilt = acos(upright) * 180 / .pi
        guard tilt <= 35, center.position.y < cameraPosition.y - 0.15 else {
            return .failure(.notGround)
        }
        let confidenceValue = ([center] + neighbors).map { $0.confidence.rawValue }.min() ?? 0
        guard let confidence = ARConfidenceLevel(rawValue: confidenceValue) else {
            return .failure(.lowConfidence)
        }
        return .success(ObservedDepthPoint(position: center.position, depth: center.depth,
                                           confidence: confidence, tilt: tilt, frameTimestamp: frame.timestamp))
    }

    private func pixel(x: Int, y: Int) -> (position: SIMD3<Float>, depth: Float, confidence: ARConfidenceLevel)? {
        let depthRow = depthBase.advanced(by: y * CVPixelBufferGetBytesPerRow(depthBuffer))
            .assumingMemoryBound(to: Float32.self)
        let confidenceRow = confidenceBase.advanced(by: y * CVPixelBufferGetBytesPerRow(confidenceBuffer))
            .assumingMemoryBound(to: UInt8.self)
        let depth = depthRow[x]
        let confidenceValue = Int(confidenceRow[x])
        guard confidenceValue >= minimumConfidence, depth.isFinite, depth > 0,
              let confidence = ARConfidenceLevel(rawValue: confidenceValue),
              let point = DepthGeometry.worldPoint(
                depth: depth, pixel: SIMD2(Float(x), Float(y)), intrinsics: frame.camera.intrinsics,
                imageSize: SIMD2(Float(frame.camera.imageResolution.width), Float(frame.camera.imageResolution.height)),
                depthSize: SIMD2(Float(width), Float(height)), cameraTransform: frame.camera.transform
              ) else { return nil }
        return (point, depth, confidence)
    }
}
