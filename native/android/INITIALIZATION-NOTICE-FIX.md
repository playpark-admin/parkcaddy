# Initialization and notice fix

- Corrected plane identity: use logical Plane.equals(), not Java reference identity. ARCore may return different wrappers for one physical plane. The prior reference comparison could continuously clear the multi-frame calibration window.
- Resolve subsumed planes and require TRACKING state before accumulating reference observations.
- Nine screen probes (three horizontal positions by three vertical positions) instead of only three centre probes.
- Distinct guidance for finding floor, stabilizing a candidate, and unsuitable camera-to-plane height. No virtual floor is silently invented.
- Replace transient 50/150 m toast with a persistent, wrapped range notice inside the bottom card, independent of tracking state.
- Scrollable bounded status area; settings height responds to the viewport. Grid labels continue excluding the bottom card.

The camera need not see only floor: furniture may coexist with a usable visible floor patch. A table top can still satisfy geometric tests; this app has no semantic floor classifier. Point at the actual floor to avoid choosing the wrong reference. A stable reference produces a dashed grid even without valid raw heights.

Debug build/lint and existing six host checks pass; source checks guard logical equality and removal of the toast. No phone was connected during this update, so visual device validation and installation are pending.

ARCore reference: https://developers.google.com/ar/reference/java/com/google/ar/core/Plane
