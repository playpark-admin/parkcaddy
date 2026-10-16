# Ground 웹 2.2 · 실제 깊이 자동 스캔

현재 웹 화면은 WebXR CPU 깊이를 이용하는 지면 측정 기능입니다. 전체 화면 카메라 위에 관측한 격자, 기준 대비 높이와 카메라 기준 수평거리를 표시합니다. 현재 독립 실행되며 스코어카드 통합은 후속 단계입니다.

## 시작과 지원 조건

웹에서는 `스캔 시작` 터치가 immersive AR 세션을 엽니다. 브라우저 사용자 활성화 요구 때문에 이 한 번의 시작 조작이 필요하며, 이후에는 지면을 비추면 기준 확인 → 반복 보정 → 격자·숫자 표시가 자동 진행됩니다. 백그라운드로 이동하거나 세션을 종료하면 다시 시작할 때 새 터치가 필요할 수 있습니다. Android/iOS 네이티브 앱은 기본 측정 버튼 없이 자동 관측합니다. [WebXR 시작 절차](https://www.w3.org/TR/webxr/#application-flow)

필요 조건:

- HTTPS 또는 개발용 localhost의 안전한 출처.
- `immersive-ar`, `local`, `hit-test`, `depth-sensing`, `dom-overlay` 지원.
- CPU 접근 깊이(`cpu-optimized`) 및 현재 구현이 요청하는 `float32` 또는 `luminance-alpha` 형식.
- Android의 경우 ARCore 지원 기기와 사용 가능한 Google Play Services for AR. 브라우저·기기 조합마다 별도 확인 필요.

`isSessionSupported('immersive-ar')`는 깊이 사용 가능 여부를 확정하지 않습니다. 시작 시 필요한 기능을 요청하고 실제 CPU 깊이를 확인합니다. 기능이 없으면 숫자나 가상 굴곡을 만들지 않고 구체적인 안내와 [Android 앱 링크](https://github.com/playpark-admin/parkcaddy/releases/download/ground-v2.2-preview/parkcaddy-ground-android.apk)를 제공합니다. 앱을 설치해도 미지원 하드웨어에 깊이 기능이 생기는 것은 아닙니다. iPhone은 LiDAR 지원 기기의 네이티브 앱이 필요하며 배포 서명은 별도입니다. [Google WebXR 요구사항](https://developers.google.com/ar/develop/webxr/requirements)

**실물 Android 브라우저에서 2.2 WebXR 센서 흐름을 실행한 검증은 아직 완료하지 않았습니다.** 모의 센서 시험과 브라우저 화면 검사 결과를 실기기 호환성이나 cm 정확도 보증으로 해석하지 않습니다. 최신 실행 결과는 [검증 기록](../docs/VALIDATION.md)에만 기록합니다.

## 관측과 계산

- `webxr-scan.mjs`: 기능 협상, 카메라/깊이 프레임, 수평 hit-test, 자동 기준 확인, 격자 투영 및 세션 정리.
- `terrain-core.mjs`: 역투영, 세계좌표 셀의 반복 관측, 중앙값·MAD와 실제 이동폭, 최근성, 관측점 연결.
- `app.mjs`: 설정·진행 상태·실제 숫자 표시, 동의 이후 수치 기록과 수집 요청.
- `physics.mjs`: 이전 평지 가정 거리 모델. 현재 자동 깊이 측정에는 사용하지 않음.

`getDepthInMeters()`의 입력은 정규화된 view 좌표이며 반환 깊이는 광학축 방향입니다. 역투영과 AR 자세로 세계좌표를 구합니다. 높이는 `target.y − reference.y`, 웹 수평거리는 `hypot(target.x − camera.x, target.z − camera.z)`입니다. 원근 화면 좌표에 단순 가상의 바둑판을 얹거나 미관측 높이를 보간하지 않습니다. [W3C 깊이 정의](https://www.w3.org/TR/webxr-depth-sensing-1/#interpreting-the-results)

`raw` 깊이를 요청하더라도 실제 반환 형식은 브라우저가 정하며 진단의 `depthType`으로 구분합니다. 깊이 0·없는 자세·추적 상실·오래된 값은 측정 결과로 표시하지 않습니다.

웹 채택 조건은 25 cm 셀, 셀당 7개 표본, 1.2초 관측 폭, 수평 8 cm 카메라 이동, 이상값 처리 후 높이 MAD 2.5 cm 이하 등입니다. 주요 숫자는 안정 셀 9개·유효 인접 연결 8개와 현재 화면의 중앙 관측점 조건도 요구합니다. 먼저 안정된 점은 격자에 반영하며 미측정 칸은 메우지 않습니다. 조건 통과는 정확도 보증이 아닙니다. [전체 계산·필터 근거](../docs/MEASUREMENT-ACCURACY.md)

설정의 카메라 높이 범위는 기본 0.4–2.3 m입니다. 실제 카메라 아래에서 기준 지면 후보를 선택하기 위한 조건이며 깊이의 미터 척도를 조정하는 배율이 아닙니다. 관찰 범위는 기본 3 m, 선택 5 m입니다. 높이·범위 조건을 바꾸면 새 기준부터 자동 관측합니다.

## 동의 후 관리자용 자동 수집

최초 선택 동의 후 준비된 측정값이 있을 때 최소 30초 간격으로 기록합니다. 전송 조작이나 원자료 목록은 기본 화면에 없습니다. 현재 웹 AR 기록에는 카메라 원본 사진·영상·전체 깊이맵이 들어가지 않습니다.

```text
source: webxr-depth
Firestore: users/{uid}/measurements/{id}
schemaVersion: 1
platform: webxr
createdAt: UTC ISO 문자열
consentVersion: 2026-09-27-v2
metadata: 실제 측정값·품질·기준점·세션·설정·최대 24개 관측점·맥락
```

점은 worldX/Y/Z, 상대 높이, 수평거리, MAD, 관측 수와 셀 번호를 포함합니다. `terrainMeasured:true`는 실제 깊이 자료를 처리했다는 의미이며 `accuracyValidated:false`를 유지합니다. 위치 사용을 허용했고 최근 30초 내 GPS가 있으면 장소 검색용으로 포함하고, 없으면 null입니다. GPS로 다른 세션의 높이를 직접 평균하거나 자동 공동 지도를 만들지 않습니다.

이전 웹 사진·IndexedDB 기록은 보존합니다. `webxr-depth` 수치만 새 `measurements` 경로로 보내며, 기존 사진은 `observations` 경로와 촬영 당시 동의에 따라 재시도·삭제합니다. 새 동의를 받았다는 이유만으로 과거 미동의 자료를 전송하지 않습니다.

클라이언트 원자료 읽기·목록 조회는 금지하며 관리자는 Firebase/Google Cloud IAM으로 열람합니다. `collection.mjs`가 동의 세대와 소유자·문서 ID·대기/삭제 의도를 보존합니다. `cloud.mjs`는 수치와 기존 사진의 경로를 구분하며 삭제 표식과 원자료 삭제를 원자 처리합니다. 표식은 늦은 재전송을 차단하며 ID와 삭제 사실만 남기고 수치는 남기지 않습니다.

## 개발과 검증

저장소 루트에서:

```sh
node ground/server.mjs
node --test ground/tests/*.test.mjs
```

`tests/terrain-core.test.mjs`에는 역투영·반복 관측·누락·추적 및 세션 수명 관련 회귀가 있습니다. `tests/upload-document.test.mjs`는 WebXR 수치와 이전 사진 경로를 확인하고, `tests/cloud-smoke.mjs`는 명시적 `RUN_LIVE_CLOUD_TEST=1`에서 합성 Firebase 자료를 생성·삭제합니다. 원자료 삭제 후 내용 없는 ID 표식은 의도적으로 남습니다. 이 문서는 새 CI 통과 수치를 주장하지 않습니다.

자세한 단계는 [ROADMAP](../docs/ROADMAP.md), 물리적 의미와 검증 기준은 [MEASUREMENT-ACCURACY](../docs/MEASUREMENT-ACCURACY.md)를 참고하세요.