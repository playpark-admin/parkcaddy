> Historical implementation notes. For current v2 behavior and validation status, see [GROUND-V2.md](GROUND-V2.md).

# Height stability update

## Changes
- Initial reference: repeat observations of the same tracked horizontal plane for at least 1.5 seconds, with a trimmed 3 cm spread gate. The fixed reference is not recomputed from the whole visible terrain. True slopes are not subtracted.
- Depth: raw depth plus its confidence image; reject confidence below 180/255 and repeated depth timestamps. Inspect all raw pixels because depth is sparse. A per-cell frame requires at least two samples with spread at most 12 cm.
- Temporal map: median/MAD of up to nine observations; at least seven samples, 1.2 seconds and 8 cm translation across camera poses before publishing. MAD <= 2.5 cm and trimmed spread <= 8 cm. These are heuristic repeatability gates, NOT accuracy guarantees.
- Stable cells remain in memory for this session until reset, rather than expiring after 15 seconds. Recent observations update slowly; repeated disagreement greater than 6 cm hides heights and marks rescan required. Published heights can recover when observations agree again.
- Visible label identities are retained ahead of new distance-band candidates. Gx:z identifies the same grid cell within a reset session. Up to five labels still avoid overlaps. Saved observations are explicitly labelled.
- Neutral heat below a distance/scatter-dependent deadband (minimum 5 cm); arrows require a difference exceeding both cells' deadbands. Numeric estimates remain available; small differences are labelled, not silently claimed accurate.

## Validation and limitations
- Six pure Java test programs pass, including geometry scale, negative heights, isolated outliers, map persistence, disagreement/recovery, stationary-phone rejection, reference stabilization and label identity.
- Android debug build and lint pass (existing warnings remain).
- No surveyed outdoor accuracy validation has been performed.
- Raw depth filtering will leave more unknown cells and may need several scan passes. Do not fill those cells using smoothed estimates.
- No semantic ground/vegetation classifier or absolute survey calibration is implemented. Within-cell spread rejection reduces some mixed surfaces but cannot establish that a surface is ground.
- Tracking/anchor drift, systematic depth bias and the initial plane estimate still affect results. Retaining data improves repeatability, not absolute accuracy. If the baseline is wrong, reset.
- 50/150 m view limitations and ±2 m input height gate remain unchanged. Far dashed geometry is a reference plane, not measured terrain.

## Device test
Reset once; aim at nearby flat ground for about two seconds. Translate the phone slowly 10–20 cm sideways while keeping the same tiles visible, then tilt up and down. Compare the SAME Gx:z identifier, not just similar distance values. Capture screenshots and a known flat/stepped reference to quantify improvement.
