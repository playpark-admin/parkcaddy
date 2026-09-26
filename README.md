# ParkCaddy Ground 2.0
파크골프장의 지면을 기록하고, 지원 기기에서 가까운 지면의 거리와 상대 높이를 측정하는 개발 버전입니다.

- 웹 서비스: https://parkcaddy-ground-2026.web.app
- 새 Firebase 프로젝트: https://console.firebase.google.com/project/parkcaddy-ground-2026/overview
- 개선 브랜치: feature/ground-v2
- 원본 기준: fcff929ac1d9c91c5d4b52b8f5fa0d6a88c966d3
- 개발 단계: [ROADMAP.md](docs/ROADMAP.md)
- 물리 근거와 조건부 오차: [MEASUREMENT-ACCURACY.md](docs/MEASUREMENT-ACCURACY.md)

## 무엇이 구현되었나
| 구성 | 현재 동작 | 제한 |
| --- | --- | --- |
| ground/ 공통 웹앱 | 카메라·GPS·사진 기록, 기기 저장, 동의 후 서버 전송·삭제, 오프라인 화면, 설정·디버그 | 사진 기록용. 브라우저에서 깊이 지형을 측정하지 않음 |
| native/android | ARCore Raw Depth, 반복 프레임 필터, 6m 근거리 보기, 기준점, 설정·실시간 진단, 선택적 진단 ZIP | Depth 지원 기기 필요. 실제 고저 정확도 검증 전 |
| native/ios | LiDAR sceneDepth·confidenceMap, 같은 세계좌표 반복 관측, 상대 거리·고저·35점 관측, 큰 UI·설정·디버그 | LiDAR 정밀 모드. 일반 iPhone은 사진/GPS 기록. 시뮬레이터 빌드·13개 테스트 통과. 실기기 검증 별도 |
| Firebase | 익명 로그인, 서울 리전 Firestore, 본인 기록만 접근, Hosting | 수집 상태만 저장. 3D 정합·다인 병합·자동 정밀도 향상은 후속 단계 |

네이티브의 Firebase 업로드는 아직 연결되지 않았습니다. 서버 전송은 웹 앱에서 동의 후 실행합니다. 웹 사진은 최대 1280px JPEG(문자열 700,000자 제한)로 지면 상태 이력용이며 정밀 사진측량 원본이 아닙니다. 초기에는 별도 유료 Storage 없이 Firestore에 제한된 사진과 메타데이터를 함께 보관합니다. 대규모 수집 전 Cloud Storage, App Check, 남용 제한, 보관정책과 계정 복구를 보완해야 합니다.

## 사용
1. 웹에서 구장·홀을 선택하고 그라운드 기록을 시작합니다.
2. 카메라·위치 사용을 허용하고 바닥이 선명한 사진을 저장합니다.
3. 내 기록에서 선택한 기록을 서버에 전송합니다. 사진·위치 정보에 대한 동의를 먼저 확인합니다.
4. 설정에서 큰 글씨·음성·진동·조건부 평지 거리·입력 오차·디버그를 조정합니다.
5. 높낮이 측정은 전용 네이티브 앱에서 수행합니다.

기본 카메라 파일은 센서 시각을 확인할 수 없어 GPS/거리와 자동 결합하지 않습니다. 서버 전송 전에 owner와 pending 상태를 기기에 저장합니다. 실패나 앱 종료 후에는 같은 ID 재전송, 서버 상태 확인, 서버 삭제가 가능합니다. 익명 계정은 브라우저 데이터 삭제 시 관리 권한을 잃을 수 있으므로 필요한 기록을 내보내세요. 다른 이용자는 원본 사진이나 위치를 읽을 수 없습니다.

## 정확도
기기 기울기는 지면 경사가 아닙니다. GPS로 cm 높낮이를 계산하지 않습니다. 동일 시점 사진 반복만으로 렌즈·센서 공통 편향이 사라지지 않습니다. 네이티브는 고유 시간의 여러 깊이 프레임을 비교하고 안정성과 이상값을 검사합니다. 센서 confidence와 반복 산포는 절대 정확도 확률이 아닙니다.

웹의 d=h*cot(α)는 평평한 지면 가정의 참고 거리입니다. 입력 오차 상한의 정확한 구간 경계를 표시하지만, 그 입력 상한 자체와 실제 지형의 타당성은 보장하지 않습니다. 정밀도 수치를 확정하려면 기준 측량과 비교해야 합니다.

## 개발과 검사
웹: Node.js 22 이상. 의존성 설치 없이 실행할 수 있습니다.

```sh
cd ground
node server.mjs
node --test tests/physics.test.mjs
```

화면 검사: Playwright와 Edge가 설치된 환경에서 tests/browser-smoke.mjs를 실행합니다. PLAYWRIGHT_MODULE 환경변수로 패키지 위치를 지정할 수 있습니다. 가상 카메라와 위치만 사용합니다.

Android: [native/android/GROUND-V2.md](native/android/GROUND-V2.md). JDK17, Android SDK35 필요.
```sh
cd native/android
./gradlew :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
```

iOS: [native/ios/README.md](native/ios/README.md). macOS + Xcode + XcodeGen 필요. xcodegen generate 후 ParkCaddyAR scheme을 빌드합니다. 배포용 앱은 소유자의 서명과 실기기 검증이 필요합니다.

GitHub Actions에서 코드 fefcbd3의 웹 수학 7개, Android 빌드·lint·호스트 9개, iOS 시뮬레이터 빌드·XCTest 13개가 통과했습니다. [검증 실행](https://github.com/playpark-admin/parkcaddy/actions/runs/36267925930). 실기기 센서·정밀도 검증과 배포 서명은 별도입니다.

Firebase CLI 15.31.0 이상:
```sh
firebase deploy --only auth,firestore,hosting --project parkcaddy-ground-2026
```

firebase-config.js는 공개 웹 식별자이며 비밀키가 아닙니다. 서비스 계정 키·로그인 토큰·서명키·실측 사진·GPS 기록은 커밋하지 마세요.

## 원본 보존
작업 폴더의 backups/prototype-20260927-042941에 원본 웹·네이티브·실험 자료와 전체 Git 이력 번들을 보존했습니다. bundle verify를 통과했습니다. 대용량 의존성·빌드 산출물·IDE 캐시는 백업에서 제외했습니다. 기존 web/, 루트 GitHub Pages index.html은 유지됩니다.
