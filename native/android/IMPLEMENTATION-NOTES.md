# ParkCaddy Android implementation and validation

## Fixed defects

- Camera background now transforms the full [-1,+1] NDC quad into ARCore texture coordinates. Removed the extra manual Y flip and incorrectly typed [0,1] input.
- Removed the local height variable that made the old screen sampling Y coordinate zero.
- Removed arbitrary depth-point origin orientation. The initial ground reference is a detected upward horizontal plane; the origin is the phone's horizontal position projected onto that reference plane.
- Measurements are stored relative to one persistent anchor, rather than resampled into different screen coordinates on every draw.
- Missing depth is transparent rather than reported as zero elevation. Full 16-bit depth images provide elevation, unprojected with scaled image intrinsics and camera pose.
- Tracking loss clears visible overlays and shows recovery guidance.
- GL rendering has checked shader compilation and logged frame failures. Session initialization, permission, installation, pause/resume and unsupported-depth states are handled.

## Implemented interaction

Both grid and heatmap are on initially. Independent switches are in a collapsed bottom panel. The top reset button clears the reference and measured terrain. There is no ball picker or camera-height form.

Depth-image sampling covers the camera image. A gray dashed reference grid persists within the 6 m radius; its approximate distance labels carry ≈. Solid edges and colored tiles require stable measured heights. The map uses 0.5 m bins, labels at 1 m bin intersections, and the horizontal distance from the scan-start phone position. Phone rotation does not change that distance. The displayed grid coordinates are approximate sample locations: binning can shift a point by up to about 35 cm horizontally. They are not precision survey points.

Each bin needs three consistent observations; large temporal jumps and excessive variation are rejected. Data expires after 15 seconds without refresh. The heatmap covers -2 to +2 m relative elevation; the sensitivity slider changes color contrast only. Neighboring measured heights determine downhill arrows in either ground direction. Missing neighbors are not used for heatmap or flow; they use the zero-height reference plane for the explicitly dashed reference grid.

## Practical limits

- This is an Android on-device implementation. iOS/ARKit and website deployment were not changed.
- The reference assumes the detected flat ground level extends beneath the phone. Initial floor detection can also select a table; aim at unobstructed ground.
- The current 6 m radius and 0.5 m grid target nearby relative terrain inspection. This is not a long-range golf rangefinder and does not guarantee 1 cm precision.
- Depth images do not semantically distinguish ground from objects. Use an unobstructed scene; avoid feet, bags, furniture and moving people.
- Temporal consistency is a stability heuristic, not a calibrated confidence percentage.
- Initial camera orientation and measured mesh alignment require manual verification while moving the physical phone. Launch/build success alone is not that verification.

## Checks

- assembleDebug and lintDebug: passed after camera feature declaration fix (non-blocking maintenance/style warnings remain).
- tests/TerrainMathCheck.java: passed distance, sign symmetry, insufficient observations, stable observations, outlier/NaN rejection, expiration and large relative elevation.
- Samsung SM-F936N: installation and activity launch succeeded. The user unlocked the phone and reported sparse lines, confirming the first map was too sparse. It was replaced with dense depth-image sampling and an always-visible dashed reference grid. Outdoor measurement accuracy remains unverified.

## Phone acceptance procedure

1. Unlock and open ParkCaddy AR. Aim at a textured floor near the feet, holding the phone about waist/chest height.
2. Translate the phone slowly to collect depth. Wait for measured point count, connected grid and colors.
3. Rotate without walking: the same observed grid distance should remain unchanged.
4. Compare with 1 m / 2 m tape-measure marks; check overlay alignment and record error. Do not use camera-to-target slant distance as the reference.
5. Compare unobstructed low/high ground patches in both directions. Missing patches should remain transparent.
6. Toggle grid and heatmap independently; collapse the panel; reset at a new position.
7. Background and reopen the app, then cover/uncover the camera. Verify recovery messages and absence of crashes.
