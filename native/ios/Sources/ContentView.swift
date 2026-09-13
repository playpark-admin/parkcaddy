import SwiftUI
import ARKit

struct ContentView: View {
    @State private var capability = ARCapability.check()
    @State private var message = "기기 AR 지원을 확인하는 중입니다."
    private let terrain = TerrainSession()

    var body: some View {
        ZStack(alignment: .bottom) {
            ARContainer(session: terrain)
                .ignoresSafeArea()
            VStack(spacing: 12) {
                Text(message).multilineTextAlignment(.center).padding().background(.black.opacity(0.7)).foregroundStyle(.white).cornerRadius(12)
                if capability == .supported {
                    Button("AR 지면 측정 시작") {
                        do { try terrain.start(); message = "추적 준비 중: 지면을 천천히 비추세요." }
                        catch { message = "AR 세션을 시작할 수 없습니다." }
                    }.buttonStyle(.borderedProminent)
                } else {
                    Text(capability == .noSceneDepth ? "LiDAR Scene Depth 지원 기기에서만 지면 고저 히트맵을 사용합니다." : "ARKit world tracking 미지원 기기입니다.")
                        .font(.footnote).foregroundStyle(.white)
                }
            }.padding()
        }.onAppear { message = capability == .supported ? "ARKit·LiDAR 지원 확인됨" : "이 기기에서는 측정 기능을 시작하지 않습니다." }
    }
}

struct ARContainer: UIViewRepresentable {
    let session: TerrainSession
    func makeUIView(context: Context) -> ARSCNView { session.sceneView }
    func updateUIView(_ view: ARSCNView, context: Context) {}
}
