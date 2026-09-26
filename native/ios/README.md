# ParkCaddy iOS — 지면 관측 시험판

iOS 16 이상 SwiftUI 앱입니다. Android와 함께 현장 검증을 진행하는 플랫폼입니다.
이번 수정 전 원본 백업은 상위 backups/prototype-20260927-042941/parkcaddy-pages-deploy/native/ios 아래에 있습니다.

## 구현 범위

- **LiDAR 지원 기기:** ARKit sceneDepth.depthMap와 픽셀별 confidenceMap을 직접 읽습니다. 추정 평면 raycast와 고정 high 값은 사용하지 않습니다.
- 화면 중앙 십자선으로 기준점을 정한 후 대상점을 측정합니다. 수평 거리, 상대 높이, 두 점 사이 평균 경사를 표시합니다.
- **반복 관측:** 기준점, 대상점, 주변 35곳 모두 다른 프레임을 반복 수집합니다. 최초 관측의 세계 좌표를 각 프레임 카메라로 다시 투영하여 같은 지점을 비교합니다.
- 프레임 간 최소 70 ms, 목표 12개 관측, 2.5초 제한입니다. 최소 8개 관측이 필요합니다. 같은 프레임 타임스탬프를 중복 집계하지 않습니다.
- 좌표별 중앙값과 방사 거리의 중앙편차로 이상치를 제외합니다. 중앙편차가 2.5 cm를 넘으면 결과를 내지 않습니다. 중앙편차 3배 또는 1 cm 중 큰 값을 벗어난 점을 제외한 후에도 8개 이상을 요구합니다.
- 위 수치는 **운영 중 거부 기준**이며 실제 정확도의 보장 범위가 아닙니다. 반복 프레임의 상관, 카메라 자세/깊이 편향, 잔디 표면 오차는 이 과정으로 제거되었다고 주장하지 않습니다.
- 관측 점 색은 기준 높이와의 차이를 나타냅니다. 초록의 ±1.5 cm 구분은 표시 규칙이며 정밀도 보장이 아닙니다. 미관측 구간은 채우지 않습니다.
- **LiDAR가 없는 기기:** 사진 기록, 선택 GPS, 기기 내 저장, 사진/JSON 내보내기를 지원합니다. 높낮이는 unmeasured로 기록합니다.
- 큰 버튼, 시스템 글자 크기, 한국어 음성 안내, 설정과 실제 계산 디버그가 연결되어 있습니다.
- 카메라 권한, 추적 불안정, 세션 중단, 오래된 프레임, 깊이 미수신, 낮은 센서 품질을 차단합니다. 추적이 끊기면 기준점과 숫자를 지워 서로 다른 좌표계를 섞지 않습니다.
- 서버 자동 전송, 누적 정합, 측량 등급 정확도, 공 인식/궤적은 **구현 완료로 표시하지 않습니다.**

## 측정식과 물리적 한계

ARKit 깊이는 카메라 평면으로부터의 거리 d입니다. 화면 점을 프레임 displayTransform의 역변환으로 카메라 이미지 좌표에 맞추고, 깊이 해상도에 맞게 내부 파라미터를 축소합니다.

    camera = ((u-cx)d/fx, -(v-cy)d/fy, -d)
    world = cameraTransform × (camera, 1)
    height = target.y - origin.y
    horizontalDistance = sqrt((target.x-origin.x)^2 + (target.z-origin.z)^2)
    meanSlopePercent = 100 × height / horizontalDistance

ARKit 카메라는 -Z 방향을 바라보며, 카메라 이미지의 아래쪽 v축과 ARKit의 위쪽 y축 부호가 다릅니다.
세계 좌표는 중력에 정렬합니다. 짧은 기준선(<20 cm)에서는 경사율을 숨깁니다.
국소 표면 법선으로 35° 이하이고 카메라보다 15 cm 이상 아래인 점을 지면 후보로 고릅니다.
이는 벽/경계 제외를 위한 휴리스틱입니다. 식생·흙·공을 분류하는 모델이 아니며 잔디 밑 흙면을 측정한다고 주장하지 않습니다.
깊이 버퍼는 각 행의 실제 바이트 간격과 픽셀 포맷을 검사하여 읽습니다.

