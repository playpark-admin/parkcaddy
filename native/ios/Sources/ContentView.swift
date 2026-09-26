import SwiftUI
import ARKit
import AVFoundation

/// Standalone development shell. Hosts can present GroundMeasurementView directly.
@MainActor
struct ContentView: View {
    var body: some View { GroundMeasurementView() }
}

/// A camera-first feature for presentation from an existing scorecard.
/// The host owns dismissal and decides whether to retain an observed result.
@MainActor
struct GroundMeasurementView: View {
    var onClose: (() -> Void)? = nil
    var onMeasurement: ((TerrainSample) -> Void)? = nil
    @StateObject private var terrain = TerrainSession()
    @StateObject private var capture = FieldCaptureStore()
    @StateObject private var photoCamera = GroundPhotoCamera()
    @StateObject private var research = GroundResearchStore.shared
    @State private var showConsent = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSettings = false
    @State private var showCamera = false
    @State private var isVisible = false

    private var supportsDepth: Bool { terrain.capability == .supported }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if supportsDepth {
                ARContainer(session: terrain).ignoresSafeArea()
            } else {
                GroundPhotoPreview(camera: photoCamera).ignoresSafeArea()
            }
            Image(systemName: "plus")
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(.white).shadow(color: .black, radius: 2)
                .accessibilityHidden(true)
            VStack(spacing: 12) {
                cameraHeader
                Spacer(minLength: 16)
                cameraControls
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .tint(.white)
        .sheet(isPresented: $showSettings) {
            TerrainSettingsView(terrain: terrain, capture: capture, research: research,
                                onPhoto: openPhotoCapture)
        }
        .fullScreenCover(isPresented: $showCamera, onDismiss: resumeCamera) {
            CameraCaptureView { image in capture.save(image: image) }.ignoresSafeArea()
        }
        .alert("연구용 측정 수치를 공유할까요?", isPresented: $showConsent) {
            Button("공유 없이 사용") { research.decideConsent(false); resumeCamera() }
            Button("동의하고 사용") { research.decideConsent(true); resumeCamera() }
        } message: {
            Text("동의하면 높이·거리·관측 품질 수치를 관리자 서버로 자동 전송합니다. 이 iOS 버전은 사진과 GPS를 전송하지 않습니다. 가입이나 매번 전송 조작은 필요 없으며, 설정에서 동의를 철회하고 이 기기의 서버 기록을 삭제할 수 있습니다. 거부해도 측정할 수 있습니다.")
        }
        .onAppear {
            isVisible = true; research.flush()
            if research.consent == .undecided { showConsent = true }
            else { resumeCamera() }
        }
        .onDisappear { isVisible = false; stopCamera() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { resumeCamera(); research.flush() }
            else { stopCamera() }
        }
        .onChange(of: terrain.observationID) { value in
            if value != nil { research.record(terrain) }
        }
        .onChange(of: terrain.latest?.id) { _ in
            if let sample = terrain.latest { onMeasurement?(sample) }
        }
    }

    private var cameraHeader: some View {
        HStack(spacing: 8) {
            if onClose != nil {
                Button { stopCamera(); onClose?() } label: {
                    Image(systemName: "xmark").font(.title3.weight(.semibold))
                        .frame(width: 52, height: 52)
                        .background(.black.opacity(0.6), in: Circle())
                }.accessibilityLabel("지면 측정 닫기")
            }
            Text("지면 측정").font(.headline)
                .padding(.horizontal, 14).frame(minHeight: 44)
                .background(.black.opacity(0.6), in: Capsule())
            Spacer()
            Button { showSettings = true } label: {
                Image(systemName: "gearshape").font(.title2)
                    .frame(width: 52, height: 52)
                    .background(.black.opacity(0.6), in: Circle())
            }.accessibilityLabel("설정 및 측정 데이터 분석")
        }.foregroundStyle(.white)
    }

