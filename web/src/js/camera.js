/**
 * Camera Stream Manager with Mobile Permission Handling & Fallbacks
 */
export class CameraManager {
  constructor(videoElement, simCanvasElement, statusElement) {
    this.video = videoElement;
    this.simCanvas = simCanvasElement;
    this.statusEl = statusElement;
    this.stream = null;
    this.facingMode = 'environment'; // Rear camera priority
    this.isSimulating = false;
    this.simAnimId = null;
    this.hasPermission = false;
  }

  async init() {
    try {
      await this.startCamera();
      this.isSimulating = false;
      this.simCanvas.classList.add('hidden');
      this.video.style.display = 'block';
      this.hasPermission = true;
      this.updateStatus(true, 'CAM (LIVE)');
      this.hidePermissionOverlay();
    } catch (err) {
      console.warn('카메라 접근 권한이 필요합니다:', err);
      this.hasPermission = false;
      this.updateStatus(false, 'CAM (PERMISSION)');
      
      // On mobile HTTP or initial block, show tap-to-request permission banner
      this.showPermissionOverlay(err);
      
      // Default to demo simulation so user can still see 3D grid in action
      this.startSimulationMode();
    }
  }

  async startCamera() {
    if (this.stream) {
      this.stopCamera();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 브라우저는 보안(HTTPS) 연결이 필요하거나 카메라 API를 지원하지 않습니다.');
    }

    // Modern mobile camera constraints
    const constraints = {
      video: {
        facingMode: { ideal: this.facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  async toggleCamera() {
    if (this.isSimulating && !this.hasPermission) {
      // User tapped camera toggle while in demo mode -> Request camera permission!
      await this.init();
      return;
    }

    this.facingMode = (this.facingMode === 'environment') ? 'user' : 'environment';
    try {
      await this.startCamera();
      this.stopSimulation();
      this.simCanvas.classList.add('hidden');
      this.video.style.display = 'block';
    } catch (err) {
      console.error('카메라 전환 실패:', err);
    }
  }

  toggleSimulationMode() {
    if (this.isSimulating) {
      this.stopSimulation();
      this.init();
    } else {
      this.stopCamera();
      this.startSimulationMode();
    }
  }

  showPermissionOverlay(error) {
    let overlay = document.getElementById('camera-perm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'camera-perm-overlay';
      overlay.className = 'camera-perm-banner';
      overlay.innerHTML = `
        <div class="perm-card">
          <div class="perm-icon">📷</div>
          <div class="perm-text">
            <h3>스마트폰 카메라 허용 필요</h3>
            <p>실제 노면을 비추려면 아래 버튼을 눌러 카메라 권한을 허용해 주세요.</p>
            <span class="perm-sub">HTTPS 접속 URL: <b>https://f1ad61e35391db.lhr.life</b></span>
          </div>
          <button id="btn-request-cam" class="btn-primary-perm">📷 카메라 권한 허용 및 시작</button>
        </div>
      `;
      document.body.appendChild(overlay);

      document.getElementById('btn-request-cam').addEventListener('click', async () => {
        try {
          await this.startCamera();
          this.isSimulating = false;
          this.stopSimulation();
          this.simCanvas.classList.add('hidden');
          this.video.style.display = 'block';
          this.hasPermission = true;
          this.updateStatus(true, 'CAM (LIVE)');
          this.hidePermissionOverlay();
        } catch (e) {
          alert('카메라 권한을 얻지 못했습니다. 브라우저 설정에서 카메라 허용 상태를 확인해 주세요.');
        }
      });
    }
    overlay.style.display = 'flex';
  }

  hidePermissionOverlay() {
    const overlay = document.getElementById('camera-perm-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  startSimulationMode() {
    this.isSimulating = true;
    this.video.style.display = 'none';
    this.simCanvas.classList.remove('hidden');
    this.updateStatus(true, 'DEMO MODE');

    const ctx = this.simCanvas.getContext('2d');
    let frame = 0;

    const renderSim = () => {
      if (!this.isSimulating) return;

      const width = this.simCanvas.width = window.innerWidth;
      const height = this.simCanvas.height = window.innerHeight;

      // Render realistic Park Golf Green scene
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.4);
      skyGrad.addColorStop(0, '#1E3A8A');
      skyGrad.addColorStop(1, '#60A5FA');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height * 0.4);

      ctx.fillStyle = '#064E3B';
      for (let i = 0; i < width; i += 60) {
        const treeH = 60 + Math.sin(i * 0.05) * 20;
        ctx.beginPath();
        ctx.arc(i + 30, height * 0.4, treeH / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      const grassGrad = ctx.createLinearGradient(0, height * 0.35, 0, height);
      grassGrad.addColorStop(0, '#15803D');
      grassGrad.addColorStop(0.5, '#16A34A');
      grassGrad.addColorStop(1, '#052E16');
      ctx.fillStyle = grassGrad;
      ctx.fillRect(0, height * 0.38, width, height * 0.62);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      for (let y = height * 0.4; y < height; y += 40) {
        ctx.fillRect(0, y, width, 20);
      }

      const flagX = width * 0.7;
      const flagY = height * 0.48;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(flagX, flagY);
      ctx.lineTo(flagX, flagY - 70);
      ctx.stroke();

      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.moveTo(flagX, flagY - 70);
      ctx.lineTo(flagX - 35 + Math.sin(frame * 0.08) * 5, flagY - 55);
      ctx.lineTo(flagX, flagY - 40);
      ctx.fill();

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(flagX, flagY, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      frame++;
      this.simAnimId = requestAnimationFrame(renderSim);
    };

    renderSim();
  }

  stopSimulation() {
    this.isSimulating = false;
    if (this.simAnimId) {
      cancelAnimationFrame(this.simAnimId);
      this.simAnimId = null;
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
