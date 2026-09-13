/**
 * HUD User Interface Event Controller
 */
export class UIController {
  constructor(arEngine, cameraManager, sensorManager) {
    this.arEngine = arEngine;
    this.cameraManager = cameraManager;
    this.sensorManager = sensorManager;

    this.labelsContainer = document.getElementById('height-labels-layer');

    this.initEventListeners();
  }

  initEventListeners() {
    // Mode Switcher Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const mode = target.dataset.mode;

        tabBtns.forEach(b => b.classList.remove('active'));
        target.classList.add('active');

        this.arEngine.setMode(mode);

        const statusModeEl = document.getElementById('status-mode');
        if (statusModeEl) {
          statusModeEl.textContent = mode.toUpperCase();
        }
      });
    });

    // Sliders
    const amplitudeInput = document.getElementById('slider-amplitude');
    const amplitudeVal = document.getElementById('val-amplitude');
    amplitudeInput.addEventListener('input', (e) => {
      const val = e.target.value;
      amplitudeVal.textContent = `${val}x`;
      this.arEngine.setAmplitude(val);
    });

    const camHeightInput = document.getElementById('slider-cam-height');
    const camHeightVal = document.getElementById('val-cam-height');
    camHeightInput.addEventListener('input', (e) => {
      const val = e.target.value;
      camHeightVal.textContent = `${val} m`;
      this.arEngine.setCameraHeight(val);
    });

    const densityInput = document.getElementById('slider-density');
    const densityVal = document.getElementById('val-density');
    densityInput.addEventListener('input', (e) => {
      const val = e.target.value;
      densityVal.textContent = `${val} x ${val}`;
      this.arEngine.setDensity(val);
    });

    // Preset Selector
    const presetSelect = document.getElementById('select-preset');
    presetSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      this.arEngine.setPreset(selected);
      if (selected === 'live_sensor') {
        this.sensorManager.isManualMode = false;
      }
    });

    // Action Buttons
    const lockBtn = document.getElementById('btn-lock');
    lockBtn.addEventListener('click', () => {
      const locked = this.arEngine.toggleLock();
      if (locked) {
        lockBtn.classList.add('active-lock');
        this.showToast('🔒 깊이 측정이 고정되었습니다.');
      } else {
        lockBtn.classList.remove('active-lock');
        this.showToast('🔓 실시간 측정 모드로 전환되었습니다.');
      }
    });

    const flipCamBtn = document.getElementById('btn-flip-cam');
    flipCamBtn.addEventListener('click', () => {
      this.cameraManager.toggleCamera();
      this.showToast('📷 카메라를 전환합니다.');
    });

    const simModeBtn = document.getElementById('btn-sim-mode');
    simModeBtn.addEventListener('click', () => {
      this.cameraManager.toggleSimulationMode();
      this.showToast('🎬 데모/실제 카메라 모드 전환');
    });

    const snapshotBtn = document.getElementById('btn-snapshot');
    snapshotBtn.addEventListener('click', () => {
      this.takeSnapshot();
    });
  }

  updateTelemetryUI(metrics) {
    const centerHeightEl = document.getElementById('val-center-height');
    const minMaxEl = document.getElementById('val-min-max');
    const elevDiffEl = document.getElementById('val-elevation-diff');
    const slopeDegEl = document.getElementById('val-slope-deg');
    const ratingEl = document.getElementById('slope-rating');
    const crosshairHeightEl = document.getElementById('crosshair-height-text');

    if (centerHeightEl) centerHeightEl.textContent = `${metrics.centerElevationCm > 0 ? '+' : ''}${metrics.centerElevationCm} cm`;
    if (minMaxEl) minMaxEl.textContent = `${metrics.minElevCm} / +${metrics.maxElevCm}cm`;
    if (elevDiffEl) elevDiffEl.textContent = `${metrics.elevationDiff} cm`;
    if (slopeDegEl) slopeDegEl.textContent = `${metrics.maxSlope}°`;

    if (crosshairHeightEl) {
      const sign = metrics.centerElevationCm > 0 ? '+' : '';
      crosshairHeightEl.textContent = `타겟 높이: ${sign}${metrics.centerElevationCm} cm`;
    }

    if (ratingEl) {
      const slope = parseFloat(metrics.maxSlope);
      if (slope < 1.5) {
        ratingEl.textContent = '평지 (Flat)';
        ratingEl.style.color = '#10B981';
      } else if (slope < 3.5) {
        ratingEl.textContent = '완경사 (Gentle)';
        ratingEl.style.color = '#00F0FF';
      } else {
        ratingEl.textContent = '급경사 (Steep)';
        ratingEl.style.color = '#EF4444';
      }
    }

    // Render 2D Node Height Badges (-30cm, +50cm) on Grid Mesh
    this.renderHeightLabels();
  }

  renderHeightLabels() {
    if (!this.labelsContainer) return;
    this.labelsContainer.innerHTML = '';

    if (this.arEngine.mode !== 'grid') return; // Only show badges in grid mode

    const labels = this.arEngine.nodeLabels;
    labels.forEach(item => {
      const badge = document.createElement('div');
      badge.className = 'node-height-badge';
      
      if (item.heightCm > 5) {
        badge.classList.add('badge-positive');
      } else if (item.heightCm < -5) {
        badge.classList.add('badge-negative');
      } else {
        badge.classList.add('badge-zero');
      }

      badge.style.left = `${item.x}px`;
      badge.style.top = `${item.y}px`;
      badge.textContent = item.text;

      this.labelsContainer.appendChild(badge);
    });
  }

  takeSnapshot() {
    const combineCanvas = document.createElement('canvas');
    combineCanvas.width = window.innerWidth;
    combineCanvas.height = window.innerHeight;
    const ctx = combineCanvas.getContext('2d');

    if (this.cameraManager.isSimulating) {
      ctx.drawImage(this.cameraManager.simCanvas, 0, 0);
    } else {
      ctx.drawImage(this.cameraManager.video, 0, 0, combineCanvas.width, combineCanvas.height);
    }

    ctx.drawImage(this.arEngine.canvas, 0, 0);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(16, combineCanvas.height - 45, 300, 32);
    ctx.fillStyle = '#00F0FF';
    ctx.font = 'bold 14px Outfit, sans-serif';
    ctx.fillText('ParkCaddy AR | Relative Green Depth Reader', 24, combineCanvas.height - 24);

    const imageURI = combineCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `ParkCaddy_Depth_Measurement_${Date.now()}.png`;
    link.href = imageURI;
    link.click();

    this.showToast('📸 그린 깊이 스냅샷 이미지가 저장되었습니다!');
  }

  showToast(message) {
    const toast = document.getElementById('toast-message');
    if (!toast) return;
    toast.querySelector('span').textContent = message;
    toast.classList.remove('hidden');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2500);
  }
}
