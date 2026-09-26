import SwiftUI
import ARKit
import AVFoundation

struct ContentView: View {
    @StateObject private var terrain = TerrainSession()
    @StateObject private var capture = FieldCaptureStore()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSettings = false
    @State private var showCamera = false
    @State private var showShare = false
    @State private var selection = 0

    var body: some View {
        TabView(selection: $selection) {
            measurementView
                .tabItem { Label("지면 측정", systemImage: "viewfinder") }.tag(0)
            collectionView
                .tabItem { Label("사진 기록", systemImage: "camera.fill") }.tag(1)
        }
        .tint(Color(red: 0.05, green: 0.40, blue: 0.27))
        .sheet(isPresented: $showSettings) { TerrainSettingsView(terrain: terrain) }
        .sheet(isPresented: $showCamera) {
            CameraCaptureView { image in capture.save(image: image) }.ignoresSafeArea()
        }
        .sheet(isPresented: $showShare) { RecordShareSheet(urls: capture.latestRecordURLs) }
        .onChange(of: selection) { value in
            if value == 1 { terrain.pause(); capture.activate() }
            else { capture.deactivate() }
        }
        .onChange(of: scenePhase) { value in
            if value != .active { terrain.pause(); capture.deactivate() }
            else if selection == 1 { capture.activate() }
        }
    }

