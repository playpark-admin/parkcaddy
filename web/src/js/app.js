import { CameraManager } from './camera.js';
import { SensorManager } from './sensors.js';
import { ARGridEngine } from './arGrid.js';
import { UIController } from './ui.js';

class ParkCaddyApp {
  constructor() {
    this.cameraManager = null;
    this.sensorManager = null;
    this.arEngine = null;
    this.uiController = null;
  }

  async init() {
    console.log('⛳ ParkCaddy AR Computer Vision Depth Engine Initializing...');

    const videoEl = document.getElementById('camera-feed');
    const simCanvasEl = document.getElementById('sim-canvas');
    const arCanvasEl = document.getElementById('ar-canvas');
    const statusCamEl = document.getElementById('status-cam');
    const statusGyroEl = document.getElementById('status-gyro');

    // 1. Initialize 3D AR Depth Engine
    this.arEngine = new ARGridEngine(arCanvasEl);

    // 2. Initialize Camera Manager
    this.cameraManager = new CameraManager(videoEl, simCanvasEl, statusCamEl);
    await this.cameraManager.init();

    // 3. Initialize Sensor Manager
    this.sensorManager = new SensorManager(statusGyroEl);
    this.sensorManager.onOrientationUpdate = (data) => {
      this.arEngine.setOrientation(data.pitch, data.roll, data.yaw);
    };
    await this.sensorManager.init();

    // 4. Initialize UI Controller
    this.uiController = new UIController(this.arEngine, this.cameraManager, this.sensorManager);

    // 5. Start Render & Computer Vision Loop
    this.startLoop();
  }

  startLoop() {
    const videoEl = document.getElementById('camera-feed');
    const render = () => {
      // Pass video stream for real-time computer vision monocular depth sampling
      this.arEngine.render(videoEl);
      if (this.uiController && this.arEngine.metrics) {
        this.uiController.updateTelemetryUI(this.arEngine.metrics);
      }
      requestAnimationFrame(render);
    };
    render();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new ParkCaddyApp();
  app.init();
});
