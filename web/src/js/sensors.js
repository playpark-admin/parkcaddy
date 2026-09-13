/**
 * Device Orientation Sensor & Gyroscope Manager
 */
export class SensorManager {
  constructor(statusElement) {
    this.statusEl = statusElement;
    this.pitch = 45; // Default pitch (degrees)
    this.roll = 0;   // Default roll (degrees)
    this.yaw = 0;    // Compass heading

    this.smoothPitch = 45;
    this.smoothRoll = 0;
    this.alphaFilter = 0.15; // Low-pass filter smoothing coefficient

    this.isSupported = false;
    this.isActive = false;
    this.isManualMode = false;

    this.onOrientationUpdate = null;
  }

  async init() {
    if (typeof window.DeviceOrientationEvent !== 'undefined') {
      this.isSupported = true;
      
      // Handle iOS Safari permission request requirement
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const response = await DeviceOrientationEvent.requestPermission();
          if (response === 'granted') {
            this.bindEvents();
          } else {
            console.warn('자이로 센서 권한이 거부되었습니다.');
            this.setManualMode();
          }
        } catch (e) {
          console.warn('센서 권한 요청 오류:', e);
          this.setManualMode();
        }
      } else {
        this.bindEvents();
      }
    } else {
      console.warn('이 기기는 DeviceOrientation API를 지원하지 않습니다.');
      this.setManualMode();
    }
  }

  bindEvents() {
    window.addEventListener('deviceorientation', (e) => {
      if (this.isManualMode) return;

      if (e.beta !== null && e.gamma !== null) {
        this.isActive = true;
        this.updateStatus(true, 'GYRO (LIVE)');

        // beta: front-back tilt [-180, 180]
        // gamma: left-right tilt [-90, 90]
        // alpha: compass direction [0, 360]
        this.pitch = e.beta || 45;
        this.roll = e.gamma || 0;
        this.yaw = e.alpha || 0;

        // Apply low pass filter for smooth AR rendering
        this.smoothPitch += (this.pitch - this.smoothPitch) * this.alphaFilter;
        this.smoothRoll += (this.roll - this.smoothRoll) * this.alphaFilter;

        if (this.onOrientationUpdate) {
          this.onOrientationUpdate({
            pitch: this.smoothPitch,
            roll: this.smoothRoll,
            yaw: this.yaw
          });
        }
      }
    });
  }

  setManualMode() {
    this.isManualMode = true;
    this.isActive = false;
    this.updateStatus(false, 'GYRO (MANUAL)');
  }

  updateManualValues(pitch, roll) {
    this.smoothPitch = pitch;
    this.smoothRoll = roll;
    if (this.onOrientationUpdate) {
      this.onOrientationUpdate({
        pitch: this.smoothPitch,
        roll: this.smoothRoll,
        yaw: this.yaw
      });
    }
  }

  updateStatus(active, label) {
    if (!this.statusEl) return;
    this.statusEl.textContent = label;
    if (active) {
      this.statusEl.classList.add('status-active');
    } else {
      this.statusEl.classList.remove('status-active');
    }
  }
}
