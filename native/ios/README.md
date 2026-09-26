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
- **LiDAR가 없는 기기:** 사진 기록, 선택 GPS, 기기 내 저장, 전체 화면 사진 기록을 지원합니다. 높낮이는 unmeasured로 기록합니다.
- 큰 버튼, 시스템 글자 크기, 한국어 음성 안내를 제공하며 사용자 보정·측정 조건·연구 데이터·물리식은 설정 안에서 분류합니다.
- 카메라 권한, 추적 불안정, 세션 중단, 오래된 프레임, 깊이 미수신, 낮은 센서 품질을 차단합니다. 추적이 끊기면 기준점과 숫자를 지워 서로 다른 좌표계를 섞지 않습니다.
- 최초 동의 후 성공한 AR 관측의 수치를 Firebase로 자동 전송합니다. 사진·GPS 원격 업로드, 누적 정합, 측량 등급 정확도, 공 인식/궤적은 아직 구현 완료로 표시하지 않습니다.

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
사진·GPS는 로컬 저장이며 기본 화면과 설정에는 사용자용 파일 목록·매건 전송 UI가 없습니다. 서버 연구 자료는 별도 동의한 AR 측정 수치에 한정합니다.
앱 삭제 시 로컬 사진 기록도 사라질 수 있습니다.

**Firebase 측정 수치 자동 전송이 연결되어 있습니다.** 원본 사진·GPS 업로드와 구장/홀 ID 기반 공간 정합은 후속 작업입니다.
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

## 카메라 UI와 스코어카드 통합

`GroundMeasurementView(onClose:onMeasurement:)`는 전체 화면 카메라 배경과 안전 영역 안의 최소 조작을 제공합니다. 시험용 `ContentView`는 이 기능만 표시하며 홈·게임·기록 탭은 없습니다. 기존 스코어카드 코드가 이 저장소에 연결되어 있지 않으므로 실제 삽입 완료로 주장하지 않습니다. 호스트는 이 뷰를 전체 화면으로 열고 `onClose`에서 닫으며 `onMeasurement`로 실제 대상점 결과를 받으면 됩니다.

LiDAR 기기는 ARSCNView, 일반 iPhone은 AVCaptureVideoPreviewLayer를 화면 전체에 배치합니다. LiDAR 카메라에는 기준점·관측 점·그리드 연결선·각 지점의 수평 거리와 상대높이가 남습니다. 선은 즉시 이웃하는 실제 통과 그리드 셀끼리만 연결하며 누락된 관측을 채우지 않습니다. 기준점 뒤 상단 그리드 버튼으로 35곳을 관측할 수 있습니다.

설정은 높이 기준/보정, 측정 조건/안내, 기록/위치/개인정보, 실제 관측 데이터, 계산식/한계로 나뉩니다. 미터 단위 깊이에 사용자의 키나 수동 카메라 높이를 곱하지 않습니다. 조회 횟수와 통과 지점 수를 구분하며, 방사 편차 단위는 mm입니다. 센서 confidence는 확률이 아니고 좌표는 세션 로컬 좌표입니다.

## 동의 후 관리자용 자동 누적

최초 실행에서 한 번 선택합니다. 거부해도 측정할 수 있습니다. 동의하면 성공한 기준점·대상점·그리드 관측의 수치만 `parkcaddy-ground-2026/users/{uid}/measurements/{id}`에 자동 저장합니다. 사진과 GPS는 이 경로로 보내지 않습니다. `metadata.photo`와 `metadata.location`은 null이고 `accuracyValidated`는 false입니다. 일반 클라이언트는 목록과 원자료를 읽을 수 없으며 관리자가 Firebase IAM 권한으로 확인합니다.

Firebase REST 익명 인증과 갱신 토큰을 사용하며 인증정보는 iOS Keychain의 ThisDeviceOnly 속성으로 보관합니다. 대기 데이터와 삭제용 문서 ID·owner UID는 기기의 보호된 Application Support JSON에 원자적으로 저장합니다. 업로드 성공 뒤 로컬 원자료는 지우고 삭제용 ID는 보존합니다. 동일 문서 ID로 재전송하며, 서버가 이미 기록한 409 응답은 중복 생성 성공으로 처리합니다.

설정에서 공유를 끄거나 삭제 버튼을 누르면 새 수집을 즉시 중단하고 대기 자료를 지웁니다. 이미 전송한 문서와 진행 중 요청의 삭제는 동일 owner UID의 순차 처리기로 실행합니다. 동의 철회 중 늦게 도착한 업로드 응답이 삭제 요청을 취소하지 않습니다. 삭제는 Firestore 원자적 commit으로 수치 문서를 지우고 `measurementDeletions/{id}`에 `{deleted:true}` 표식을 함께 기록합니다. 서버 규칙은 해당 표식이 있는 ID의 후속 생성을 거부하므로, 먼저 출발했거나 재실행 후 늦게 도착한 전송도 자료를 복구할 수 없습니다. 수치 자료는 삭제되고 최소 문서 ID 삭제 표식만 서버에 남습니다. commit 성공 응답을 받은 뒤에는 불확실했던 업로드라도 기기의 삭제용 핸들을 지웁니다. 응답이 불명확하면 commit을 재시도하고 완료라고 단정하지 않습니다. 연결이 끊겼으면 다음 실행과 연결 시 재시도합니다.

계정 owner가 바뀌면 기존 자료를 다른 UID로 보내거나 삭제하지 않습니다. 앱 재설치 등으로 기기 삭제용 ID가 사라진 자료는 관리자의 서버 삭제가 필요합니다. 저장 실패나 인증정보 손상이 있으면 자동 전송을 중지합니다. 별도의 사용 기록 목록, 매건 전송 버튼, 매건 확인창은 없습니다.

`ResearchLedgerTests`는 동의 없는 등록 차단, 철회 시 원자료 제거, 진행 중 요청의 owner/ID 보존, 늦은 응답 경합, 불명확한 네트워크 결과와 재실행 복구를 검증합니다. REST 구현 근거: [Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth), [문서 생성](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/createDocument), [원자적 commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit).