    private var cameraControls: some View {
        VStack(spacing: 8) {
            if supportsDepth {
                Text(terrain.message).font(.headline).multilineTextAlignment(.center)
                    .accessibilityAddTraits(.updatesFrequently)
                if terrain.isCollecting {
                    ProgressView(value: terrain.scanEvidence.repetitionFraction)
                        .tint(.white)
                        .accessibilityLabel("실제 반복 깊이 관측")
                        .accessibilityValue("지점당 최소 \(terrain.scanEvidence.minimumPointFrames)회, 목표 12회")
                    Text("실제 프레임 \(terrain.scanEvidence.distinctFrames)개 · 지점당 최소 \(terrain.scanEvidence.minimumPointFrames)/12회")
                        .font(.subheadline)
                }
                HStack {
                    Text(!terrain.hasDepth ? "유효 깊이 대기" : terrain.scanEvidence.referenceEstablished ? "지면 기준 확인됨" : "지면 기준 확인 중")
                    Spacer()
                    Text("실측 \(terrain.samples.count)/35곳")
                }.font(.subheadline)
                if terrain.trackingReady, let result = terrain.latest {
                    Text(String(format: "%.2f m · %@ %.1f cm", result.distanceMeters,
                                result.relativeHeightMeters >= 0 ? "높음" : "낮음", abs(result.relativeHeightMeters) * 100))
                        .font(.title3.bold()).minimumScaleFactor(0.75)
                        .accessibilityLabel("관측된 가운데 근처 지점의 기준점 대비 수평 거리 및 높이")
                }
            } else {
                Text("이 iPhone에서는 자동 높이 측정을 지원하지 않습니다")
                    .font(.headline).multilineTextAlignment(.center)
                Text(photoCamera.isRunning ? "LiDAR 깊이 정보가 없어 카메라 화면만 표시합니다." : photoCamera.status)
                    .font(.subheadline).multilineTextAlignment(.center)
            }
        }
        .foregroundStyle(.white).padding(14)
        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 16))
    }
    private func resumeCamera() {
        guard isVisible, scenePhase == .active, !showCamera, research.consent != .undecided else { return }
        capture.activate()
        if supportsDepth {
            if !terrain.isRunning { terrain.start() }
        } else { photoCamera.start() }
    }

    private func stopCamera() {
        terrain.pause()
        photoCamera.stop()
        capture.deactivate()
    }

    private func openPhotoCapture() {
        guard supportsDepth else {
            photoCamera.takePhoto { capture.save(image: $0) }
            showSettings = false
            return
        }
        guard UIImagePickerController.isSourceTypeAvailable(.camera),
              AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            capture.cameraUnavailable(); return
        }
        showSettings = false
        terrain.pause()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            guard isVisible, scenePhase == .active else { return }
            showCamera = true
        }
    }


}

struct ARContainer: UIViewRepresentable {
    let session: TerrainSession
    func makeUIView(context: Context) -> ARSCNView { session.sceneView }
    func updateUIView(_ view: ARSCNView, context: Context) {}
}

@MainActor
private struct TerrainSettingsView: View {
    @ObservedObject var terrain: TerrainSession
    @ObservedObject var capture: FieldCaptureStore
    @ObservedObject var research: GroundResearchStore
    let onPhoto: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("사용자 설정") {
                    NavigationLink("높이 기준 · 보정") { calibrationSettings }
                    NavigationLink("측정 조건 · 안내") { measurementSettings }
                    NavigationLink("기록 · 위치 · 개인정보") { recordSettings }
                }
                Section("측정 연구") {
                    NavigationLink("실제 관측 데이터 · 분석") { TerrainAnalysisView(terrain: terrain) }
                    NavigationLink("계산식 · 물리적 한계") { measurementPrinciples }

                }
                Section {
                    Text("스코어카드에 넣을 지면 확인 화면입니다. 현재는 시험 앱에서 실행하며, 실제 스코어카드 연결은 별도 단계입니다.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("지면 측정 설정").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() }.font(.headline) } }
        }.tint(Color(red: 0.1, green: 0.35, blue: 0.27))
    }

