# 카메라 화면과 관리자용 수치 수집

## 화면의 역할

카메라는 시스템 바 아래까지 전체 창을 사용합니다. 기존의 실제 격자·높이·거리 표시는 유지합니다. 상단에는 닫기/설정, 하단에는 실제 관측에 따른 자동 스캔 진행 상태만 표시하고 긴 물리·정밀도 설명은 설정 안에 둡니다. [자동 스캔 동작](AUTO-SCAN.md)을 참고하세요. 현재 APK는 독립 실행되며, 향후 스코어카드에서 이 Activity를 열고 닫도록 연결할 수 있습니다. 점수나 게임 진행 기능은 없습니다.

설정 분류:

- 사용자 보정: 처음 안정적으로 인식한 지면을 0 cm로 사용, 실제 카메라 상대 높이 확인, 기준 재설정, 관찰 범위 3/6 m, 엄격 필터.
- 화면과 안내: 격자·높낮이 색·큰 숫자·참고 평면, 사용 방법과 현재 안내.
- 데이터 기록: 관리자 분석용 자동 제공 동의/철회/자료 삭제, 별도의 기기 내 진단 기록과 ZIP 내보내기.
- 실데이터 분석: 약 0.5초마다 갱신하는 실제 단위·시점·픽셀 통계·MAD·기준 좌표, 역투영·좌표 변환식, 상관 오차와 편향 등 한계.

카메라 높이와 움직임은 ARCore의 미터 좌표에서 얻습니다. 사용자의 키/기본 높이를 입력하여 깊이를 임의로 확대·축소하지 않습니다. 깊이 관측 전에는 카메라 높이 0 같은 수치를 만들어 표시하지 않습니다.

## 최초 동의 후 자동 제공

최초 성공적인 AR 시작 시 제공/거절을 선택합니다. 거절해도 측정 기능은 동일합니다. 제공에 동의한 경우에만 익명 인증을 생성하고, 전경에서 최근 3초 안에 관측된 안정 격자가 있을 때 수치 요약을 30초 이상 간격으로 제출합니다. 개별 전송 버튼이나 전송 목록은 없습니다.

프로젝트: `parkcaddy-ground-2026`

경로: `users/{anonymousUid}/measurements/{randomDocumentId}`

상위 필드는 정확히 다음 5개입니다:

- `schemaVersion`: 1
- `platform`: `android`
- `createdAt`: UTC ISO 문자열, 수치 요약 레코드를 만든 시각
- `consentVersion`: `2026-09-27-native-v1`
- `metadata`: 실제 측정 요약

`metadata`의 24개 필드는 algorithm, accuracyValidated, sessionId, segment, location, locationSource, photosIncluded, deviceModel, depthWidthPx, depthHeightPx, fxPx, fyPx, meanOpticalDepthM, depthTimestampNs, elapsedMs, rangeM, confidencePassedPixels, confidenceRejectedPixels, stableCells, pendingCells, uncertainCells, cameraHeightM, policy, samples입니다.

`accuracyValidated=false`입니다. `location=null`, `locationSource=not_collected`, `photosIncluded=false`이며 사진·영상·음성·GPS는 전송하지 않습니다. 깊이 평균은 입력 신뢰도/깊이 조건을 통과한 광학축 깊이의 평균입니다. samples는 최근 안정 격자 중 가까운 최대 24개의 xM, zM, relativeHeightM, horizontalDistanceM, madM, observations, ageMs를 담습니다. 기기 모델은 보정 연구용이며 하드웨어 고유 식별자는 수집하지 않습니다.

클라이언트는 REST commit으로 기록 쓰기 또는 원자적 삭제를 요청하고 Firestore get/list를 호출하지 않습니다. 관리자만 읽도록 서버 규칙이 별도로 적용되어야 합니다. 여러 세션의 수치는 sessionId/segment로 구분하며, GPS가 없고 시각 특징도 보내지 않으므로 이 수집만으로 구장별 다중 사용자 지형 정합을 수행하지 않습니다.

## 동의·철회·삭제의 내구성

- 전송 전, 랜덤 문서 ID·익명 owner·내용·동의 세대를 앱 내부 파일에 기록하고 디스크 동기화합니다. 네트워크 결과가 불명확하면 같은 문서에 재시도합니다.
- 동의를 끄는 순간 새 전송을 차단하고 미완료 레코드를 `deleting`으로 먼저 저장합니다. 진행 중 요청이 늦게 성공하더라도 삭제 대상으로 남습니다. 이미 완료된 제공 자료는 별도 전체 삭제 버튼으로 삭제합니다.
- 전체 삭제 버튼은 동의를 끄고 완료/미완료 모든 문서의 삭제 의도를 먼저 디스크에 저장합니다. 삭제는 `users/{uid}/measurementDeletions/{id}`의 `{deleted:true}` 표식 쓰기와 원본 수치 삭제를 하나의 REST commit으로 처리합니다. 서버의 원자적 commit 성공 응답(200)을 확인한 항목만 핸들을 제거합니다. 서버 규칙이 표식이 있는 ID의 후속 쓰기를 거절하므로 시간 초과 뒤 늦게 도착한 요청도 원본을 복원할 수 없습니다. 관리자용 ID 삭제 표식만 남고 측정 수치는 삭제됩니다. 오프라인·앱 종료 후에도 다음 실행에서 재시도합니다.
- 재동의는 새로운 세대를 사용하므로 철회 전 큐가 다시 전송되지 않습니다. 작업은 하나의 직렬 실행기에서 수행하며 카메라 스레드에서 디스크나 네트워크를 기다리지 않습니다.
- pending은 최대 64개, 로컬 삭제 핸들은 최대 5,000개입니다. 한도 이후 새 자료를 추가하지 않습니다. 최초 익명 인증을 만들 수 없는 완전 오프라인 상태에서는 전송용 자료를 생성하지 않으며 측정은 계속됩니다.
- 앱을 닫으면 신규 네트워크 작업은 중지하고 다음 실행 때 이어갑니다. 이미 시작한 네트워크 요청은 제한시간 안에 완료될 수 있습니다. 철회/삭제 의도는 이 경우에도 유지됩니다.
- 익명 인증의 UID·refresh token·ID token은 Android Keystore AES-GCM 키로 암호화하여 앱 전용 저장소에 보관합니다. 앱 백업은 비활성화되어 있습니다. 토큰이나 서버 응답 본문을 로그로 출력하지 않습니다.
- 앱 삭제/데이터 초기화는 익명 인증과 삭제 핸들을 제거합니다. 그 전에 설정에서 삭제 완료를 확인해야 합니다. 다른 기기에서 제출한 자료는 이 기기의 익명 소유권으로 삭제할 수 없습니다.

## 검증 범위

10개 순수 Java 호스트 검사에는 기본 미동의, 지속되는 owner/ID, 재시도, 동의 철회, 재동의 세대, 전송 중 전체 삭제, 프로세스 재시작과 체크포인트 복구 검사가 포함됩니다. 기존의 깊이 역투영·반복 필터·높이·거리 검사도 유지합니다. 실제 Android SDK 빌드와 기기/네트워크 검증은 CI 및 실기기 결과를 별도로 확인해야 합니다.

공식 API 근거:

- [Firebase 익명 인증과 토큰 갱신 REST API](https://firebase.google.com/docs/reference/rest/auth)
- [Firebase 토큰을 사용하는 Firestore REST](https://firebase.google.com/docs/firestore/use-rest-api)
- [Firestore commit API](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)