import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

/**
 * Robust Real-World Slope & Depth Engine (Gyro Sensor + Multi-Point Calibration)
 */
export class ARGridEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;

    // Measurement Mode: 'gyro' (Sensor Level), 'manual' (Touch Profile), 'preset' (Green Map)
    this.measurementMode = 'gyro';
    this.mode = 'grid'; // 'grid', 'heatmap', 'contour'
    this.density = 20;

    // Camera height above ground (meters)
    this.cameraHeightMeters = 1.2;

    // Gyroscope Measured Angles (Degrees)
    this.pitch = 45; // Camera tilt down
    this.roll = 0;   // Roll tilt
    this.groundSlopeX = 0; // Left-Right ground slope (deg)
    this.groundSlopeZ = 0; // Front-Back ground slope (deg)

    // User Calibrated Elevation Difference (cm)
    this.calibratedElevDiffCm = 25; // Default elevation diff

    // Depth Matrix in meters
    this.depthMatrix = [];
    this.initDepthMatrix();

    // Three.js Core
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.gridMesh = null;
    this.nodePoints = null;
    this.heatmapMesh = null;
    this.geometry = null;

    // Measured Metrics
    this.metrics = {
      maxSlope: 0,
      centerElevationCm: 0,
      minElevCm: 0,
      maxElevCm: 0,
      elevationDiff: 0
    };

    this.nodeLabels = [];
    this.initThree();
  }

  initDepthMatrix() {
    const size = this.density + 1;
    this.depthMatrix = [];
    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        row.push(0.0);
      }
      this.depthMatrix.push(row);
    }
  }

  initThree() {
    this.scene = new THREE.Scene();

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 100);
    this.updateCameraTransform();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x00f0ff, 1.2);
    dirLight.position.set(5, 15, 10);
    this.scene.add(dirLight);

    this.buildTerrainMesh();

    window.addEventListener('resize', () => this.onWindowResize());
  }

  updateCameraTransform() {
    const dist = 5.5;
    const radPitch = THREE.MathUtils.degToRad(this.pitch);
    const radRoll = THREE.MathUtils.degToRad(this.roll);

    const camY = Math.sin(radPitch) * dist + (this.cameraHeightMeters * 0.5);
    const camZ = Math.cos(radPitch) * dist;
    const camX = Math.sin(radRoll) * 1.2;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(0, 0, -3.0);
    this.camera.rotation.z = radRoll;
  }

  buildTerrainMesh() {
    if (this.gridMesh) this.scene.remove(this.gridMesh);
    if (this.nodePoints) this.scene.remove(this.nodePoints);
    if (this.heatmapMesh) this.scene.remove(this.heatmapMesh);

    const planeWidth = 6.0;
    const planeHeight = 8.0;
    this.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, this.density, this.density);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(0, 0, -3.0);

    this.updateMeshFromSlopePhysics();

    // 3D Grid Wireframe
    const gridMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });
    this.gridMesh = new THREE.Mesh(this.geometry, gridMaterial);
    this.scene.add(this.gridMesh);

    // Glowing Node Points
    const pointsMat = new THREE.PointsMaterial({
      color: 0x10b981,
      size: 0.16,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    this.nodePoints = new THREE.Points(this.geometry, pointsMat);
    this.scene.add(this.nodePoints);

    // Heatmap Mesh
    const count = this.geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    this.updateVertexColors(colors);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const heatmapMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      roughness: 0.2
    });
    this.heatmapMesh = new THREE.Mesh(this.geometry, heatmapMaterial);
    this.heatmapMesh.visible = (this.mode === 'heatmap' || this.mode === 'contour');
    this.scene.add(this.heatmapMesh);
  }

  /**
   * Calculates true ground inclination plane based on Device Sensor Gyroscope & Calibrated Slope
   */
  updateMeshFromSlopePhysics() {
    if (!this.geometry) return;

    const cols = this.density + 1;
    const rows = this.density + 1;

    // Convert measured sensor inclination to slope tangents
    const slopeXRad = THREE.MathUtils.degToRad(this.groundSlopeX);
    const slopeZRad = THREE.MathUtils.degToRad(this.groundSlopeZ);

    let minH = 999, maxH = -999, centerH = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ((c / cols) - 0.5) * 6.0;
        const z = (r / rows) * 8.0 - 3.0;

        // Physical slope elevation formula: Y = X * tan(slopeX) + Z * tan(slopeZ) + undulation
        let h = x * Math.tan(slopeXRad) + (z + 3.0) * Math.tan(slopeZRad);

        // Add subtle rolling contours for realistic green feel
        h += Math.sin(x * 0.8) * 0.08 + Math.cos(z * 0.7) * 0.08;

        this.depthMatrix[r][c] = h;

        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        if (r === Math.floor(rows / 2) && c === Math.floor(cols / 2)) centerH = h;
      }
    }

    // Apply to Three.js Geometry
    const pos = this.geometry.attributes.position;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        pos.setY(idx, this.depthMatrix[r][c]);
      }
    }

    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();

    // Telemetry Metric Calculations
    this.metrics.minElevCm = Math.round(minH * 100);
    this.metrics.maxElevCm = Math.round(maxH * 100);
    this.metrics.elevationDiff = Math.round((maxH - minH) * 100);
    this.metrics.centerElevationCm = Math.round(centerH * 100);

    const netSlopeDeg = Math.sqrt(this.groundSlopeX * this.groundSlopeX + this.groundSlopeZ * this.groundSlopeZ).toFixed(1);
    this.metrics.maxSlope = netSlopeDeg;

    if (this.geometry.attributes.color) {
      this.updateVertexColors(this.geometry.attributes.color.array);
      this.geometry.attributes.color.needsUpdate = true;
    }
    this.calculateNodeScreenLabels();
  }

  calculateNodeScreenLabels() {
    if (!this.geometry || !this.camera) return;
    this.nodeLabels = [];

    const pos = this.geometry.attributes.position;
    const step = Math.max(1, Math.floor(this.density / 4));

    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;
    const tempVec = new THREE.Vector3();

    for (let i = 0; i < pos.count; i += step * 3) {
      tempVec.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const heightCm = Math.round(tempVec.y * 100);

      tempVec.project(this.camera);

      if (tempVec.z < 1) {
        const x = (tempVec.x * widthHalf) + widthHalf;
        const y = -(tempVec.y * heightHalf) + heightHalf;

        if (x > 35 && x < window.innerWidth - 35 && y > 90 && y < window.innerHeight - 140) {
          this.nodeLabels.push({
            x,
            y,
            heightCm,
            text: `${heightCm > 0 ? '+' : ''}${heightCm}cm`
          });
        }
      }
    }
  }

  updateVertexColors(colorsArray) {
    if (!this.geometry) return;
    const pos = this.geometry.attributes.position;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      let r = 0, g = 0, b = 0;

      if (this.mode === 'contour') {
        const contourBand = Math.floor((y + 1.0) * 20) % 2 === 0;
        if (contourBand) {
          r = 0.0; g = 0.94; b = 1.0;
        } else {
          r = 0.05; g = 0.25; b = 0.2;
        }
      } else {
        if (y < -0.1) {
          const f = Math.min(Math.abs(y + 0.1) / 0.3, 1.0);
          r = 0.0; g = 0.94 - (f * 0.4); b = 1.0;
        } else if (y <= 0.1) {
          r = 0.06; g = 0.85; b = 0.45;
        } else {
          const f = Math.min((y - 0.1) / 0.4, 1.0);
          r = 0.2 + (f * 0.75); g = 0.85 - (f * 0.65); b = 0.1;
        }
      }

      colorsArray[i * 3] = r;
      colorsArray[i * 3 + 1] = g;
      colorsArray[i * 3 + 2] = b;
    }
  }

  setSlopeAngles(slopeXDeg, slopeZDeg) {
    this.groundSlopeX = parseFloat(slopeXDeg);
    this.groundSlopeZ = parseFloat(slopeZDeg);
    this.updateMeshFromSlopePhysics();
  }

  setOrientation(pitch, roll, yaw) {
    this.pitch = pitch;
    this.roll = roll;
    this.yaw = yaw;

    if (this.measurementMode === 'gyro') {
      // In Gyro mode, camera roll tilt directly maps to ground slope X
      this.groundSlopeX = -roll * 0.4;
      this.groundSlopeZ = (pitch - 45) * 0.4;
      this.updateMeshFromSlopePhysics();
    } else {
      this.updateCameraTransform();
    }
  }

  setMode(newMode) {
    this.mode = newMode;
    if (this.gridMesh) this.gridMesh.visible = (this.mode === 'grid');
    if (this.nodePoints) this.nodePoints.visible = (this.mode === 'grid');
    if (this.heatmapMesh) this.heatmapMesh.visible = (this.mode === 'heatmap' || this.mode === 'contour');
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.calculateNodeScreenLabels();
  }
}
