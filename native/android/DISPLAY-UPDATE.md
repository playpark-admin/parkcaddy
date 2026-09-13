# Distance-adaptive display (2026-09-12)

- Rendering retains the existing 25 cm measurement grid and distance scale.
- Lines are thinned by horizontal distance from the current camera position:
  under 2 m: 25 cm; 2–4 m: 50 cm; at least 4 m: 1 m.
- Within the usable visible camera region, up to five distance bands provide
  representative labels. Labels are reduced if fewer bands fit without overlap.
- Each label shows horizontal distance from the scan-start origin and approximate
  signed elevation in cm relative to the original ground reference.
- Unknown elevations are shown as “높이 미측정”, never numeric zero.
- Numeric elevation does not depend on the color sensitivity slider; it is a
  filtered estimate for calibration reference, not a claim of cm accuracy.
- Existing approximately 6 m mapping extent and depth limits are unchanged.

Verification: tests/GridDisplayCheck.java covers line spacing thresholds, five
representatives, collision avoidance, signed elevation and missing elevation.
No phone was connected during this update, so device visual testing is pending.
