import AVFoundation
import Combine
import SwiftUI
import UIKit

/// Plain full-screen camera for devices that cannot provide metric scene depth.
/// Capture runs off the main thread; saved photos remain in FieldCaptureStore.
final class GroundPhotoCamera: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    @Published private(set) var isRunning = false
    @Published private(set) var isCapturing = false
    @Published private(set) var status = "카메라 준비 중"
    private let queue = DispatchQueue(label: "app.playpark.ground.camera")
    private let output = AVCapturePhotoOutput()
    private var configured = false
    private var active = false
    private var onPhoto: ((UIImage) -> Void)?
    var orientation: AVCaptureVideoOrientation = .portrait

    func start() {
        active = true
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: startAuthorized()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.active else { return }
                    if granted { self.startAuthorized() }
                    else { self.status = "설정 앱에서 카메라 사용을 허용해 주세요." }
                }
            }
        default: status = "설정 앱에서 카메라 사용을 허용해 주세요."
        }
    }

    private func startAuthorized() {
        queue.async { [weak self] in
            guard let self else { return }
            if !self.configured {
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                      let input = try? AVCaptureDeviceInput(device: device) else {
                    DispatchQueue.main.async { self.status = "후면 카메라를 사용할 수 없습니다." }
                    return
                }
                self.session.beginConfiguration()
                self.session.sessionPreset = .photo
                guard self.session.canAddInput(input), self.session.canAddOutput(self.output) else {
                    self.session.commitConfiguration()
                    DispatchQueue.main.async { self.status = "카메라를 시작할 수 없습니다." }
                    return
                }
                self.session.addInput(input)
                self.session.addOutput(self.output)
                self.session.commitConfiguration()
                self.configured = true
            }
            if !self.session.isRunning { self.session.startRunning() }
            let running = self.session.isRunning
            DispatchQueue.main.async {
                guard self.active else { return }
                self.isRunning = running
                self.status = running ? "사진 기록 준비됨" : "카메라를 다시 시작해 주세요."
            }
        }
    }

    func stop() {
        active = false
        isRunning = false
        queue.async { [weak self] in
            guard let self else { return }
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    func takePhoto(onImage: @escaping (UIImage) -> Void) {
        guard active, isRunning, !isCapturing else { return }
        isCapturing = true
        onPhoto = onImage
        let captureOrientation = orientation
        queue.async { [weak self] in
            guard let self else { return }
            if let connection = self.output.connection(with: .video), connection.isVideoOrientationSupported {
                connection.videoOrientation = captureOrientation
            }
            self.output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let image = error == nil ? photo.fileDataRepresentation().flatMap(UIImage.init(data:)) : nil
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isCapturing = false
            if let image { self.onPhoto?(image); self.status = "사진을 기록했습니다." }
            else { self.status = "촬영하지 못했습니다. 다시 시도해 주세요." }
            self.onPhoto = nil
        }
    }
}

struct GroundPhotoPreview: UIViewRepresentable {
    let camera: GroundPhotoCamera
    func makeUIView(context: Context) -> GroundCameraPreviewView {
        let view = GroundCameraPreviewView()
        view.camera = camera
        view.preview.session = camera.session
        view.preview.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ view: GroundCameraPreviewView, context: Context) { view.setNeedsLayout() }
}

final class GroundCameraPreviewView: UIView {
    weak var camera: GroundPhotoCamera?
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard let interface = window?.windowScene?.interfaceOrientation,
              let orientation = AVCaptureVideoOrientation(rawValue: interface.rawValue) else { return }
        if let connection = preview.connection, connection.isVideoOrientationSupported {
            connection.videoOrientation = orientation
        }
        camera?.orientation = orientation
    }
}
