# ParkCaddy Ground 2.1
파크골프 지면을 확인하는 카메라 기능입니다. 현재 독립 실행으로 사용하며, 이후 스코어카드의 구장·코스·홀 정보와 연결할 예정입니다.

- 서비스: https://parkcaddy-ground-2026.web.app
- 관리자: https://console.firebase.google.com/project/parkcaddy-ground-2026/firestore
- 형상관리: feature/ground-v2 · [PR #1](https://github.com/playpark-admin/parkcaddy/pull/1)
- [개발 단계](docs/ROADMAP.md) · [정밀도 근거](docs/MEASUREMENT-ACCURACY.md) · [검증 기록](docs/VALIDATION.md)

## 화면
처음부터 전체 화면 카메라를 사용합니다. 측정 격자·거리·상대 높이 표시는 카메라 위에 유지하며, 별도의 홈·게임 진행·기록 갤러리는 없습니다. 사용자 높이와 보정, 화면 안내, 실시간 분석과 물리식, 데이터 제공 동의는 설정 안에서 분류합니다.

| 구성 | 현재 제공 | 측정의 의미 |
| --- | --- | --- |
| 웹 | 전체 화면 촬영, 조준 그리드, 조건부 거리, GPS·센서 진단 | 웹 격자는 조준 안내. 깊이 없는 높낮이를 생성하지 않음 |
| Android | ARCore Raw Depth, 실제 격자·고저·거리, 고유 프레임 반복 필터, 설정 분석 | Depth 지원 기기에서 근거리 상대 측정 |
| iOS | sceneDepth 반복 관측, 관측된 격자선·거리·상대 높이, 일반 카메라 대체 모드 | LiDAR 지원 기기에서 깊이 측정. 미관측 칸 보간 없음 |
| Firebase | 최초 동의 후 자동 수집, 일반 클라이언트 원자료 읽기 금지, 관리자 열람 | 미검수 자료 수집. 검증된 공동 지형 지도는 후속 단계 |

## 사용
1. 처음 한 번 연구용 데이터 제공 여부를 선택합니다. 거절해도 촬영·측정을 사용할 수 있습니다.
2. 카메라를 켜 지면을 확인합니다. 네이티브 AR에서는 기준점을 지정하고 목표 지면을 관측합니다.
3. 필요한 기본 높이·보정·화면 표시를 설정에서 조정합니다. 정밀도 분석도 설정 안에서 확인합니다.
4. 동의 후 새 자료는 자동 전송합니다. 전송 목록이나 매번 동의창을 띄우지 않습니다.
5. 설정에서 제공을 중지하거나 서버 자료 삭제를 요청할 수 있습니다.

웹은 촬영한 축소 사진(최대1280px), 동기화된 GPS·센서를 수집합니다. 기본 카메라 파일은 촬영 시각을 확인할 수 없어 GPS·각도를 자동 결합하지 않습니다. 네이티브는 실제 높이·거리·관측 품질 수치를 수집하며 현재 원격 사진/GPS는 수집하지 않습니다. 각 최초 동의창에서 수집 범위를 고지합니다.

관리자는 Firebase 콘솔의 Firestore에서 users/{uid}/observations(웹 사진) 및 users/{uid}/measurements(네이티브 수치)를 확인합니다. 앱 사용자 계정은 자신의 경로에 쓰기·삭제만 할 수 있고 원자료를 읽거나 나열할 수 없습니다. 관리자 권한은 Firebase/Google Cloud IAM으로 관리하며 앱에 관리자 비밀번호나 서비스 계정 키를 넣지 않습니다.

앱 종료·오프라인에서는 전송이 보장되지 않습니다. 다음 실행/연결 시 현재 동의를 확인하고 재시도합니다. 업로드 전에 문서ID·소유자와 대기 상태를 보존하며 삭제 의도도 기록합니다. 익명 계정의 기기 데이터를 지우면 이전 서버 자료의 삭제 권한을 잃을 수 있습니다. 공개 서비스 규모를 늘리기 전 App Check·용량 제한·계정 복구·보관정책을 보완해야 합니다.

## 정확도
휴대전화 기울기는 지면 경사가 아닙니다. GPS와 웹 사진만으로 cm 높낮이를 계산하지 않습니다. 네이티브는 고유 시각의 깊이 프레임을 비교하고 이상값과 관측 안정성을 검사합니다. 반복 산포와 센서 confidence는 절대 정확도 확률이 아닙니다.

웹 d=h·cot(α)의 입력 오차 범위는 평지·보정 가정 안의 조건부 범위입니다. 현장 기준 측량 없이 실제 cm 정확도를 보장하지 않습니다. 격자선의 매끄러움이나 표시 소수점 수가 정확도를 뜻하지 않습니다.

## 개발
Node.js 22 이상:
```sh
node ground/server.mjs
node --test ground/tests/*.test.mjs
```
화면 검사는 Playwright·Edge 환경의 ground/tests/browser-smoke.mjs를 실행합니다. PLAYWRIGHT_MODULE로 설치 경로를 지정할 수 있습니다. 실제 Firebase 검사는 RUN_LIVE_CLOUD_TEST=1을 명시하며 가상 자료·계정을 만들고 정리합니다.

Android: [빌드 안내](native/android/GROUND-V2.md). iOS: [빌드 안내](native/ios/README.md). GitHub Actions가 Android 빌드·lint·호스트 검사와 iOS 시뮬레이터 빌드·XCTest를 실행합니다. 최신 실행 결과는 [검증 기록](docs/VALIDATION.md)을 참고하세요. 배포 서명과 실기기 센서 검증은 별도입니다.

```sh
firebase deploy --only firestore:rules,hosting --project parkcaddy-ground-2026
```

## 향후 스코어카드 연결
현재 독립 실행입니다. 웹에는 부모 창의 정확한 출처를 확인하는 준비/닫기/촬영 이벤트 연결부만 준비했습니다. 현재의 수동 구장 이름·홀 번호를 식별자로 간주하지 않습니다. 실제 구장ID·코스ID·홀ID 매핑은 스코어카드 소스가 연결되는 단계에서 구현합니다. 사진·GPS는 부모 창 메시지로 전달하지 않습니다.

## 원본 보존
작업 폴더 backups/prototype-20260927-042941에 원본 웹·네이티브·실험 자료와 전체 Git 이력 번들을 보존했습니다. 원본 기준 fcff929ac1d9c91c5d4b52b8f5fa0d6a88c966d3, 태그 prototype-before-ground-v2-20260927. 기존 web/ 및 루트 GitHub Pages index.html은 보존되어 있으며 새 서비스는 ground/에서 배포합니다.

삭제 요청은 서버에서 최소 ID 삭제표식 저장과 원자료 삭제를 원자 처리합니다. 이후 같은 ID의 지연 업로드는 거부합니다. 삭제표식에는 사진·위치·측정 수치를 남기지 않습니다.