    private var calibrationSettings: some View {
        Form {
            Section("높이 기준") {
                Label("자동 확인한 지면 기준 = 0 cm", systemImage: "mappin")
                Text("높낮이는 같은 카메라 세션 안에서 기준점과 비교합니다. 해발고도나 GPS 고도가 아닙니다.")
                Button("기준점 초기화") { terrain.resetOrigin() }.disabled(terrain.origin == nil)
            }
            Section("카메라 기본 높이") {
                Text(String(format: "휴대폰을 든 높이 참고값 %.1f m", terrain.expectedCameraHeightMeters)).font(.headline)
                Slider(value: $terrain.expectedCameraHeightMeters, in: 0.7...1.8, step: 0.1)
                    .accessibilityLabel("지면에서 휴대폰까지의 대략적인 높이")
                Text("거리와 높이는 LiDAR 실제 깊이로 계산합니다. 촬영 높이 참고값은 높은 물체를 지면으로 오인하지 않도록 ±30 cm 범위의 지면 후보를 고르는 데만 사용합니다. 측정 좌표에 비율로 곱하지 않습니다.")
                Text("사진만 기록하는 기기에서는 촬영 높이를 입력해도 정밀 고저차를 구할 수 없어 높낮이를 미측정으로 남깁니다.")
            }
            Section("사용자가 맞출 조건") {
                Text("잔디를 비추면 넓은 지면 후보를 자동 확인하고 반복 관측합니다. 관측 중에는 잠시 같은 곳을 유지하세요. 기준은 30초마다 자동 갱신하며 깊이·추적이 끊기면 표시를 지우고 자동 복구합니다.")
                Text("현재 버전은 기준자에 의한 장치별 편향 보정을 아직 제공하지 않습니다.")
            }
        }.navigationTitle("높이 기준 · 보정").navigationBarTitleDisplayMode(.inline)
    }