    private var measurementView: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("파크캐디").font(.title2.bold())
                    Text("지면 높낮이 · 1단계 시험판").font(.subheadline)
                }
                Spacer()
                Button { showSettings = true } label: {
                    Label("설정", systemImage: "gearshape.fill").font(.headline).padding(12)
                }.accessibilityLabel("측정 설정 열기")
            }.padding(.horizontal)
            if terrain.capability == .supported {
                cameraPanel
                ScrollView {
                    VStack(spacing: 12) {
                        Text(terrain.message)
                            .font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityAddTraits(.updatesFrequently)
                        if terrain.isCollecting { ProgressView("반복 관측 비교 중").font(.headline) }
                        if terrain.trackingReady, let result = terrain.latest {
                            resultCard(result)
                        }
                        if !terrain.isRunning {
                            largeButton("측정 시작", icon: "camera.viewfinder", action: terrain.start)
                        } else if terrain.origin == nil {
                            largeButton("① 이곳을 기준점으로", icon: "mappin.circle.fill", action: terrain.captureOrigin)
                                .disabled(!terrain.canMeasure)
                        } else {
                            largeButton("② 이곳 측정", icon: "scope", action: terrain.captureTarget)
                                .disabled(!terrain.canMeasure)
                            HStack {
                                Button("주변 35곳 보기", action: terrain.captureGrid)
                                    .buttonStyle(.bordered).frame(maxWidth: .infinity, minHeight: 52)
                                    .disabled(!terrain.canMeasure)
                                Button("기준점 다시", action: terrain.resetOrigin)
                                    .buttonStyle(.bordered).frame(maxWidth: .infinity, minHeight: 52)
                            }.font(.headline)
                        }
                        Text("가까운 잔디를 비추세요. 주황 점은 기준보다 높음, 파랑 점은 낮음, 초록 점은 ±1.5 cm 이내입니다. 빈 곳은 미측정입니다.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Text("표시 단위와 실제 정확도는 다릅니다. 점의 색은 정확도를 뜻하지 않습니다. 현장 기준자 검증 전에는 정밀도를 보장하지 않습니다.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if terrain.debugMode { TerrainDebugView(terrain: terrain) }
                    }.padding()
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        Image(systemName: "camera.fill").font(.system(size: 54)).foregroundStyle(.green)
                        Text("이 iPhone에서는\n사진으로 기록하세요").font(.largeTitle.bold())
                        Text(terrain.capability == .noSceneDepth
                             ? "이 기기에는 ARKit LiDAR 깊이 측정이 없습니다. 사진과 GPS 기록은 사용할 수 있습니다."
                             : "이 기기는 AR 공간 추적을 지원하지 않습니다. 사용 가능한 카메라로 사진을 기록할 수 있습니다.")
                            .font(.title3)
                        Text("일반 사진과 GPS만으로 잔디의 센티미터 높낮이를 표시하지 않습니다. 정밀 지면 측정에는 LiDAR 지원 기기와 현장 검증이 필요합니다.")
                            .font(.body)
                        largeButton("사진 기록으로 이동", icon: "camera", action: { selection = 1 })
                    }.padding(24)
                }
            }
        }
        .background(Color(.systemBackground))
    }

    private var cameraPanel: some View {
        ZStack {
            ARContainer(session: terrain)
            Image(systemName: "plus")
                .font(.system(size: 34, weight: .medium)).foregroundStyle(.white)
                .shadow(color: .black, radius: 2)
                .accessibilityHidden(true)
            VStack {
                HStack {
                    Label(terrain.trackingText, systemImage: terrain.canMeasure ? "checkmark.circle.fill" : "hourglass")
                        .font(.headline).padding(10)
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(.white)
                    Spacer()
                }
                Spacer()
                Text("가운데 + 를 잔디에 맞추세요")
                    .font(.headline).padding(8).background(.black.opacity(0.7), in: Capsule()).foregroundStyle(.white)
            }.padding(12)
        }
        .frame(height: 260)
        .clipped()
        .accessibilityLabel("후면 카메라. 화면 가운데 십자선을 기준으로 측정합니다.")
    }

    private func resultCard(_ sample: TerrainSample) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("관측 결과 · 기준점과 비교").font(.headline)
            Text(String(format: "거리 %.2f m", sample.distanceMeters)).font(.largeTitle.bold()).minimumScaleFactor(0.65)
            Text(String(format: "%@ %.1f cm", sample.relativeHeightMeters >= 0 ? "높음" : "낮음",
                        abs(sample.relativeHeightMeters) * 100)).font(.title.bold())
            if let slope = sample.slopePercent {
                Text(String(format: "두 점 사이 평균 경사 %+.1f %%", slope)).font(.headline)
            } else {
                Text("기준점과 20 cm 이상 떨어져야 평균 경사를 표시합니다.").font(.subheadline)
            }
            Text("수평 거리와 상대 높이입니다. 두 점 사이의 굴곡 전체를 측정한 값은 아닙니다.")
                .font(.subheadline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding().background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
    }

    private var collectionView: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("잔디를 사진으로 기록").font(.largeTitle.bold())
                    Text("LiDAR가 없어도 사용할 수 있습니다. 구장과 잔디의 상태를 여러 방향에서 남겨 주세요.")
                        .font(.title3)
                    Toggle("위치도 함께 기록", isOn: $capture.includeLocation).font(.title3).padding(.vertical, 10)
                    Text(capture.locationText).font(.headline)
                    Text("GPS는 구장을 찾는 데만 사용합니다. GPS 높이로 지면의 고저차를 계산하지 않습니다.")
                        .foregroundStyle(.secondary)
                    largeButton("잔디 사진 찍기", icon: "camera.fill", action: openCamera)
                    Text(capture.status).font(.headline)
                    Text("기기에 저장된 기록 \(capture.savedCount)개").font(.subheadline)
                    if !capture.latestRecordURLs.isEmpty {
                        largeButton("최근 기록 내보내기", icon: "square.and.arrow.up", action: { showShare = true })
                    }
                    Text("사진과 위치 파일은 이 기기에 저장됩니다. 이 iOS 시험판의 서버 자동 전송은 아직 연결되지 않았습니다. 내보내기로 저장하거나 공유할 수 있습니다.")
                        .foregroundStyle(.secondary)
                    Text("사진의 높낮이 분석은 미측정으로 기록합니다. 서버에서 함께 맞출 기준점·촬영 조건을 갖추기 전에는 다른 사람의 사진만 합쳐 정확도가 높아졌다고 판단하지 않습니다.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }.padding(24)
            }.navigationTitle("사진 기록").navigationBarTitleDisplayMode(.inline)
        }
    }

    private func largeButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).font(.title3.bold())
                .frame(maxWidth: .infinity, minHeight: 54).padding(.horizontal, 8)
        }.buttonStyle(.borderedProminent)
    }

    private func openCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            capture.cameraUnavailable(); return
        }
        capture.prepareLocation()
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: showCamera = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted { showCamera = true }
                    else { capture.cameraUnavailable() }
                }
            }
        default: capture.cameraUnavailable()
        }
    }
}

struct ARContainer: UIViewRepresentable {
    let session: TerrainSession
    func makeUIView(context: Context) -> ARSCNView { session.sceneView }
    func updateUIView(_ view: ARSCNView, context: Context) {}
}

