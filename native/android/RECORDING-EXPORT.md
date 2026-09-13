# Local measurement recording

Open View (보기), use automatic recording checkbox and Measurement data download (측정 데이터 다운로드 · ZIP). Android's document picker selects the destination. No storage permission or server is required.

The ZIP contains per-launch run JSONL files, export.json and README.txt defining columns and coordinate frames. App-private files survive measurement reset and app relaunch. Reset increments segment; poses across segments/runs must not be merged without registration. Uninstall/clear-data removes internal recordings, so export first.

Data includes metadata (model/OS/algorithm), reference pose, status/failed-depth events, and up to one diagnostic depth frame per second: timestamps, camera/anchor pose, intrinsics, sampled raw depth/confidence, cell input and filtered heights, filter decision, sample count and baseline. No photographs, video, audio, GPS or serial/account identifiers. No server upload. This is a sampled diagnostic dataset, not lossless full-depth replay or calibration ground truth.

Storage is capped at 100 MiB with no automatic deletion. The queue is bounded; dropped chunks are reported. Export serializes previous writes and preserves source files. Recording on/off preference persists. JSON numbers that are not finite become null.

Validation: debug build/lint; seven host programs including ZIP, JSON escaping, signed values, pause, segmentation, source preservation and prior-run inclusion; device installation, menu visibility, creation and parsing of real depth_frame data. The Android destination picker save flow still needs user confirmation; host ZIP roundtrip is verified.

No measurement acceptance thresholds or color-display speed were relaxed in this change. Filter diagnostics were added to explain the existing observation delay.