    private var measurementSettings: some View {
        Form {
            Section("측정 조건") {
                Picker("최소 센서 품질", selection: $terrain.minimumConfidence) {
                    Text("높음 · 권장").tag(2)
                    Text("보통 이상 · 시험용").tag(1)
                }
                Text(String(format: "카메라에서 최대 %.1f m", terrain.maxRangeMeters))
                Slider(value: $terrain.maxRangeMeters, in: 1...5, step: 0.5)
                    .accessibilityLabel("최대 측정 거리")
                Text("조건을 바꾸면 지면 기준을 자동으로 다시 확인합니다. 센서 품질 등급은 정확도 확률이 아니며 기본 3 m는 운영 범위입니다.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("사용 안내") {
                Toggle("음성으로 결과 안내", isOn: $terrain.spokenGuidance)
                Text("글자는 iPhone의 글자 크기 설정을 따릅니다. 주황 점은 기준보다 높음, 파랑 점은 낮음, 초록 점은 ±1.5 cm 이내입니다. 점의 색은 정확도 등급이 아닙니다.")
            }
        }.navigationTitle("측정 조건 · 안내").navigationBarTitleDisplayMode(.inline)
    }

    private var recordSettings: some View {
        Form {
            Section("촬영 · 위치") {
                Toggle("사진에 GPS 위치 기록", isOn: $capture.includeLocation)
                Text(capture.locationText).font(.subheadline)
                Text("GPS는 구장 검색에만 사용합니다. GPS 고도로 지면의 높낮이를 계산하지 않습니다.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("참고 사진 기록하기", action: onPhoto)
                if terrain.capability == .supported {
                    Text("사진 촬영 후에는 새 측정 세션에서 지면 기준을 자동 확인합니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("관리자 연구용 측정 수치") {
                Toggle("측정 수치 자동 공유", isOn: Binding(get: { research.consent == .enabled }, set: research.decideConsent))
                Text("동의한 경우 통과한 관측의 높이·거리·센서 품질만 최소 30초 간격으로 자동 전송합니다. 관리자가 원자료를 확인하며 사용자에게 전송 목록을 표시하지 않습니다. 사진과 GPS는 서버로 전송하지 않습니다.")
                    .font(.footnote).foregroundStyle(.secondary)
                Text(research.status).font(.subheadline)
                Button("공유 중지 및 이 기기의 서버 기록 삭제", role: .destructive) { research.revokeAndDelete() }
                Text("끄면 새 전송이 즉시 중지됩니다. 수치 자료는 연결되는 대로 삭제하며, 늦은 재전송을 막는 최소 문서 ID 삭제 표식만 서버에 남습니다. 앱 재설치로 삭제용 기록이 사라진 자료는 관리자에게 삭제를 요청해야 합니다.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("기기 내 사진") {
                Text(capture.status)
                Text("사진과 선택한 GPS는 이 기기에만 저장됩니다. 서버에 누적하는 자료는 위에서 동의한 측정 수치입니다.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("여러 사람의 관측") {
                Text("사진을 누적하는 것만으로 정밀도가 보장되지는 않습니다. 공통 기준점, 촬영 자세, 장치별 편향, 좌표 정합을 확인한 뒤 결합해야 합니다. 현재 사진의 높낮이는 미측정으로 저장합니다.")
            }
        }.navigationTitle("기록 · 위치 · 개인정보").navigationBarTitleDisplayMode(.inline)
    }

    private var measurementPrinciples: some View {
        Form {
            Section("측정 좌표와 단위") {
                Text("LiDAR 깊이 d는 카메라 평면에서의 거리(m)입니다. 카메라 내부 파라미터 fx, fy, cx, cy와 깊이 픽셀 u, v로 3D 위치를 계산합니다.")
                Text("p = Tcamera × [(u−cx)d/fx, −(v−cy)d/fy, −d, 1]").font(.system(.body, design: .monospaced))
                Text("ARKit 중력 기준 로컬 좌표의 y축이 위쪽입니다. 세션의 좌표는 지리 좌표나 해발고도가 아닙니다. 일반 사진 모드에서는 이 계산에 필요한 깊이가 없습니다.")
            }
            Section("높낮이 · 거리 · 경사") {
                Text("Δh = 대상 y − 기준 y\nL = √(Δx² + Δz²)\n평균 경사(%) = 100 × Δh / L").font(.system(.body, design: .monospaced))
                Text("L이 20 cm 미만이면 경사를 표시하지 않습니다. 두 점 사이 평균 경사는 그 사이 전체 지면 굴곡을 뜻하지 않습니다. GPS 고도나 미관측 보간값은 사용하지 않습니다.")
            }
            Section("빠른 반복 관측과 보정") {
                Text("지면 기준은 촬영 높이 조건과 주변 8곳 중 최소 7곳의 실측 깊이, 30 cm 이상의 수평 범위로 확인합니다. 이웃 높이 차는 12 cm 이내이며 국소 법선 필터도 통과해야 합니다. 이는 물체 의미 분류가 아닌 기하학적 후보 제외입니다. 낮고 넓은 물체를 항상 구분한다고 보장하지 않습니다.")
                Text("동일 지점을 다른 프레임에 재투영해 비교합니다. 최소 70 ms 간격, 목표 12회, 2.5초 제한이며 공간 이상값 제외 후 8회 이상을 요구합니다.")
                Text("좌표별 중앙값 c를 구한 뒤 r = median(‖pᵢ−c‖)를 계산합니다. r > 25 mm이면 거부하고 max(10 mm, 3r) 밖의 점을 제외합니다. 이 방사 편차는 1차원 MAD나 표준편차와 다릅니다.")
                Text("통과한 관측의 타임스탬프만 최신성에 사용합니다. 최근 프레임이 제외되었으면 이전 관측을 새 값처럼 표시하지 않습니다.")
            }
            Section("정확도 해석") {
                Text("반복 산포는 재현성을 나타냅니다. 깊이·자세의 공통 편향과 잔디 잎 표면 오차는 남을 수 있습니다. 서로 다른 프레임도 상관될 수 있어 1/√N의 개선이나 절대 오차 상한을 보장하지 않습니다.")
                Text("자세 오차를 1°로 가정하면 수평 3 m에서 높이 오차 항은 3 × tan(1°) ≈ 5.2 cm입니다. 이론적 예시이며 현재 기기의 실측 오차 추정은 아닙니다.")
                Text("정확도는 미검증입니다. 표시 소수점, 품질 등급, 작은 산포만으로 실제 cm급 정확도를 판정할 수 없습니다. 관측 표면은 잔디 밑 흙면과 다를 수 있습니다.")
            }
        }
        .textSelection(.enabled).navigationTitle("계산식 · 물리적 한계").navigationBarTitleDisplayMode(.inline)
    }
}

private struct TerrainAnalysisView: View {
    @ObservedObject var terrain: TerrainSession

    var body: some View {
        Form {
            Section("실제 관측 상태") {
                LabeledContent("추적", value: terrain.trackingText)
                LabeledContent("지점당 반복 관측 최소", value: "\(terrain.scanEvidence.minimumPointFrames) / 12회")
                LabeledContent("진행 중 통과 지점", value: "\(terrain.scanEvidence.validPoints)곳")
                LabeledContent("깊이 입력", value: terrain.capability == .supported ? "원시 sceneDepth" : "사용 불가 · 사진 기록")
                LabeledContent("깊이 해상도", value: terrain.diagnostics.depthResolution)
                LabeledContent("깊이 픽셀 조회 횟수", value: "\(terrain.diagnostics.attempted)")
                LabeledContent("최종 통과한 지점", value: "\(terrain.diagnostics.accepted)")
                LabeledContent("서로 다른 프레임", value: "\(terrain.diagnostics.uniqueFrames)")
                Text("조회 횟수와 통과 지점은 서로 다른 단위입니다. 프레임 수는 독립 표본 수나 성공률을 뜻하지 않습니다.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("반복성 · 최신성") {
                if let spread = terrain.diagnostics.repeatSpreadMeters {
                    LabeledContent("중앙 방사 편차 r", value: String(format: "%.1f mm", spread * 1000))
                } else { Text("반복 산포: 아직 유효 관측 없음") }
                Text("r = median(‖pᵢ−좌표별 중앙값‖). 여러 지점 관측 시 가장 큰 r을 표시합니다. 표준편차, 절대 정확도, 오차 상한이 아닙니다.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let timestamp = terrain.diagnostics.frameTimestamp {
                    LabeledContent(terrain.diagnostics.accepted > 0 ? "통과 관측 시각" : "입력 프레임 시각", value: String(format: "%.3f s", timestamp))
                    Text("부팅 기준 단조 시간입니다. 통과한 지점이 있으면 가장 오래된 통과 관측 시각이며, 없으면 시도에 사용한 입력 프레임 시각입니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else { Text("통과 관측 시각: 없음") }
            }
            Section("계산 결과") {
                if let origin = terrain.origin { Text(String(format: "기준점 (x, y, z) = (%.3f, %.3f, %.3f) m", origin.x, origin.y, origin.z)) }
                if let result = terrain.latest {
                    Text(String(format: "대상점 (x, y, z) = (%.3f, %.3f, %.3f) m", result.worldPosition.x, result.worldPosition.y, result.worldPosition.z))
                    LabeledContent("수평 거리 L", value: String(format: "%.3f m", result.distanceMeters))
                    LabeledContent("상대 높이 Δh", value: String(format: "%+.2f cm", result.relativeHeightMeters * 100))
                    LabeledContent("두 점 평균 경사", value: result.slopePercent.map { String(format: "%+.2f %%", $0) } ?? "기준선 20 cm 미만")
                } else { Text("기준점과 대상점을 관측하면 실제 계산 결과를 표시합니다.") }
                Text("세션 로컬 좌표입니다. 다른 세션·다른 사람의 좌표와 직접 비교하지 않습니다.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("상세 센서 진단") {
                Toggle("원시 진단 항목 표시", isOn: $terrain.debugMode)
                if terrain.debugMode {
                    if let depth = terrain.diagnostics.lastSensorDepth {
                        LabeledContent("대표 통과 관측 깊이 z", value: String(format: "%.4f m", depth))
                    }
                    if let confidence = terrain.diagnostics.lastConfidence {
                        LabeledContent("통과 관측 최소 품질", value: "\(confidence) / 2")
                    }
                    if let tilt = terrain.diagnostics.lastLocalTilt {
                        LabeledContent("대표 관측 근방 기울기", value: String(format: "%.1f°", tilt))
                    }
                    Text("품질 0/1/2는 낮음/보통/높음 등급이며 확률이 아닙니다. 깊이·기울기는 대표 통과 관측 값으로 최종 집계 좌표와 구분합니다. 근방 기울기는 지면 후보 제외용이며 최종 두 점 경사가 아닙니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                    ForEach(terrain.diagnostics.rejected.keys.sorted(), id: \.self) { reason in
                        Text("제외 \(terrain.diagnostics.rejected[reason] ?? 0)회 · \(reason)")
                    }
                }
            }
        }
        .textSelection(.enabled).navigationTitle("실제 관측 데이터").navigationBarTitleDisplayMode(.inline)
    }
}
