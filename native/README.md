# ParkCaddy Native AR

This folder contains the native AR implementation plan and platform projects.

## Measurement contract

- Android requires an ARCore-certified device with Google Play Services for AR and Depth API support.
- iPhone requires ARKit world tracking; terrain-depth mode additionally requires LiDAR scene depth.
- Unsupported devices must not show numeric distance or terrain-flow results.

The web page remains a preview only. Real measurements are produced from world-space anchors and depth samples in the platform projects.
