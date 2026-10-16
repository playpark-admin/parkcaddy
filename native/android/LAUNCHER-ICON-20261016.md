# 설치 아이콘 변경

## 최종 적용

사용자가 승인한 PlayPark 교차 클럽/노란 공 + 지형 격자 조합으로 교체했습니다.
둥근 사각형 바깥 네 모서리는 PNG alpha 투명입니다.
adaptive icon 배경도 투명으로 설정하여 네 모서리를 이전 남색으로 채우지 않습니다.
런처가 추가 마스크/배경을 적용할 수 있으므로 폰별 표시 확인은 필요합니다.
업데이트 설치 구분을 위해 versionCode는 6으로 올렸습니다.
applicationId와 versionName, 측정 로직은 이전 테스트 빌드와 동일합니다.
아래 내용은 최초 아이콘 생성 이력입니다.

사용자의 새 요청에 따라 이전 아이콘 변경 취소 결정을 대체하여 새 아이콘을 적용했습니다.
기존 측정 코드, 버전, 패키지 ID, 동의 설정은 변경하지 않았습니다.
Android 24–25용 bitmap 리소스와 Android 26 이상용 adaptive icon을 추가했습니다.
원형/둥근 사각형 마스크는 Android 런처가 적용합니다. 실제 런처 화면은 아직 검증하지 않았습니다.

이미지는 내장 image_gen 도구로 생성했습니다(CLI/API fallback 미사용).
원본: app/src/main/res/drawable-nodpi/parkcaddy_launcher_art.png

## 생성 프롬프트

Use case: logo-brand. Asset type: Android launcher icon for ParkCaddy, a park golf AR terrain measurement app. Create one polished square icon, no text or letters. Deep dark navy teal full bleed background (#10252b), a bold electric lime golf flag standing on a stylized teal gently undulating terrain grid, with one small white golf ball. Minimal crisp geometric sports technology brand mark, flat vector-like shapes, premium confident look, extremely readable at small launcher icon sizes. All meaningful symbol geometry contained in the central 60 percent of the square to allow Android circular and squircle clipping. Background fills every corner, no rounded square border baked in, no mockup, no extra panels, no watermark. Sparse broad grid lines rather than many tiny details.
