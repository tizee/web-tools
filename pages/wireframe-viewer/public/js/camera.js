/**
 * Camera system with orbit controls
 *
 * Coordinate system (Z-up):
 * - Default view: Camera on -Y axis, looking at origin
 * - X axis: points RIGHT on screen
 * - Z axis: points UP on screen
 *
 * Mouse drag orbits the CAMERA around the model:
 * - Horizontal drag: 360° orbit around Z axis (azimuth)
 *   - Drag right → camera moves right → model appears to rotate left (grab metaphor)
 * - Vertical drag: 180° from top to bottom (elevation: -90° to +90°)
 */

import { Vec3, Mat4 } from './math3d.js';

export class Camera {
  constructor() {
    // Projection parameters
    this.fov = Math.PI / 4;
    this.aspect = 1;
    this.near = 0.1;
    this.far = 1000;

    // Camera orbit parameters (spherical coordinates, Z-up)
    // azimuth: horizontal angle around Z axis [0, 2π), 0 = -Y direction
    // elevation: vertical angle from XY plane [-π/2, π/2], 0 = horizontal
    this.azimuth = 0;
    this.elevation = 0;  // Start at horizontal, Y perpendicular to screen
    this.distance = 5;

    // Distance limits
    this.minDistance = 0.5;
    this.maxDistance = 100;

    // Auto-rotation (rotates the model, not camera)
    this.rotationSpeed = 0.5;
    this.autoRotate = true;
    this.rotationAxis = 'Z';

    // Model rotation for auto-rotate
    this.modelRotationX = 0;
    this.modelRotationY = 0;
    this.modelRotationZ = 0;

    // Orbit center
    this.target = new Vec3(0, 0, 0);
  }

  setAspect(width, height) {
    this.aspect = width / height;
  }

  fitToMesh(mesh) {
    this.target = mesh.center.clone();

    const fovY = this.fov;
    const radius = mesh.radius;

    this.distance = (radius * 1.5) / Math.tan(fovY / 2);
    this.distance = Math.max(this.distance, radius * 2);

    // Set zoom limits based on model size
    this.minDistance = radius * 0.5;
    this.maxDistance = radius * 10;
  }

  /**
   * Reset model rotation to initial state
   */
  resetModelRotation() {
    this.modelRotationX = 0;
    this.modelRotationY = 0;
    this.modelRotationZ = 0;
  }

  /**
   * Update auto-rotation around selected axis
   */
  update(deltaTime) {
    if (this.autoRotate) {
      const delta = this.rotationSpeed * deltaTime;
      const TWO_PI = Math.PI * 2;

      switch (this.rotationAxis) {
        case 'X':
          this.modelRotationX = (this.modelRotationX + delta) % TWO_PI;
          break;
        case 'Y':
          this.modelRotationY = (this.modelRotationY + delta) % TWO_PI;
          break;
        case 'Z':
          this.modelRotationZ = (this.modelRotationZ + delta) % TWO_PI;
          break;
      }
    }
  }

  /**
   * Orbit camera around target
   * - deltaX: horizontal drag -> change azimuth (360°)
   * - deltaY: vertical drag -> change elevation (180°, from -90° to +90°)
   */
  orbit(deltaX, deltaY) {
    const TWO_PI = Math.PI * 2;
    const HALF_PI = Math.PI / 2;

    // Azimuth: full 360° around Z axis
    // Drag right (deltaX > 0) → azimuth increases → camera moves right → model appears to rotate left
    this.azimuth = ((this.azimuth + deltaX) % TWO_PI + TWO_PI) % TWO_PI;

    // Elevation: 180° range, from -90° (bottom) to +90° (top)
    this.elevation = Math.max(-HALF_PI + 0.001, Math.min(HALF_PI - 0.001, this.elevation + deltaY));
  }

  /**
   * Zoom by factor (positive = zoom in, negative = zoom out)
   */
  zoom(delta) {
    this.distance *= 1 - delta * 0.1;
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
  }

  /**
   * Get camera position in world space (Z-up spherical coordinates)
   *
   * Camera starts on -Y axis, so when looking at origin:
   * - X axis points RIGHT on screen
   * - Z axis points UP on screen
   *
   * Spherical to Cartesian (Z-up):
   *   x = r * cos(elevation) * sin(azimuth)
   *   y = -r * cos(elevation) * cos(azimuth)  // negative for -Y start
   *   z = r * sin(elevation)
   *
   * At azimuth=0, elevation=0: camera is at (0, -r, 0) looking at origin
   */
  getPosition() {
    const cosElev = Math.cos(this.elevation);
    const sinElev = Math.sin(this.elevation);
    const cosAzim = Math.cos(this.azimuth);
    const sinAzim = Math.sin(this.azimuth);

    const x = this.target.x + this.distance * cosElev * sinAzim;
    const y = this.target.y - this.distance * cosElev * cosAzim;  // negative Y
    const z = this.target.z + this.distance * sinElev;

    return new Vec3(x, y, z);
  }

  /**
   * Get view matrix with Z-up
   */
  getViewMatrix() {
    const position = this.getPosition();
    const up = new Vec3(0, 0, 1);  // Z is always up
    return Mat4.lookAt(position, this.target, up);
  }

  /**
   * Get model rotation matrix for auto-rotation
   */
  getModelMatrix() {
    const rx = Mat4.rotateX(this.modelRotationX);
    const ry = Mat4.rotateY(this.modelRotationY);
    const rz = Mat4.rotateZ(this.modelRotationZ);
    // Apply in order: Z -> Y -> X
    return rx.multiply(ry.multiply(rz));
  }

  getProjectionMatrix() {
    return Mat4.perspective(this.fov, this.aspect, this.near, this.far);
  }

  getViewProjectionMatrix() {
    const model = this.getModelMatrix();
    const view = this.getViewMatrix();
    const proj = this.getProjectionMatrix();
    // MVP = Projection * View * Model
    return proj.multiply(view).multiply(model);
  }
}