confidenceMap의 low/medium/high는 센서 품질 등급입니다. 정확도 확률, 표준편차, cm 오차 상한으로 변환하지 않습니다.
기본 3 m 범위와 high 품질 조건은 보수적인 시험 설정일 뿐 검증된 정확도 보증 조건이 아닙니다.
예시로 자세 오차 1°를 가정하면 3 m 수평 기준선에 대한 높이 오차 항은 3 × tan(1°) ≈ 5.2 cm입니다.
현재 기기의 실제 자세 오차를 측정하지 않았으므로 이 수치는 현재 측정의 오차 상한이 아닙니다.
여러 프레임의 산포가 작아도 공통 편향은 남을 수 있습니다. 프레임 수의 제곱근에 비례한 정확도 개선을 보장하지 않습니다.

## 사진·GPS 기록

사진은 최대 긴 변 2048 픽셀로 다시 그려 JPEG로 저장하며 원본 EXIF를 넘기지 않습니다.
위치 기록은 사용자가 켰을 때만 요청하며, 사진 저장 시 유효하고 최근 30초 이내인 위치만 JSON에 넣습니다.
위치의 수평 오차 지표와 관측 시각을 함께 기록하며 GPS 고도를 지면 계산에 쓰지 않습니다.

저장 위치는 앱 Application Support의 GroundRecords/<UUID>/ground.jpg 및 record.json입니다.
최근 기록 내보내기는 iOS 공유 화면을 사용합니다. 자동 업로드, 자동 타인 공유는 없습니다.
앱 삭제 시 로컬 기록도 사라질 수 있으므로 필요한 기록은 내보냅니다.

**현재 native iOS에는 Firebase 로그인·업로드가 연결되지 않았습니다.** 사진 기록 화면에도 이 상태를 표시합니다.
후속 업로드 작업에서는 사용자 동의, 인증, 재시도 대기열, 서버 규칙, 구장/홀 ID, 촬영 기준점과 좌표계 정합 메타데이터를 연결해야 합니다.
현재 JPEG/GPS 기록만 합쳐 고저차 정확도가 향상된다고 주장해서는 안 됩니다.

## macOS에서 빌드·테스트

Windows 작업 환경에는 Xcode/Swift/XcodeGen이 없어 여기서 iOS 빌드·실기기 테스트를 실행하지 못했습니다.
아래 절차는 macOS에서 실행해야 합니다.

1. Xcode와 XcodeGen을 준비합니다.
2. 이 디렉터리에서 xcodegen generate를 실행합니다.
3. ParkCaddyAR.xcodeproj를 열고 Signing Team을 선택합니다.
4. Xcode에서 사용 가능한 시뮬레이터 대상으로 ParkCaddyAR scheme의 Test를 실행합니다. DepthGeometryTests는 내부 파라미터 축소, 축 부호, 좌표 변환, 수평 거리, 경사 부호, 잘못된 깊이, 반복 중앙값/이상치, 관측 부족, 공통 편향 잔존을 검증하도록 작성되어 있습니다.
5. 카메라·AR·깊이·GPS 동작은 실제 iPhone에서 확인합니다. 시뮬레이터 성공이 센서 검증을 대체하지 않습니다.

### 실기기 합격 조건

- LiDAR 기기와 일반 iPhone 각각에서 실행/권한 거부/복귀를 확인합니다.
- 세로/가로 화면에서 십자선과 실제 관측점이 일치하는지 검증합니다.
- 기준자 또는 검증된 측량 기준으로 0.5/1/2/3 m 거리와 0/±2/±5/±10 cm 높이 차이를 여러 번 비교합니다.
- 맑음/그늘/젖은 잔디/바람/경계 조건에서 누락률, 편향, 반복 산포, 절대 오차를 각각 기록합니다.
- 반복 중 손 떨림, 화면 이탈, 프레임 정지, 2.5초 시간초과에서 잘못된 성공이 없는지 확인합니다.
- 추적 손실 후 숫자와 점이 사라지고 새로운 기준점을 요구하는지 확인합니다.
- GPS 꺼짐/권한 거부/30초 경과 시 위치가 저장되지 않는지 확인합니다.
- 사진만 기록한 일반 iPhone에서 정밀 높낮이가 표시되지 않는지 확인합니다.
- 여러 사용자 자료 정합은 공통 기준점과 장치별 보정 후 별도 시험합니다.

## 공식 근거

- [Apple: Displaying a point cloud using scene depth](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth)
- [Apple: ARDepthData](https://developer.apple.com/documentation/arkit/ardepthdata)
- [Apple: confidenceMap](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap)
- [Apple: ARCamera](https://developer.apple.com/documentation/arkit/arcamera)
- [Apple: ARFrame](https://developer.apple.com/documentation/arkit/arframe)

Apple 문서는 LiDAR scene depth와 confidence의 의미를 설명합니다. 파크골프 잔디에 대한 특정 cm 정확도를 보증하는 근거로 사용하지 않습니다.
