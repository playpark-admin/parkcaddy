# ParkCaddy Ground 2.2

파크골프 지면을 확인하는 카메라 기능입니다. 현재 독립 실행으로 사용하며, 이후 스코어카드의 구장·코스·홀 정보와 연결할 예정입니다.

- [서비스](https://parkcaddy-ground-2026.web.app) · [Android 측정 앱](https://parkcaddy-ground-2026.web.app/downloads/parkcaddy-ground-android.apk)
- [관리자 Firestore](https://console.firebase.google.com/project/parkcaddy-ground-2026/firestore)
- 형상관리: `feature/ground-v2` · [PR #1](https://github.com/playpark-admin/parkcaddy/pull/1)
- [개발 단계](docs/ROADMAP.md) · [정밀도 근거](docs/MEASUREMENT-ACCURACY.md) · [검증 기록](docs/VALIDATION.md) · [웹 구현 안내](ground/README.md)

## 화면과 자동 스캔

전체 화면 카메라 위에 실제 관측 격자·수평거리·상대 높이를 표시합니다. 지면 비추기 → 기준 지면 자동 확인 → 반복 관측 보정 → 안정된 관측 결과 표시로 이어집니다. 별도의 홈·게임 진행·기록 갤러리는 없습니다. 높이 조건과 보정, 화면 안내, 실제 데이터 분석과 계산식, 제공 동의는 설정에서 분류합니다.

| 구성 | 현재 구현 | 사용 조건 |
| --- | --- | --- |
| 웹 | WebXR CPU 깊이와 카메라 자세를 역투영한 실제 격자·높이·거리 | HTTPS, immersive AR와 CPU depth·hit-test·DOM overlay 지원 필요 |
| Android | ARCore Raw Depth의 자동 기준 확인·반복 관측·순차 격자 표시 | Depth 지원 기기. 기본 화면의 측정·재측정 버튼 없음 |
| iOS | sceneDepth의 자동 기준 확인·반복 관측·관측 격자 표시 | 깊이 측정은 LiDAR 지원 기기. 기본 화면의 측정 버튼 없음 |
| Firebase | 최초 동의 후 자동 수집, 일반 클라이언트 원자료 읽기 금지, 관리자 열람 | 미검증 수집 자료. 공동 지형 정합·지도 생성은 후속 단계 |

웹은 브라우저 보안 요구로 `스캔 시작`을 눌러 immersive AR 세션을 엽니다. 이후 지면을 가리킬 때마다 측정 버튼을 누를 필요가 없습니다. 세션 종료·백그라운드 전환 후 다시 열 때에는 시작 터치가 다시 필요할 수 있습니다. 카메라 권한만으로 WebXR 깊이 지원이 생기지는 않습니다. 미지원 시 이유와 Android 앱 링크를 표시하며 임의의 지형으로 대체하지 않습니다. [WebXR 사용자 활성화](https://www.w3.org/TR/webxr/#application-flow), [Google WebXR 요구사항](https://developers.google.com/ar/develop/webxr/requirements)

## 사용

1. 처음 한 번 연구용 데이터 제공 여부를 선택합니다. 거절해도 측정할 수 있습니다.
2. 웹에서는 `스캔 시작`을 누르고 카메라·AR 사용을 허용합니다. 네이티브 앱은 카메라 권한 허용 후 자동 관측합니다.
3. 발 앞 지면을 비추고 같은 지면을 보며 폰을 천천히 좌우로 움직입니다. 기준 확인·관측 보정 상태와 실제 격자를 확인합니다.
4. 필요할 때 설정에서 관찰 범위·지면 후보 조건·표시를 조정하거나 기준점을 다시 잡습니다. 웹 기본 높이 범위 0.4–2.3 m는 지면 후보 조건이며 측정 깊이의 배율이 아닙니다. Android의 기준 높이는 AR 자동값으로, 사용자 키나 렌즈 높이를 입력해 보정하지 않습니다.
5. 동의한 새 수치만 자동 전송하며 전송 목록이나 매번 동의창은 없습니다. 설정에서 제공 중지·서버 자료 삭제를 요청할 수 있습니다.

진행 상태는 관측 수·이동·안정 조건을 반영하며 정확도 확률이 아닙니다. 웹은 25 cm 셀별 7개 표본·1.2초·수평 이동 8 cm·MAD 2.5 cm 이하 등을 확인합니다. 안정 셀 9개와 유효 인접 연결 8개, 화면 중앙 부근의 관측점 등 조건을 만족하면 주요 숫자를 표시합니다. 세부 조건은 [정밀도 문서](docs/MEASUREMENT-ACCURACY.md)에 설명합니다.

## 자동 수집과 삭제

웹 AR은 동의 후 실제 측정수치와 관측 품질을 최소 30초 간격, 최대 24개 점으로 전송합니다. 위치 사용이 허용되고 최근 GPS가 있을 때만 장소 검색용 위치를 함께 넣습니다. 현재 웹 AR은 원본 카메라 사진·영상이나 전체 깊이맵을 전송하지 않습니다. 이전 버전의 사진 자료와 대기열은 보존하며 촬영 당시 동의와 삭제 기록에 따라 기존 경로로 관리합니다.

| 자료 | Firestore 경로 | 문서 구분 |
| --- | --- | --- |
| 웹 AR 수치 | `users/{uid}/measurements/{id}` | `schemaVersion:1`, `platform:webxr`, `consentVersion:2026-09-27-v2` |
| Android/iOS 수치 | `users/{uid}/measurements/{id}` | `schemaVersion:1`, 각 플랫폼 및 네이티브 동의 버전 |
| 이전 웹 사진 | `users/{uid}/observations/{id}` | 기존 사진 스키마·동의 기록 유지 |

네이티브 수집에는 현재 사진·GPS가 포함되지 않습니다. GPS는 장소 검색용이며 여러 사람의 높이를 직접 평균하는 근거가 아닙니다. 앱 계정은 자신의 경로에 쓰기·삭제만 할 수 있으며 원자료 읽기·목록 조회는 금지합니다. 관리자는 Firebase/Google Cloud IAM 권한으로 열람합니다.

앱 종료·오프라인 중 전송은 보장되지 않으며 다음 실행/연결 때 동의와 영구 대기 상태를 확인합니다. 삭제는 최소 ID 표식 저장과 원자료 삭제를 원자 처리하여 같은 ID의 지연 업로드를 거부합니다. 표식에는 사진·위치·측정 수치를 남기지 않습니다. 익명 계정의 기기 데이터를 지우면 기존 자료의 삭제 권한을 잃을 수 있으므로 먼저 삭제 완료를 확인해야 합니다.

## 정밀도와 검증 범위

깊이를 이용한 상대 높이 계산은 구현되었지만 필터 통과, 작은 MAD, 매끄러운 격자, cm 단위 표시가 실제 cm 정확도를 보장하지 않습니다. 반복 관측은 일부 무작위 오차와 이상값을 줄일 수 있으며 공통 센서 편향·기준점 오류·추적 드리프트는 남습니다. 이전 `physics.mjs`의 평지 거리식은 보존된 이전 계산 모듈이며 현재 WebXR 높이·거리의 입력이 아닙니다.

**실제 Android 스마트폰 브라우저에서 2.2 WebXR 카메라·깊이·격자 흐름을 실행한 검증과 야외 측량 정확도 검증은 아직 완료하지 않았습니다.** 자동 테스트나 모의 WebXR 결과를 실기기 지원·정밀도 입증으로 해석하지 않습니다. 최신 빌드·시험 결과는 [검증 기록](docs/VALIDATION.md)에서 별도로 확인합니다.

## 개발

Node.js 22 이상:

```sh
node ground/server.mjs
node --test ground/tests/*.test.mjs
```

Playwright·Edge 화면 검사는 `ground/tests/browser-smoke.mjs`, 실제 Firebase 회귀 검사는 `ground/tests/cloud-smoke.mjs`입니다. 실제 서버 검사는 `RUN_LIVE_CLOUD_TEST=1`을 명시하며 합성 자료·계정을 만들고 정리합니다. `PLAYWRIGHT_MODULE`로 도구 경로를 지정할 수 있습니다.

Android는 [자동 스캔](native/android/AUTO-SCAN.md)과 [빌드 안내](native/android/GROUND-V2.md), iOS는 [README](native/ios/README.md)를 참고합니다. GitHub Actions가 플랫폼 빌드·검사를 수행하며 실기기 설치 서명과 센서 인수 검사는 별도입니다.

```sh
firebase deploy --only firestore:rules,hosting --project parkcaddy-ground-2026
```

## 스코어카드 연결과 원본 보존

현재 웹 연결부는 허용된 부모 출처의 준비·닫기·맥락 전달을 지원합니다. 실제 구장ID·코스ID·홀ID 매핑과 호스트 내 실행은 후속 통합 단계입니다. 수동 구장 이름과 홀 번호는 검증된 지형 식별자가 아닙니다. 원자료를 부모 창 메시지로 전달하지 않습니다.

작업 폴더 `backups/prototype-20260927-042941`에 원본 웹·네이티브·실험 자료와 전체 Git 이력 번들을 보존했습니다. 원본 기준은 `fcff929ac1d9c91c5d4b52b8f5fa0d6a88c966d3`, 태그는 `prototype-before-ground-v2-20260927`입니다. 기존 `web/`와 루트 GitHub Pages `index.html`은 보존되어 있으며 새 서비스는 `ground/`에서 배포합니다.