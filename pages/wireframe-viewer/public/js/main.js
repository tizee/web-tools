/**
 * Tektronix Wireframe Viewer - WebGPU Version
 */

import { GLTFLoader } from './gltf-loader.js';
import { Mesh } from './mesh.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { createGUI } from './gui.js';

class App {
  constructor() {
    this.canvas = document.getElementById('render-canvas');
    this.dropZone = document.getElementById('drop-zone');
    this.loading = document.getElementById('loading');
    this.fileInput = document.getElementById('file-input');

    // Axis label elements
    this.axisLabelsContainer = document.getElementById('axis-labels');
    this.axisLabels = {
      x: document.getElementById('axis-x'),
      y: document.getElementById('axis-y'),
      z: document.getElementById('axis-z')
    };

    this.loader = new GLTFLoader();
    this.mesh = null;
    this.camera = new Camera();
    this.renderer = new Renderer(this.canvas);

    this.lastTime = 0;
    this.animationId = null;
    this.frameCount = 0;
    this.fpsTime = 0;

    // Mouse control state
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    this.init();
  }

  async init() {
    // Initialize WebGPU
    try {
      await this.renderer.init();
    } catch (error) {
      alert(`WebGPU Error: ${error.message}\n\nPlease use Chrome/Edge with WebGPU enabled.`);
      return;
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupDragDrop();
    this.setupMouseControls();

    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadFiles(e.target.files);
      }
    });

    this.dropZone.addEventListener('click', () => {
      this.fileInput.click();
    });

    const { gui, settings, stats } = createGUI(this);
    this.gui = gui;
    this.settings = settings;
    this.stats = stats;
    this.gui.domElement.style.display = 'none';

    // Apply initial settings (including background color)
    this.onSettingsChange(settings);
  }

  setupDragDrop() {
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        this.loadFiles(e.dataTransfer.files);
      }
    });
  }

  setupMouseControls() {
    // Mouse drag to rotate
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left button
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.camera.autoRotate = false;
        this.canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;

      // Convert pixel movement to rotation (adjust sensitivity)
      const sensitivity = 0.005;
      this.camera.orbit(-deltaX * sensitivity, deltaY * sensitivity);

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
      }
    });

    // Mouse wheel to zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      this.camera.zoom(delta);
    }, { passive: false });

    // Set initial cursor
    this.canvas.style.cursor = 'grab';
  }

  async loadFiles(files) {
    const hasMain = Array.from(files).some(f =>
      f.name.toLowerCase().endsWith('.gltf') ||
      f.name.toLowerCase().endsWith('.glb')
    );

    if (!hasMain) {
      alert('Please select a .gltf or .glb file');
      return;
    }

    this.loading.classList.remove('hidden');
    this.dropZone.classList.add('hidden');

    try {
      const fileNames = Array.from(files).map(f => f.name).join(', ');
      console.log('Loading files:', fileNames);

      const gltfData = await this.loader.load(files);
      console.log('Parsed geometry:', gltfData.positions.length, 'primitives');

      this.mesh = new Mesh();
      this.mesh.buildFromGLTF(gltfData);

      const meshStats = this.mesh.getStats();
      console.log(`Mesh: ${meshStats.vertices} vertices, ${meshStats.edges} edges`);

      // Update stats display
      this.stats.vertices = meshStats.vertices;
      this.stats.edges = meshStats.edges;

      // Upload mesh to GPU
      this.renderer.uploadMesh(this.mesh);

      this.camera.fitToMesh(this.mesh);
      this.camera.setAspect(this.canvas.clientWidth, this.canvas.clientHeight);

      this.loading.classList.add('hidden');
      this.gui.domElement.style.display = '';
      this.axisLabelsContainer.classList.remove('hidden');

      this.startRenderLoop();

    } catch (error) {
      console.error('Failed to load model:', error);
      alert(`Failed to load: ${error.message}`);
      this.loading.classList.add('hidden');
      this.dropZone.classList.remove('hidden');
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.resize(width, height);
    if (this.camera) {
      this.camera.setAspect(width, height);
    }
  }

  onSettingsChange(settings) {
    this.camera.rotationSpeed = settings.rotationSpeed;
    this.renderer.updateSettings({
      color: settings.color,
      bgColor: settings.bgColor,
      wireframe: settings.wireframe,
      showNormals: settings.showNormals,
      normalLength: settings.normalLength,
      renderMode: settings.renderMode,
      // Lighting settings for PBR
      exposure: settings.exposure,
      iblIntensity: settings.iblIntensity,
      directLightIntensity: settings.directLightIntensity
    });
  }

  startRenderLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.lastTime = performance.now();
    this.renderLoop();
  }

  renderLoop() {
    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Calculate FPS
    this.frameCount++;
    this.fpsTime += deltaTime;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    this.camera.update(deltaTime);
    this.renderer.render(this.mesh, this.camera);

    // Update axis label positions
    this.updateAxisLabels();

    this.animationId = requestAnimationFrame(() => this.renderLoop());
  }

  updateAxisLabels() {
    const positions = this.renderer.getAxisLabelPositions();
    if (!positions) return;

    const config = this.renderer.getAxisHelperConfig();
    const size = config.size;

    // Position labels within the axis-labels container (100x100, already at margin offset)
    // pos.x, pos.y are in viewport coordinates (0,0 at top-left, size at bottom-right)
    for (const axis of ['x', 'y', 'z']) {
      const pos = positions[axis];
      const label = this.axisLabels[axis];
      if (label && pos && !isNaN(pos.x) && !isNaN(pos.y)) {
        // Convert viewport coords to CSS positioning within container
        // left = pos.x (horizontal position in container)
        // bottom = size - pos.y (invert Y for CSS bottom)
        label.style.left = `${pos.x}px`;
        label.style.bottom = `${size - pos.y}px`;
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
