import Foundation

/// Timing only schedules attempts. Progress and success must come from observed depth.
struct AutomaticScanPolicy {
    enum Action: Equatable { case none, acquireOrigin, observeGrid, renewOrigin }
    enum Phase: String { case paused, tracking, depth, readying, origin, grid, observing, retrying }
    private(set) var phase: Phase = .paused
    private(set) var stableDepthFrames = 0
    private(set) var nextAttemptAt: TimeInterval = 0
    private var lastFrameTimestamp: TimeInterval?
    private var failures = 0

    mutating func reset() { self = AutomaticScanPolicy() }

    mutating func nextAction(frameTimestamp: TimeInterval, now: TimeInterval,
                             tracking: Bool, hasDepth: Bool, originTimestamp: TimeInterval?,
                             collecting: Bool) -> Action {
        guard frameTimestamp.isFinite, now.isFinite, now >= frameTimestamp,
              now - frameTimestamp < 0.5 else {
            phase = .depth; stableDepthFrames = 0; return .none
        }
        guard tracking else { phase = .tracking; stableDepthFrames = 0; return .none }
        guard hasDepth else { phase = .depth; stableDepthFrames = 0; return .none }
        if let previous = lastFrameTimestamp, frameTimestamp < previous + 0.07 { return .none }
        lastFrameTimestamp = frameTimestamp
        if collecting { return .none }
        if let originTimestamp, frameTimestamp - originTimestamp > 30 {
            phase = .readying; stableDepthFrames = 0; return .renewOrigin
        }
        guard now >= nextAttemptAt else { phase = failures > 0 ? .retrying : .observing; return .none }
        if originTimestamp != nil { phase = .grid; return .observeGrid }
        stableDepthFrames += 1
        phase = .readying
        guard stableDepthFrames >= 6 else { return .none }
        phase = .origin
        return .acquireOrigin
    }

    mutating func completed(success: Bool, wasOrigin: Bool, now: TimeInterval) {
        if success {
            failures = 0
            phase = .observing
            nextAttemptAt = now + (wasOrigin ? 0.15 : 0.5)
        } else {
            failures = min(4, failures + 1)
            phase = .retrying
            nextAttemptAt = now + min(4, 0.5 * pow(2, Double(failures - 1)))
            stableDepthFrames = 0
        }
    }
}

struct ScanEvidence: Equatable {
    var referenceEstablished = false
    var minimumPointFrames = 0
    var distinctFrames = 0
    var validPoints = 0
    var candidatePoints = 0
    var rejectedReads = 0
    var isCollecting = false
    /// This measures acquired repetitions, never elapsed-time completion.
    var repetitionFraction: Double { Double(min(12, max(0, minimumPointFrames))) / 12 }
}

enum ResearchUploadCadence {
    static func allows(lastRecordedAt: Date?, now: Date) -> Bool {
        guard let lastRecordedAt else { return true }
        return now.timeIntervalSince(lastRecordedAt) >= 30
    }
}

enum GroundCandidatePolicy {
    static func heightMatches(measured: Float, expected: Float) -> Bool {
        measured.isFinite && expected.isFinite && expected >= 0.7 && expected <= 1.8
            && abs(measured - expected) <= 0.30
    }
    static func patchSupportsReference(validNeighbors: Int, horizontalSpan: Float) -> Bool {
        validNeighbors >= 7 && horizontalSpan.isFinite && horizontalSpan >= 0.30
    }
}
