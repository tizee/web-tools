/**
 * lil-gui Control Panel - Sketchfab Model Inspector Style
 */

import GUI from 'lil-gui';

export const COLOR_PRESETS = {
  'P1 Green': '#00ff00',
  'P3 Amber': '#ffb000',
  'P31 Blue': '#00aaff',
  'P4 White': '#ffffff'
};

export const BG_PRESETS = {
  'Black': '#000000',
  'Dark Gray': '#1a1a2e',
  'Dark Blue': '#0f0f23',
  'Charcoal': '#2d2d2d',
  'Navy': '#1a1a3e',
  'Light Purple': '#c8b8d8'  // Similar to Sketchfab
};

// Render mode constants matching shader
export const RENDER_MODES = {
  'Final Render': 0,
  'Base Color': 1,
  'Metalness': 2,
  'Roughness': 3,
  'Specular F0': 4,
  'Matcap': 5,
  'Ambient Occlusion': 6  // New: Visualize AO channel
};

export function createGUI(app) {
  const gui = new GUI({ title: 'Model Inspector' });

  const settings = {
    // Render settings
    renderModeName: 'Final Render',
    renderMode: 0,

    // Lighting - balanced defaults for standard PBR
    exposure: 1.0,
    iblIntensity: 1.0,
    directLightIntensity: 1.0,

    // Geometry mode
    geometryMode: 'Shaded',  // Shaded, Wireframe, Normals
    wireframe: false,
    showNormals: false,
    normalLength: 0.1,

    // Wireframe appearance
    colorPreset: 'P1 Green',
    color: '#00ff00',

    // Background
    bgPreset: 'Light Purple',
    bgColor: '#c8b8d8',

    // Animation
    rotationSpeed: 0.5,
    autoRotate: true,
    rotationAxis: 'Z'
  };

  // Stats for FPS display
  const stats = {
    fps: 0,
    vertices: 0,
    edges: 0
  };

  // === Stats Folder ===
  const statsFolder = gui.addFolder('Stats');
  statsFolder.add(stats, 'fps').name('FPS').listen().disable();
  statsFolder.add(stats, 'vertices').name('Vertices').listen().disable();
  statsFolder.add(stats, 'edges').name('Edges').listen().disable();

  // === Render Mode Folder ===
  const renderFolder = gui.addFolder('Render');
  renderFolder.add(settings, 'renderModeName', Object.keys(RENDER_MODES))
    .name('Mode')
    .onChange((value) => {
      settings.renderMode = RENDER_MODES[value];
      // If switching to a material channel view, ensure we're not in wireframe mode
      if (settings.renderMode > 0 && settings.wireframe) {
        settings.wireframe = false;
        settings.geometryMode = 'Shaded';
        geometryModeController.updateDisplay();
      }
      app.onSettingsChange(settings);
    });

  // === Lighting Folder ===
  const lightingFolder = gui.addFolder('Lighting');
  lightingFolder.add(settings, 'exposure', 0.1, 3.0, 0.1)
    .name('Exposure')
    .onChange(() => app.onSettingsChange(settings));
  lightingFolder.add(settings, 'iblIntensity', 0.0, 2.0, 0.1)
    .name('Environment')
    .onChange(() => app.onSettingsChange(settings));
  lightingFolder.add(settings, 'directLightIntensity', 0.0, 3.0, 0.1)
    .name('Direct Light')
    .onChange(() => app.onSettingsChange(settings));

  // === Geometry Folder ===
  const geometryFolder = gui.addFolder('Geometry');
  const geometryModeController = geometryFolder.add(settings, 'geometryMode', ['Shaded', 'Wireframe', 'Vertex Normals'])
    .name('Display')
    .onChange((value) => {
      switch (value) {
        case 'Shaded':
          settings.wireframe = false;
          settings.showNormals = false;
          break;
        case 'Wireframe':
          settings.wireframe = true;
          settings.showNormals = false;
          break;
        case 'Vertex Normals':
          settings.wireframe = false;
          settings.showNormals = true;
          break;
      }
      app.onSettingsChange(settings);
    });

  geometryFolder.add(settings, 'normalLength', 0.01, 0.5, 0.01)
    .name('Normal Length')
    .onChange(() => app.onSettingsChange(settings));

  geometryFolder.add(settings, 'colorPreset', Object.keys(COLOR_PRESETS))
    .name('Wire Color')
    .onChange((value) => {
      settings.color = COLOR_PRESETS[value];
      app.onSettingsChange(settings);
    });

  // === Background Folder ===
  const bgFolder = gui.addFolder('Background');
  bgFolder.add(settings, 'bgPreset', Object.keys(BG_PRESETS))
    .name('Color')
    .onChange((value) => {
      settings.bgColor = BG_PRESETS[value];
      app.onSettingsChange(settings);
    });

  // === Animation Folder ===
  const animFolder = gui.addFolder('Animation');
  animFolder.add(settings, 'autoRotate')
    .name('Auto Rotate')
    .onChange((value) => {
      if (app.camera) {
        app.camera.autoRotate = value;
      }
    });

  animFolder.add(settings, 'rotationSpeed', 0.1, 2, 0.1)
    .name('Speed')
    .onChange(() => app.onSettingsChange(settings));

  animFolder.add(settings, 'rotationAxis', ['X', 'Y', 'Z'])
    .name('Axis')
    .onChange((value) => {
      if (app.camera) {
        app.camera.resetModelRotation();
        app.camera.rotationAxis = value;
        app.camera.autoRotate = true;
        settings.autoRotate = true;
        // Update display
        animFolder.controllers.forEach(c => {
          if (c.property === 'autoRotate') c.updateDisplay();
        });
      }
    });

  // Close some folders by default for cleaner look
  statsFolder.close();
  animFolder.close();

  return { gui, settings, stats };
}
