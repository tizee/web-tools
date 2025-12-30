/**
 * 3D Math Library for Wireframe Viewer
 * Provides Vec3 and Mat4 classes for 3D transformations
 */

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  add(v) {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v) {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  scale(s) {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    const len = this.length();
    if (len === 0) return new Vec3();
    return this.scale(1 / len);
  }

  // Transform by 4x4 matrix (assumes w=1 for points)
  transform(mat) {
    const m = mat.data;
    const w = m[3] * this.x + m[7] * this.y + m[11] * this.z + m[15];
    return new Vec3(
      (m[0] * this.x + m[4] * this.y + m[8] * this.z + m[12]) / w,
      (m[1] * this.x + m[5] * this.y + m[9] * this.z + m[13]) / w,
      (m[2] * this.x + m[6] * this.y + m[10] * this.z + m[14]) / w
    );
  }

  // Transform as direction (ignores translation, w=0)
  transformDirection(mat) {
    const m = mat.data;
    return new Vec3(
      m[0] * this.x + m[4] * this.y + m[8] * this.z,
      m[1] * this.x + m[5] * this.y + m[9] * this.z,
      m[2] * this.x + m[6] * this.y + m[10] * this.z
    );
  }
}


export class Mat4 {
  constructor() {
    // Column-major order (like OpenGL)
    this.data = new Float32Array(16);
    this.identity();
  }

  identity() {
    this.data.fill(0);
    this.data[0] = 1;
    this.data[5] = 1;
    this.data[10] = 1;
    this.data[15] = 1;
    return this;
  }

  clone() {
    const m = new Mat4();
    m.data.set(this.data);
    return m;
  }

  multiply(other) {
    const a = this.data;
    const b = other.data;
    const result = new Mat4();
    const r = result.data;

    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        r[col * 4 + row] =
          a[row] * b[col * 4] +
          a[4 + row] * b[col * 4 + 1] +
          a[8 + row] * b[col * 4 + 2] +
          a[12 + row] * b[col * 4 + 3];
      }
    }
    return result;
  }

  // Static factory methods
  static identity() {
    return new Mat4();
  }

  static translate(x, y, z) {
    const m = new Mat4();
    m.data[12] = x;
    m.data[13] = y;
    m.data[14] = z;
    return m;
  }

  static scale(x, y, z) {
    const m = new Mat4();
    m.data[0] = x;
    m.data[5] = y;
    m.data[10] = z;
    return m;
  }

  static rotateX(angle) {
    const m = new Mat4();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[5] = c;
    m.data[6] = s;
    m.data[9] = -s;
    m.data[10] = c;
    return m;
  }

  static rotateY(angle) {
    const m = new Mat4();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[0] = c;
    m.data[2] = -s;
    m.data[8] = s;
    m.data[10] = c;
    return m;
  }

  static rotateZ(angle) {
    const m = new Mat4();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[0] = c;
    m.data[1] = s;
    m.data[4] = -s;
    m.data[5] = c;
    return m;
  }

  static perspective(fovY, aspect, near, far) {
    const m = new Mat4();
    const f = 1.0 / Math.tan(fovY / 2);
    const rangeInv = 1.0 / (near - far);

    m.data[0] = f / aspect;
    m.data[5] = f;
    m.data[10] = (near + far) * rangeInv;
    m.data[11] = -1;
    m.data[14] = 2 * near * far * rangeInv;
    m.data[15] = 0;

    return m;
  }

  static lookAt(eye, target, up) {
    const zAxis = eye.sub(target).normalize();
    const xAxis = up.cross(zAxis).normalize();
    const yAxis = zAxis.cross(xAxis);

    const m = new Mat4();
    const d = m.data;

    d[0] = xAxis.x; d[1] = yAxis.x; d[2] = zAxis.x;
    d[4] = xAxis.y; d[5] = yAxis.y; d[6] = zAxis.y;
    d[8] = xAxis.z; d[9] = yAxis.z; d[10] = zAxis.z;
    d[12] = -xAxis.dot(eye);
    d[13] = -yAxis.dot(eye);
    d[14] = -zAxis.dot(eye);

    return m;
  }
}