private struct TerrainSettingsView: View {
    @ObservedObject var terrain: TerrainSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("사용 편의") {
                    Toggle("음성 안내", isOn: $terrain.spokenGuidance)
                    Text("측정 결과를 한국어로 읽습니다. 글자는 iPhone의 글자 크기 설정을 따릅니다.")
                }
                Section("측정 조건") {
                    Picker("최소 센서 품질", selection: $terrain.minimumConfidence) {
                        Text("높음 · 권장").tag(2)
                        Text("보통 이상 · 시험용").tag(1)
                    }
                    Text("센서 품질 등급은 정확도 확률이나 오차 보장이 아닙니다. 기준점은 30초 안에 비교하고, 이후 다시 정합니다.")
                    Text(String(format: "카메라에서 최대 %.1f m", terrain.maxRangeMeters))
                    Slider(value: $terrain.maxRangeMeters, in: 1...5, step: 0.5)
                    Text("기본 3 m는 시험 운영 범위입니다. 먼 거리·햇빛·반사·풀잎 흔들림에서 오차가 커질 수 있습니다. 설정을 바꾸면 기준점을 다시 정합니다.")
                }
                Section("개발 · 현장 검증") {
                    Toggle("디버그 정보 보기", isOn: $terrain.debugMode)
                    Text("실제 깊이, 품질 등급, 관측·제외 수와 계산식을 표시합니다. 이 단계는 정확도 검증용이며 공 궤적 시뮬레이션은 포함하지 않습니다.")
                }
                Section("측정 원리와 한계") {
                    Text("LiDAR 깊이 + 카메라 내부 파라미터로 3D 위치를 구하고, ARKit의 중력 기준 좌표에서 두 점의 높이를 비교합니다.")
                    Text("Δh = 대상점 y − 기준점 y\n수평 거리 = √(Δx² + Δz²)\n평균 경사(%) = 100 × Δh / 수평 거리")
                    Text("예시: 자세 오차가 1°라면 수평 3 m에서 높이 오차 항은 약 5.2 cm입니다. 실제 자세 오차를 확인하지 않았으므로 이 예시는 현재 측정의 오차 상한이 아닙니다.")
                    Text("단계 1: 거리·고저 실측과 기준자 검증\n단계 2: 같은 기준점에 맞춘 다중 관측 결합\n단계 3: 공 인식과 마찰을 보정한 궤적 시험")
                }
            }
            .font(.body)
            .navigationTitle("설정")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() }.font(.headline) } }
        }
    }
}

private struct TerrainDebugView: View {
    @ObservedObject var terrain: TerrainSession

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("실동작 디버그").font(.headline)
            Text("추적: \(terrain.trackingText)")
            Text("원시 sceneDepth · \(terrain.diagnostics.depthResolution)")
            Text("관측 \(terrain.diagnostics.accepted) / 시도 \(terrain.diagnostics.attempted)")
            Text("서로 다른 관측 프레임: \(terrain.diagnostics.uniqueFrames)")
            if let spread = terrain.diagnostics.repeatSpreadMeters { Text(String(format: "반복 산포(중앙 방사편차): %.1f mm · 절대 오차 아님", spread * 1000)) }
            Text("센서 최소 등급: \(terrain.minimumConfidence) · 확률 아님")
            if let depth = terrain.diagnostics.lastSensorDepth {
                Text(String(format: "카메라 평면 기준 깊이 z: %.4f m", depth))
            }
            if let confidence = terrain.diagnostics.lastConfidence { Text("실제 품질 등급: \(confidence) (0 낮음 / 1 보통 / 2 높음)") }
            if let tilt = terrain.diagnostics.lastLocalTilt { Text(String(format: "근방 표면 기울기: %.1f° (지면 후보 필터)", tilt)) }
            if let origin = terrain.origin { Text(String(format: "기준 xyz: %.3f, %.3f, %.3f m", origin.x, origin.y, origin.z)) }
            if let point = terrain.latest?.worldPosition { Text(String(format: "대상 xyz: %.3f, %.3f, %.3f m", point.x, point.y, point.z)) }
            if let timestamp = terrain.diagnostics.frameTimestamp { Text(String(format: "관측 프레임 시간: %.3f s (부팅 기준)", timestamp)) }
            ForEach(terrain.diagnostics.rejected.keys.sorted(), id: \.self) { reason in
                Text("제외 \(terrain.diagnostics.rejected[reason] ?? 0): \(reason)")
            }
            Text("실제 오차: 미검증 · 잔디 밑 흙면이 아닌 관측 표면입니다.")
            Text("p = Tcamera × [(u−cx)d/fx, −(v−cy)d/fy, −d, 1]\n추정 평면·GPS 고도·미관측 보간을 사용하지 않습니다.")
        }
        .font(.system(.caption, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding().background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        .textSelection(.enabled)
    }
}
