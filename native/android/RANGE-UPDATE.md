> Historical implementation notes. For current v2 behavior and validation status, see [GROUND-V2.md](GROUND-V2.md).

# Range and field UI update — 2026-09-12

- View ranges: 6, 15 (default), 50, 150 metres, measured horizontally from the reset anchor.
- Sparse concentric lattice: 0.25 m nodes through 6 m, 1 m through 20 m, 5 m through 50 m, 10 m through 150 m. Near lines are additionally thinned for perspective.
- Depth acquisition accepts available optical-axis samples through 50 m. This is an input ceiling, not a guaranteed sensor range. Existing ±2 m relative-height gate and conservative stability filters remain. Missing/unstable samples never become measured terrain.
- Dashed grids and approximate distances extend the horizontal reference plane, not actual far terrain. Long-range ground slope or anchor error can produce large distance errors. Do not use the 150 m mode as a rangefinder.
- Actual heatmap tiles require four valid depth nodes. Negative height is valid; missing height is not fabricated.
- Compact brand header; reset, range chips, live guidance, collapsible settings moved to a bottom sports-style panel. Labels avoid the panel and aim for up to five non-overlapping distance bands.
- Pure Java checks cover geometry, scale, labels, guidance and sparse grid node count. Outdoor 50/150 m accuracy requires field verification against surveyed references; this change does not provide centimetre accuracy.

Reference: https://developers.google.com/ar/develop/depth/changes
