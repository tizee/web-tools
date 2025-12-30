/**
 * Axis Helper - Renders a coordinate axis indicator with labels
 */

const AXIS_SHADER = `
struct Uniforms {
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) color: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let viewPos = uniforms.viewMatrix * vec4f(input.position, 1.0);
  output.position = uniforms.projMatrix * viewPos;
  output.color = input.color;
  return output;
}

@fragment
fn fragmentMain(@location(0) color: vec3f) -> @location(0) vec4f {
  return vec4f(color, 1.0);
}
`;

export class AxisHelper {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    this.size = 100;
    this.margin = 10;

    // Label positions (will be updated each frame)
    this.labelPositions = {
      x: { x: 0, y: 0 },
      y: { x: 0, y: 0 },
      z: { x: 0, y: 0 }
    };

    this.init();
  }

  init() {
    const axisData = new Float32Array([
      // X axis - Red
      0, 0, 0,  1, 0, 0,
      1, 0, 0,  1, 0, 0,
      // Y axis - Green
      0, 0, 0,  0, 1, 0,
      0, 1, 0,  0, 1, 0,
      // Z axis - Blue
      0, 0, 0,  0, 0.5, 1,
      0, 0, 1,  0, 0.5, 1,
    ]);

    this.vertexBuffer = this.device.createBuffer({
      size: axisData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, axisData);

    this.uniformBuffer = this.device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = this.device.createShaderModule({
      code: AXIS_SHADER,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      }],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer },
      }],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'line-list',
      },
    });
  }

  /**
   * Project a 3D point to 2D screen coordinates within the axis viewport
   */
  projectPoint(point, viewMatrix, projMatrix) {
    // Apply view matrix
    const vx = viewMatrix[0] * point[0] + viewMatrix[4] * point[1] + viewMatrix[8] * point[2] + viewMatrix[12];
    const vy = viewMatrix[1] * point[0] + viewMatrix[5] * point[1] + viewMatrix[9] * point[2] + viewMatrix[13];
    const vz = viewMatrix[2] * point[0] + viewMatrix[6] * point[1] + viewMatrix[10] * point[2] + viewMatrix[14];
    const vw = viewMatrix[3] * point[0] + viewMatrix[7] * point[1] + viewMatrix[11] * point[2] + viewMatrix[15];

    // Apply projection matrix
    const px = projMatrix[0] * vx + projMatrix[4] * vy + projMatrix[8] * vz + projMatrix[12] * vw;
    const py = projMatrix[1] * vx + projMatrix[5] * vy + projMatrix[9] * vz + projMatrix[13] * vw;
    const pw = projMatrix[3] * vx + projMatrix[7] * vy + projMatrix[11] * vz + projMatrix[15] * vw;

    // NDC to screen
    const ndcX = px / pw;
    const ndcY = py / pw;

    // Convert to viewport coordinates
    const screenX = (ndcX + 1) * 0.5 * this.size;
    const screenY = (1 - ndcY) * 0.5 * this.size;

    return { x: screenX, y: screenY };
  }

  render(commandEncoder, textureView, camera, canvasWidth, canvasHeight) {
    const viewMatrix = camera.getViewMatrix();
    const rotationOnly = new Float32Array(viewMatrix.data);
    rotationOnly[12] = 0;
    rotationOnly[13] = 0;
    rotationOnly[14] = -3;

    const projMatrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -0.01, 0,
      0, 0, 0, 1,
    ]);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, rotationOnly);
    this.device.queue.writeBuffer(this.uniformBuffer, 64, projMatrix);

    // Calculate label positions
    this.labelPositions.x = this.projectPoint([1.2, 0, 0], rotationOnly, projMatrix);
    this.labelPositions.y = this.projectPoint([0, 1.2, 0], rotationOnly, projMatrix);
    this.labelPositions.z = this.projectPoint([0, 0, 1.2], rotationOnly, projMatrix);

    const dpr = window.devicePixelRatio || 1;
    const viewportSize = this.size * dpr;
    const margin = this.margin * dpr;

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });

    renderPass.setViewport(
      margin,
      canvasHeight * dpr - viewportSize - margin,
      viewportSize,
      viewportSize,
      0, 1
    );
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(6);
    renderPass.end();
  }

  /**
   * Get label positions for HTML overlay
   */
  getLabelPositions() {
    return this.labelPositions;
  }
}
