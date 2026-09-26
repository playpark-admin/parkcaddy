import AVFoundation
import Combine
import CoreLocation
import SwiftUI
import UIKit

struct LocationRecord: Codable {
    let latitude: Double
    let longitude: Double
    let horizontalAccuracyMeters: Double
    let recordedAt: Date
}

private struct PhotoRecord: Codable {
    let schemaVersion = 2
    let id: String
    let capturedAt: Date
    let photoFile: String
    let source = "ios-camera"
    let measurementStatus = "unmeasured"
    let gpsPurpose = "coarse-place-discovery-only"
    let location: LocationRecord?
    let note = "사진과 GPS만으로 높낮이 또는 센티미터 정확도를 주장하지 않습니다."
}

/// Camera/GPS collection works on iPhones without LiDAR. Files remain local;
/// explicit export is required, and this class does not silently upload them.
final class FieldCaptureStore: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var includeLocation = UserDefaults.standard.bool(forKey: "capture.includeLocation") {
        didSet {
            UserDefaults.standard.set(includeLocation, forKey: "capture.includeLocation")
            if includeLocation { prepareLocation() }
            else { manager.stopUpdatingLocation(); location = nil; locationText = "위치 기록 안 함" }
        }
    }
    @Published private(set) var locationText = "위치 기록 안 함"
    @Published private(set) var status = "촬영한 사진은 이 기기에 저장됩니다."
    @Published private(set) var savedCount = 0
    @Published private(set) var latestRecordURLs: [URL] = []
    private let manager = CLLocationManager()
    private var location: CLLocation?
    private var isActive = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        refreshRecords()
    }

    func activate() {
        isActive = true
        prepareLocation()
    }

    func deactivate() {
        isActive = false
        manager.stopUpdatingLocation()
    }

    func prepareLocation() {
        guard includeLocation, isActive else { return }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            locationText = "GPS 위치 확인 중"
            manager.startUpdatingLocation()
        case .denied, .restricted: locationText = "위치 권한 없음 · 사진만 저장"
        @unknown default: locationText = "위치를 사용할 수 없음 · 사진만 저장"
        }
    }

    func save(image: UIImage) {
        do {
            let id = UUID().uuidString
            let folder = try recordsDirectory().appendingPathComponent(id, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let photoURL = folder.appendingPathComponent("ground.jpg")
            let recordURL = folder.appendingPathComponent("record.json")
            let scale = min(1, 2048 / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let normalized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            guard let jpeg = normalized.jpegData(compressionQuality: 0.88) else {
                status = "사진을 저장하지 못했습니다. 다시 촬영해 주세요."
                return
            }
            // Re-encoding raster pixels avoids carrying source-image EXIF metadata.
            try jpeg.write(to: photoURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            let gps: LocationRecord?
            if includeLocation, let location,
               location.horizontalAccuracy >= 0,
               abs(location.timestamp.timeIntervalSinceNow) <= 30 {
                gps = LocationRecord(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                                     horizontalAccuracyMeters: location.horizontalAccuracy, recordedAt: location.timestamp)
            } else {
                gps = nil
            }
            let record = PhotoRecord(id: id, capturedAt: Date(), photoFile: "ground.jpg", location: gps)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(record).write(to: recordURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            latestRecordURLs = [photoURL, recordURL]
            refreshRecords()
            status = gps == nil ? "사진을 기기에 저장했습니다. GPS는 기록되지 않았습니다." : "사진과 GPS를 기기에 저장했습니다."
        } catch {
            status = "저장 공간을 확인한 뒤 다시 촬영해 주세요."
        }
    }

    func cameraUnavailable() {
        status = "카메라를 사용할 수 없습니다. 실제 iPhone과 카메라 권한을 확인해 주세요."
    }

    private func recordsDirectory() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
        let folder = base.appendingPathComponent("GroundRecords", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private func refreshRecords() {
        guard let folder = try? recordsDirectory(),
              let records = try? FileManager.default.contentsOfDirectory(at: folder,
                  includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles]) else { return }
        let complete = records.filter { FileManager.default.fileExists(atPath: $0.appendingPathComponent("record.json").path) }
        savedCount = complete.count
        if latestRecordURLs.isEmpty, let last = complete.sorted(by: {
            let left = (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            return left > right
        }).first {
            latestRecordURLs = [last.appendingPathComponent("ground.jpg"), last.appendingPathComponent("record.json")]
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { prepareLocation() }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard includeLocation, isActive, let recent = locations.last, recent.horizontalAccuracy >= 0 else { return }
        location = recent
        locationText = String(format: "GPS 수평 오차 지표 약 %.0f m · 높이 계산에는 쓰지 않음", recent.horizontalAccuracy)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        locationText = "GPS를 받지 못했습니다 · 사진만 저장 가능"
    }
}

struct CameraCaptureView: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.cameraDevice = .rear
        controller.delegate = context.coordinator
        controller.allowsEditing = false
        return controller
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraCaptureView
        init(_ parent: CameraCaptureView) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

struct RecordShareSheet: UIViewControllerRepresentable {
    let urls: [URL]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
