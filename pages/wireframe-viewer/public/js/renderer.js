/**
 * WebGPU Renderer - Supports wireframe and solid rendering
 */

import { AxisHelper } from './axis-helper.js';

const SHADER_CODE = `
struct Uniforms {
  mvp: mat4x4f,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(@location(0) position: vec3f) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.mvp * vec4f(position, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return uniforms.color;
}
`;

// Textured shader with smooth shading using vertex normals
const TEXTURED_SHADER_CODE = `
struct Uniforms {
  mvp: mat4x4f,
  modelMatrix: mat4x4f,
  baseColorFactor: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var baseColorTexture: texture_2d<f32>;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
  @location(2) normal: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.mvp * vec4f(input.position, 1.0);
  output.color = input.color;
  output.uv = input.uv;
  // Transform normal by model matrix
  let normalMatrix = mat3x3f(
    uniforms.modelMatrix[0].xyz,
    uniforms.modelMatrix[1].xyz,
    uniforms.modelMatrix[2].xyz
  );
  output.normal = normalMatrix * input.normal;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Sample texture
  let texColor = textureSample(baseColorTexture, texSampler, input.uv);

  // Combine texture color with vertex color and base color factor
  var finalColor = texColor * input.color * uniforms.baseColorFactor;

  // Smooth shading using interpolated vertex normals
  let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, lightDir), 0.0);
  let ambient = 0.4;
  let lighting = ambient + diffuse * 0.6;

  return vec4f(finalColor.rgb * lighting, finalColor.a);
}
`;

// PBR shader with Cook-Torrance BRDF
const PBR_SHADER_CODE = `
const PI: f32 = 3.14159265359;
// Standard dielectric F0 (4% reflectance) - physically correct for most non-metals
// Let the model's roughness control the specularity, not artificial F0 reduction
const DIELECTRIC_F0: vec3f = vec3f(0.04);

struct PBRUniforms {
  mvp: mat4x4f,
  modelMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  cameraPosition: vec3f,
  exposure: f32,
  baseColorFactor: vec4f,
  metallicFactor: f32,
  roughnessFactor: f32,
  normalScale: f32,
  renderMode: u32,  // 0=PBR, 1=BaseColor, 2=Metalness, 3=Roughness, 4=SpecularF0, 5=Matcap, 6=AO
  iblIntensity: f32,
  directLightIntensity: f32,
  occlusionStrength: f32,  // AO strength from model material
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> uniforms: PBRUniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var baseColorTexture: texture_2d<f32>;
@group(0) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;
@group(0) @binding(4) var normalTexture: texture_2d<f32>;
@group(0) @binding(5) var matcapTexture: texture_2d<f32>;
@group(0) @binding(6) var brdfLUT: texture_2d<f32>;
@group(0) @binding(7) var occlusionTexture: texture_2d<f32>;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) color: vec4f,
  @location(3) uv: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let worldPos = (uniforms.modelMatrix * vec4f(input.position, 1.0)).xyz;
  output.worldPosition = worldPos;
  output.clipPosition = uniforms.mvp * vec4f(input.position, 1.0);

  // Transform normal to world space
  let normalMatrix = mat3x3f(
    uniforms.modelMatrix[0].xyz,
    uniforms.modelMatrix[1].xyz,
    uniforms.modelMatrix[2].xyz
  );
  output.worldNormal = normalize(normalMatrix * input.normal);

  output.color = input.color;
  output.uv = input.uv;
  return output;
}

// Perceptual roughness to alpha (GGX uses alpha = roughness²)
fn roughnessToAlpha(roughness: f32) -> f32 {
  return roughness * roughness;
}

// GGX Normal Distribution Function
fn D_GGX(NdotH: f32, alpha: f32) -> f32 {
  let a2 = alpha * alpha;
  let NdotH2 = NdotH * NdotH;
  let denom = NdotH2 * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom + 0.0001);
}

// Schlick-GGX Geometry Function (for direct lighting, k = (roughness+1)²/8)
fn G_SchlickGGX_Direct(NdotV: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k + 0.0001);
}

// Schlick-GGX Geometry Function (for IBL, k = roughness²/2)
fn G_SchlickGGX_IBL(NdotV: f32, roughness: f32) -> f32 {
  let k = roughnessToAlpha(roughness) / 2.0;
  return NdotV / (NdotV * (1.0 - k) + k + 0.0001);
}

// Smith's Geometry Function
fn G_Smith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  return G_SchlickGGX_Direct(NdotV, roughness) * G_SchlickGGX_Direct(NdotL, roughness);
}

// Fresnel-Schlick Approximation
fn F_Schlick(cosTheta: f32, F0: vec3f) -> vec3f {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Fresnel-Schlick with roughness (for IBL)
fn F_SchlickRoughness(cosTheta: f32, F0: vec3f, roughness: f32) -> vec3f {
  return F0 + (max(vec3f(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Approximate IBL diffuse irradiance from hemisphere
// Simulates a studio HDRI with softboxes above and neutral fill
fn getIBLDiffuse(N: vec3f, baseColor: vec3f) -> vec3f {
  // Studio lighting simulation using simplified Spherical Harmonics concept
  // Main light from above (softbox), fill from sides, dark floor

  // Directional components (pseudo-SH)
  let topLight = vec3f(1.0, 0.98, 0.95);      // Warm softbox from above
  let sideLight = vec3f(0.7, 0.73, 0.78);     // Cool fill from sides
  let bottomLight = vec3f(0.2, 0.18, 0.16);   // Dark floor bounce

  // Calculate contribution based on normal direction
  let upContrib = max(0.0, N.y);              // How much facing up
  let downContrib = max(0.0, -N.y);           // How much facing down
  let sideContrib = 1.0 - abs(N.y);           // How much facing sideways

  // Weighted combination (simulates irradiance from environment)
  let irradiance = topLight * upContrib * 0.5 +
                   sideLight * sideContrib * 0.4 +
                   bottomLight * downContrib * 0.2 +
                   vec3f(0.35, 0.37, 0.40);  // Constant ambient floor

  return baseColor * irradiance;
}

// Get pre-filtered environment color based on reflection direction
// Simulates studio HDRI with horizon line and softbox reflections
fn getEnvColor(R: vec3f, roughness: f32) -> vec3f {
  // Studio environment with distinct zones:
  // 1. Bright softbox/sky at top
  // 2. Bright horizon line (key feature of studio HDRIs)
  // 3. Dark floor below

  let ry = R.y;  // Vertical component of reflection

  var envColor: vec3f;

  if (ry > 0.3) {
    // Upper sky / softbox region - softer, less HDR punch
    let t = (ry - 0.3) / 0.7;
    let softboxColor = vec3f(0.95, 0.93, 0.9);  // Reduced from 1.2 - less harsh
    let skyColor = vec3f(0.8, 0.82, 0.85);      // Slightly dimmer sky
    envColor = mix(skyColor, softboxColor, t * t);
  } else if (ry > -0.1) {
    // Horizon band - softened to reduce "oily" appearance on rough surfaces
    let t = (ry + 0.1) / 0.4;
    let horizonGlow = exp(-pow((ry - 0.1) * 5.0, 2.0));
    let horizonColor = vec3f(0.9, 0.88, 0.85);  // Reduced from 1.1 - less harsh horizon
    let midColor = vec3f(0.55, 0.57, 0.6);      // Slightly darker mid
    envColor = mix(midColor, horizonColor, horizonGlow);
  } else {
    // Floor region - dark with slight color
    let t = (-ry - 0.1) / 0.9;
    let floorColor = vec3f(0.1, 0.09, 0.08);    // Dark floor
    let lowColor = vec3f(0.35, 0.33, 0.32);
    envColor = mix(lowColor, floorColor, t);
  }

  // Roughness blur simulation (smooth surfaces see sharp reflections)
  // As roughness increases, blend toward average environment color
  // For matte/rubber materials (roughness ~0.8-1.0), environment reflections
  // should be almost completely blurred out - no sharp horizon lines visible
  let avgEnv = vec3f(0.5, 0.5, 0.52);
  let blurFactor = roughness * roughness;  // Quadratic for perceptual linearity
  // Increased from 0.7 to 0.95 - rough surfaces should barely show environment detail
  envColor = mix(envColor, avgEnv, blurFactor * 0.95);

  return envColor;
}

// IBL specular using BRDF LUT (split-sum approximation)
// Uses model's roughness to control reflection blur
fn getIBLSpecular(R: vec3f, F0: vec3f, NdotV: f32, roughness: f32) -> vec3f {
  // Sample pre-filtered environment based on roughness
  let prefilteredColor = getEnvColor(R, roughness);

  // Sample BRDF LUT: x = NdotV, y = roughness
  let brdfUV = vec2f(NdotV, roughness);
  let brdf = textureSample(brdfLUT, texSampler, brdfUV);

  // Split-sum approximation: specular = prefilteredColor * (F0 * scale + bias)
  // This naturally handles roughness - rough surfaces get blurry environment
  let specular = prefilteredColor * (F0 * brdf.r + brdf.g);

  return specular;
}

// ACES Filmic Tone Mapping (fitted curve)
fn ACESFilm(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}

// Uncharted 2 Tone Mapping (alternative, softer)
fn Uncharted2Tonemap(x: vec3f) -> vec3f {
  let A = 0.15; let B = 0.50; let C = 0.10;
  let D = 0.20; let E = 0.02; let F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Sample textures
  let baseColorSample = textureSample(baseColorTexture, texSampler, input.uv);
  let mrSample = textureSample(metallicRoughnessTexture, texSampler, input.uv);
  let normalSample = textureSample(normalTexture, texSampler, input.uv);
  let aoSample = textureSample(occlusionTexture, texSampler, input.uv);

  // Combine base color from texture, vertex color, and factor
  let baseColor = baseColorSample * input.color * uniforms.baseColorFactor;

  // Extract metallic and roughness (glTF: G=roughness, B=metallic)
  // Use model's material values directly - don't override with arbitrary minimums
  let metallic = clamp(mrSample.b * uniforms.metallicFactor, 0.0, 1.0);
  // Minimum roughness 0.04 prevents numerical issues, but respects model's material
  let roughness = clamp(mrSample.g * uniforms.roughnessFactor, 0.04, 1.0);

  // Extract AO (stored in R channel per glTF spec)
  // Apply occlusionStrength: lerp between 1.0 (no occlusion) and texture value
  let aoRaw = aoSample.r;
  let ao = mix(1.0, aoRaw, uniforms.occlusionStrength);

  // Calculate F0 (Fresnel at 0 degrees)
  // For dielectrics: F0 = 0.04 (4% reflectance)
  // For metals: F0 = baseColor (the color IS the reflectance)
  // Note: Even "black" metals have minimum reflectance (~2%) due to physics
  let metalF0 = max(baseColor.rgb, vec3f(0.02));  // Minimum reflectance for metals
  let F0 = mix(DIELECTRIC_F0, metalF0, metallic);

  // === Channel Visualization Modes ===
  // For color channels (Base Color, F0), apply gamma correction (Linear -> sRGB)
  // For data channels (Metalness, Roughness, AO), output directly (they're already linear data)
  if (uniforms.renderMode == 1u) {
    // Base Color only - apply gamma correction since baseColor is in linear space
    // This shows the texture as it was authored (sRGB)
    let srgbColor = pow(baseColor.rgb, vec3f(1.0 / 2.2));
    return vec4f(srgbColor, 1.0);
  } else if (uniforms.renderMode == 2u) {
    // Metalness - data channel, no gamma needed
    return vec4f(vec3f(metallic), 1.0);
  } else if (uniforms.renderMode == 3u) {
    // Roughness - data channel, no gamma needed
    return vec4f(vec3f(roughness), 1.0);
  } else if (uniforms.renderMode == 4u) {
    // Specular F0 - color channel, apply gamma correction
    let srgbF0 = pow(F0, vec3f(1.0 / 2.2));
    return vec4f(srgbF0, 1.0);
  } else if (uniforms.renderMode == 5u) {
    // Matcap mode - use view-space normal to sample matcap texture
    // Matcap is typically authored in sRGB, so apply gamma correction
    let viewNormal = normalize((uniforms.viewMatrix * vec4f(input.worldNormal, 0.0)).xyz);
    let matcapUV = vec2f(viewNormal.x * 0.5 + 0.5, -viewNormal.y * 0.5 + 0.5);
    let matcapColor = textureSample(matcapTexture, texSampler, matcapUV);
    let srgbMatcap = pow(matcapColor.rgb, vec3f(1.0 / 2.2));
    return vec4f(srgbMatcap, matcapColor.a);
  } else if (uniforms.renderMode == 6u) {
    // Ambient Occlusion - data channel, no gamma needed
    return vec4f(vec3f(ao), 1.0);
  }

  // === Full PBR Rendering ===
  let N = normalize(input.worldNormal);
  let V = normalize(uniforms.cameraPosition - input.worldPosition);
  let R = reflect(-V, N);  // Reflection vector for IBL specular
  let NdotV = max(dot(N, V), 0.001);

  // Convert perceptual roughness to alpha for GGX
  let alpha = roughnessToAlpha(roughness);

  // === Three-Point Lighting Setup (Sketchfab style) ===
  // Direct lights provide definition, IBL provides ambient fill
  var directLighting = vec3f(0.0);

  // --- Key Light: Main light from top-right-front (warm, strongest) ---
  {
    let L = normalize(vec3f(0.5, 0.7, 0.5));
    let lightColor = vec3f(1.0, 0.98, 0.95);
    let intensity = uniforms.directLightIntensity * 0.5;

    let H = normalize(V + L);
    let NdotL = max(dot(N, L), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let D = D_GGX(NdotH, alpha);
    let G = G_Smith(NdotV, NdotL, roughness);
    let F = F_Schlick(HdotV, F0);

    let specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    var kD = (vec3f(1.0) - F) * (1.0 - metallic);
    let diffuse = kD * baseColor.rgb / PI;

    directLighting += (diffuse + specular) * lightColor * intensity * NdotL;
  }

  // --- Fill Light: Softer light from left side (cooler, dimmer) ---
  {
    let L = normalize(vec3f(-0.7, 0.3, 0.4));
    let lightColor = vec3f(0.9, 0.95, 1.0);
    let intensity = uniforms.directLightIntensity * 0.2;

    let H = normalize(V + L);
    let NdotL = max(dot(N, L), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let D = D_GGX(NdotH, alpha);
    let G = G_Smith(NdotV, NdotL, roughness);
    let F = F_Schlick(HdotV, F0);

    let specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    var kD = (vec3f(1.0) - F) * (1.0 - metallic);
    let diffuse = kD * baseColor.rgb / PI;

    directLighting += (diffuse + specular) * lightColor * intensity * NdotL;
  }

  // --- Back/Rim Light: From behind to create edge separation ---
  {
    let L = normalize(vec3f(0.0, 0.3, -0.9));
    let lightColor = vec3f(1.0, 1.0, 1.0);
    let intensity = uniforms.directLightIntensity * 0.3;

    let H = normalize(V + L);
    let NdotL = max(dot(N, L), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let D = D_GGX(NdotH, alpha);
    let G = G_Smith(NdotV, NdotL, roughness);
    let F = F_Schlick(HdotV, F0);

    let specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    var kD = (vec3f(1.0) - F) * (1.0 - metallic);
    let diffuse = kD * baseColor.rgb / PI;

    directLighting += (diffuse + specular) * lightColor * intensity * NdotL;
  }

  // === Image-Based Lighting (IBL) - The DOMINANT light source (70-80%) ===
  // This is what makes Sketchfab look "professional" - rich environment reflections
  let F_ibl = F_SchlickRoughness(NdotV, F0, roughness);

  // Diffuse IBL (irradiance from environment)
  let kS_ibl = F_ibl;
  var kD_ibl = vec3f(1.0) - kS_ibl;
  kD_ibl *= 1.0 - metallic;

  // Boost diffuse IBL significantly - this is the main fill light
  let iblDiffuse = getIBLDiffuse(N, baseColor.rgb) * kD_ibl * 1.2;

  // Specular IBL using BRDF LUT (split-sum approximation)
  // This gives metals their characteristic reflections
  var iblSpecular = getIBLSpecular(R, F0, NdotV, roughness);

  // For rough dielectrics (like rubber/matte plastic), further reduce specular
  // Rough non-metals should have almost no visible environment reflections
  // This prevents the "oily" look on matte materials
  let roughDielectricAttenuation = mix(1.0, 0.15, roughness * roughness * (1.0 - metallic));
  iblSpecular *= roughDielectricAttenuation;

  // IBL is the PRIMARY light source
  // AO affects IBL (indirect light), not direct lights
  let ambientLighting = (iblDiffuse + iblSpecular) * uniforms.iblIntensity * ao;

  // === Fresnel Rim Enhancement ===
  // Additional rim lighting based on Fresnel for edge definition
  // Reduce rim effect for rough surfaces - matte materials shouldn't have sharp rim
  let rimFresnel = pow(1.0 - NdotV, 4.0) * (1.0 - roughness * 0.8);
  let baseLuminance = dot(baseColor.rgb, vec3f(0.299, 0.587, 0.114));
  let rimBoost = max(0.2, 1.0 - baseLuminance);  // Dark objects get more rim

  // Rim uses material's actual roughness - rough surfaces blur rim reflections
  let rimEnvColor = getEnvColor(R, max(roughness, 0.5));  // Minimum 0.5 for rim
  let rimColor = rimEnvColor * rimFresnel * rimBoost * 0.2;

  // === Final Composition ===
  // IBL provides ambient fill (~70%), direct lights add definition (~30%)
  var color = ambientLighting + directLighting + rimColor;

  // === Exposure and Tone Mapping ===
  color = color * uniforms.exposure;

  // Apply ACES filmic tone mapping (prevents overexposure, better contrast)
  color = ACESFilm(color);

  // Gamma correction (linear -> sRGB)
  color = pow(color, vec3f(1.0 / 2.2));

  return vec4f(color, baseColor.a);
}
`;

// Simple colored shader (no texture) with smooth shading using vertex normals
const COLORED_SHADER_CODE = `
struct Uniforms {
  mvp: mat4x4f,
  modelMatrix: mat4x4f,
  baseColorFactor: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) normal: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.mvp * vec4f(input.position, 1.0);
  output.color = input.color;
  // Transform normal by model matrix (rotation only, so no need for inverse transpose)
  let normalMatrix = mat3x3f(
    uniforms.modelMatrix[0].xyz,
    uniforms.modelMatrix[1].xyz,
    uniforms.modelMatrix[2].xyz
  );
  output.normal = normalMatrix * input.normal;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var finalColor = input.color * uniforms.baseColorFactor;

  // Smooth shading using interpolated vertex normals
  let lightDir = normalize(vec3f(0.5, 1.0, 0.3));
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, lightDir), 0.0);
  let ambient = 0.4;
  let lighting = ambient + diffuse * 0.6;

  return vec4f(finalColor.rgb * lighting, finalColor.a);
}
`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;

    // Wireframe pipeline
    this.wireframePipeline = null;
    this.wireframeIndexBuffer = null;
    this.wireframeIndexCount = 0;

    // Textured/Colored pipeline (legacy)
    this.texturedPipeline = null;
    this.coloredPipeline = null;
    this.solidIndexBuffer = null;
    this.solidIndexCount = 0;
    this.solidUniformBuffer = null;
    this.texturedBindGroup = null;
    this.coloredBindGroup = null;

    // PBR pipeline
    this.pbrPipeline = null;
    this.pbrUniformBuffer = null;
    this.pbrBindGroup = null;
    this.pbrBindGroupLayout = null;

    // Texture resources
    this.modelTexture = null;
    this.sampler = null;
    this.hasTexture = false;
    this.baseColorFactor = [1, 1, 1, 1];

    // PBR texture resources
    this.baseColorTexture = null;
    this.metallicRoughnessTexture = null;
    this.normalTexture = null;
    this.matcapTexture = null;
    this.defaultWhiteTexture = null;  // 1x1 white for missing baseColor
    this.defaultMRTexture = null;     // 1x1 (0, 0.5, 0, 1) for default metallic=0, roughness=0.5
    this.defaultNormalTexture = null; // 1x1 (0.5, 0.5, 1, 1) for flat normal
    this.defaultMatcapTexture = null; // Default clay-like matcap
    this.brdfLUT = null;              // Pre-computed BRDF integration LUT for IBL
    this.occlusionTexture = null;     // Ambient occlusion texture
    this.defaultAOTexture = null;     // Default white (no occlusion)

    // PBR material properties
    this.pbrMaterial = {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 1.0,
      roughnessFactor: 1.0,
      normalScale: 1.0
    };
    this.renderMode = 0;  // 0=PBR, 1=BaseColor, 2=Metalness, 3=Roughness, 4=SpecularF0, 5=Matcap

    // Shared resources
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.vertexBuffer = null;  // Now includes position + color + uv
    this.depthTexture = null;
    this.axisHelper = null;

    this.settings = {
      color: '#00ff00',
      bgColor: '#1a1a2e',  // Dark gray background
      wireframe: true,  // Default to wireframe mode
      showNormals: false,
      normalLength: 0.1
    };

    // Lighting settings for PBR
    this.lightingSettings = {
      exposure: 1.2,
      iblIntensity: 0.8,
      directLightIntensity: 1.5
    };

    // Normal visualization
    this.normalVertexBuffer = null;
    this.normalVertexCount = 0;

    this.ready = false;
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No GPU adapter found');
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });

    // Vertex buffer layout for textured/colored rendering:
    // position(3) + normal(3) + color(4) + uv(2) = 12 floats = 48 bytes
    const texturedVertexLayout = {
      arrayStride: 48,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
        { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
        { shaderLocation: 2, offset: 24, format: 'float32x4' },  // color
        { shaderLocation: 3, offset: 40, format: 'float32x2' },  // uv
      ],
    };

    // === Wireframe Pipeline ===
    const wireframeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64 + 16,  // mvp + color
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.uniformBindGroup = this.device.createBindGroup({
      layout: wireframeBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer },
      }],
    });

    const wireframeShader = this.device.createShaderModule({ code: SHADER_CODE });

    this.wireframePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [wireframeBindGroupLayout] }),
      vertex: {
        module: wireframeShader,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 48,  // Use same vertex buffer (position + normal + color + uv)
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: wireframeShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    // === Colored Pipeline (no texture) ===
    const coloredBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.solidUniformBuffer = this.device.createBuffer({
      size: 64 + 64 + 16,  // mvp + modelMatrix + baseColorFactor
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.coloredBindGroup = this.device.createBindGroup({
      layout: coloredBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.solidUniformBuffer },
      }],
    });

    const coloredShader = this.device.createShaderModule({ code: COLORED_SHADER_CODE });

    this.coloredPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [coloredBindGroupLayout] }),
      vertex: {
        module: coloredShader,
        entryPoint: 'vertexMain',
        buffers: [texturedVertexLayout],
      },
      fragment: {
        module: coloredShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    // === Textured Pipeline ===
    this.texturedBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    const texturedShader = this.device.createShaderModule({ code: TEXTURED_SHADER_CODE });

    this.texturedPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.texturedBindGroupLayout] }),
      vertex: {
        module: texturedShader,
        entryPoint: 'vertexMain',
        buffers: [texturedVertexLayout],
      },
      fragment: {
        module: texturedShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    // === PBR Pipeline ===
    this.pbrBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // baseColorTexture
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // metallicRoughnessTexture
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // normalTexture
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // matcapTexture
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // brdfLUT
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: {} },  // occlusionTexture (AO)
      ],
    });

    // PBR uniform buffer layout:
    // mvp(64) + modelMatrix(64) + viewMatrix(64) + cameraPos(12) + exposure(4)
    // + baseColorFactor(16) + metallic(4) + roughness(4) + normalScale(4) + renderMode(4)
    // + iblIntensity(4) + directLightIntensity(4) + pad(8) = 256 bytes
    this.pbrUniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const pbrShader = this.device.createShaderModule({ code: PBR_SHADER_CODE });

    this.pbrPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.pbrBindGroupLayout] }),
      vertex: {
        module: pbrShader,
        entryPoint: 'vertexMain',
        buffers: [texturedVertexLayout],
      },
      fragment: {
        module: pbrShader,
        entryPoint: 'fragmentMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    // Create default textures for PBR
    this.createDefaultTextures();

    // Create axis helper
    this.axisHelper = new AxisHelper(this.device, this.format);

    this.ready = true;
    console.log('WebGPU initialized');
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.width = width;
    this.height = height;

    // Recreate depth texture on resize
    if (this.device) {
      this.depthTexture = this.device.createTexture({
        size: [this.canvas.width, this.canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  uploadMesh(mesh) {
    // Vertex buffer with position(3) + normal(3) + color(4) + uv(2) = 12 floats per vertex
    const vertexData = new Float32Array(mesh.vertices.length * 12);
    for (let i = 0; i < mesh.vertices.length; i++) {
      const offset = i * 12;
      // Position
      vertexData[offset] = mesh.vertices[i].x;
      vertexData[offset + 1] = mesh.vertices[i].y;
      vertexData[offset + 2] = mesh.vertices[i].z;
      // Normal
      const normal = mesh.normals[i] || { x: 0, y: 1, z: 0 };
      vertexData[offset + 3] = normal.x;
      vertexData[offset + 4] = normal.y;
      vertexData[offset + 5] = normal.z;
      // Color
      const color = mesh.colors[i] || [1, 1, 1, 1];
      vertexData[offset + 6] = color[0];
      vertexData[offset + 7] = color[1];
      vertexData[offset + 8] = color[2];
      vertexData[offset + 9] = color[3];
      // UV
      const uv = mesh.uvs[i] || [0, 0];
      vertexData[offset + 10] = uv[0];
      vertexData[offset + 11] = uv[1];
    }

    this.vertexBuffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData);

    // Wireframe index buffer (edges)
    const wireframeIndexData = new Uint32Array(mesh.edges.length * 2);
    for (let i = 0; i < mesh.edges.length; i++) {
      wireframeIndexData[i * 2] = mesh.edges[i][0];
      wireframeIndexData[i * 2 + 1] = mesh.edges[i][1];
    }

    this.wireframeIndexBuffer = this.device.createBuffer({
      size: wireframeIndexData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.wireframeIndexBuffer, 0, wireframeIndexData);
    this.wireframeIndexCount = wireframeIndexData.length;

    // Solid index buffer (triangles)
    const solidIndexData = new Uint32Array(mesh.triangles);

    this.solidIndexBuffer = this.device.createBuffer({
      size: solidIndexData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.solidIndexBuffer, 0, solidIndexData);
    this.solidIndexCount = solidIndexData.length;

    // Upload legacy texture if available (for backward compatibility)
    if (mesh.texture) {
      this.uploadTexture(mesh.texture);
      this.baseColorFactor = mesh.baseColorFactor || [1, 1, 1, 1];
    } else {
      this.hasTexture = false;
      this.baseColorFactor = [1, 1, 1, 1];
    }

    // Upload PBR textures
    this.uploadPBRTextures(mesh);

    // Store PBR material properties from model
    // NOTE: baseColorFactor is already baked into vertex colors in mesh.js,
    // so we use [1,1,1,1] here to avoid double-application
    this.pbrMaterial = {
      baseColorFactor: [1, 1, 1, 1],  // Don't double-apply, already in vertex colors
      metallicFactor: mesh.material?.metallicFactor ?? 1.0,
      roughnessFactor: mesh.material?.roughnessFactor ?? 1.0,
      normalScale: mesh.material?.normalScale ?? 1.0,
      occlusionStrength: mesh.material?.occlusionStrength ?? 1.0  // AO strength from model
    };

    // === PBR Debug: GPU Uniform Values ===
    console.log('%c[PBR Debug] ════════════════════════════════════════════════', 'color: #9C27B0; font-weight: bold');
    console.log('%c[PBR Debug] 🎮 GPU Uniform Values (sent to shader)', 'color: #9C27B0; font-weight: bold');
    console.log('%c[PBR Debug] ════════════════════════════════════════════════', 'color: #9C27B0; font-weight: bold');

    const hasBaseColorTex = !!mesh.textures?.baseColor;
    const hasMRTex = !!mesh.textures?.metallicRoughness;
    const hasNormalTex = !!mesh.textures?.normal;
    const hasAOTexture = !!mesh.textures?.occlusion;

    console.table({
      'metallicFactor': {
        value: this.pbrMaterial.metallicFactor,
        fromMesh: mesh.material?.metallicFactor ?? '(undefined)',
        effect: hasMRTex ? 'Multiplied with texture B channel' : 'Used directly'
      },
      'roughnessFactor': {
        value: this.pbrMaterial.roughnessFactor,
        fromMesh: mesh.material?.roughnessFactor ?? '(undefined)',
        effect: hasMRTex ? 'Multiplied with texture G channel' : 'Used directly'
      },
      'normalScale': {
        value: this.pbrMaterial.normalScale,
        fromMesh: mesh.material?.normalScale ?? '(undefined)'
      },
      'occlusionStrength': {
        value: this.pbrMaterial.occlusionStrength,
        fromMesh: mesh.material?.occlusionStrength ?? '(undefined)'
      }
    });

    console.log('%c[PBR Debug] Texture Status:', 'color: #9C27B0; font-weight: bold');
    console.table({
      'baseColorTexture': { loaded: hasBaseColorTex, using: hasBaseColorTex ? '📷 Model texture' : '⬜ Default white' },
      'metallicRoughnessTexture': { loaded: hasMRTex, using: hasMRTex ? '📷 Model texture' : '⬜ Default (1,1,1) passthrough' },
      'normalTexture': { loaded: hasNormalTex, using: hasNormalTex ? '📷 Model texture' : '⬜ Default flat normal' },
      'occlusionTexture': { loaded: hasAOTexture, using: hasAOTexture ? '📷 Model texture' : '⬜ Default white (no AO)' }
    });

    // Final computed values warning
    const finalRoughness = hasMRTex ? `texture.G * ${this.pbrMaterial.roughnessFactor}` : this.pbrMaterial.roughnessFactor;
    const finalMetallic = hasMRTex ? `texture.B * ${this.pbrMaterial.metallicFactor}` : this.pbrMaterial.metallicFactor;

    console.log('%c[PBR Debug] 📊 Final Shader Computation:', 'color: #673AB7; font-weight: bold');
    console.log(`  roughness = clamp(${finalRoughness}, 0.04, 1.0)`);
    console.log(`  metallic  = clamp(${finalMetallic}, 0.0, 1.0)`);

    if (this.pbrMaterial.roughnessFactor < 0.5 && !hasMRTex) {
      console.log('%c[PBR Debug] ⚠️ POTENTIAL ISSUE: Low roughness factor without MR texture!', 'color: #FF5722; font-weight: bold; font-size: 14px');
      console.log('%c[PBR Debug] This will cause a glossy/oily appearance.', 'color: #FF5722');
    }

    console.log('%c[PBR Debug] ════════════════════════════════════════════════', 'color: #9C27B0; font-weight: bold');
    console.log(`Uploaded to GPU: ${mesh.vertices.length} vertices, ${mesh.edges.length} edges, ${mesh.triangles.length / 3} triangles, hasTexture: ${this.hasTexture}`);

    // Store mesh reference for normal visualization
    this.currentMesh = mesh;
    this.updateNormalVisualization();
  }

  /**
   * Generate vertex buffer for normal visualization lines
   */
  updateNormalVisualization() {
    if (!this.currentMesh || !this.currentMesh.hasNormals) return;

    const mesh = this.currentMesh;
    const normalLength = this.settings.normalLength * mesh.radius;

    // Each normal is a line: 2 vertices * 12 floats (same layout as main vertex buffer)
    // But we only need position for lines, so use simpler format: 2 vertices * 3 floats
    // Actually, reuse the wireframe pipeline which expects arrayStride 48
    const vertexData = new Float32Array(mesh.vertices.length * 2 * 12);

    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i];
      const n = mesh.normals[i];

      // Start point (vertex position)
      const offset1 = i * 2 * 12;
      vertexData[offset1] = v.x;
      vertexData[offset1 + 1] = v.y;
      vertexData[offset1 + 2] = v.z;
      // Normal (not used for line but needed for buffer layout)
      vertexData[offset1 + 3] = n.x;
      vertexData[offset1 + 4] = n.y;
      vertexData[offset1 + 5] = n.z;
      // Color (not used)
      vertexData[offset1 + 6] = 1;
      vertexData[offset1 + 7] = 1;
      vertexData[offset1 + 8] = 1;
      vertexData[offset1 + 9] = 1;
      // UV (not used)
      vertexData[offset1 + 10] = 0;
      vertexData[offset1 + 11] = 0;

      // End point (vertex + normal * length)
      const offset2 = offset1 + 12;
      vertexData[offset2] = v.x + n.x * normalLength;
      vertexData[offset2 + 1] = v.y + n.y * normalLength;
      vertexData[offset2 + 2] = v.z + n.z * normalLength;
      // Normal
      vertexData[offset2 + 3] = n.x;
      vertexData[offset2 + 4] = n.y;
      vertexData[offset2 + 5] = n.z;
      // Color
      vertexData[offset2 + 6] = 1;
      vertexData[offset2 + 7] = 1;
      vertexData[offset2 + 8] = 1;
      vertexData[offset2 + 9] = 1;
      // UV
      vertexData[offset2 + 10] = 0;
      vertexData[offset2 + 11] = 0;
    }

    this.normalVertexBuffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.normalVertexBuffer, 0, vertexData);
    this.normalVertexCount = mesh.vertices.length * 2;
  }

  uploadTexture(image) {
    // Create GPU texture from image
    const texture = this.device.createTexture({
      size: [image.width, image.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.device.queue.copyExternalImageToTexture(
      { source: image },
      { texture: texture },
      [image.width, image.height]
    );

    this.modelTexture = texture;
    this.hasTexture = true;

    // Create bind group for textured rendering
    this.texturedBindGroup = this.device.createBindGroup({
      layout: this.texturedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.solidUniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.modelTexture.createView() },
      ],
    });

    console.log(`Texture uploaded: ${image.width}x${image.height}`);
  }

  /**
   * Create default 1x1 textures for PBR when maps are not provided
   */
  createDefaultTextures() {
    // Default white texture (1x1 white pixel)
    this.defaultWhiteTexture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.defaultWhiteTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1]
    );

    // Default metallic-roughness texture
    // glTF spec: when no texture, use factor values directly
    // So default texture should be (1,1,1) to pass through factors unchanged
    // R=unused, G=1.0 (roughness passthrough), B=1.0 (metallic passthrough), A=1
    this.defaultMRTexture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.defaultMRTexture },
      new Uint8Array([255, 255, 255, 255]),  // G=1.0 roughness, B=1.0 metallic (factors will control)
      { bytesPerRow: 4 },
      [1, 1]
    );

    // Default normal texture (flat normal: R=0.5, G=0.5, B=1.0 in tangent space)
    this.defaultNormalTexture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.defaultNormalTexture },
      new Uint8Array([128, 128, 255, 255]),  // (0.5, 0.5, 1.0) = flat normal
      { bytesPerRow: 4 },
      [1, 1]
    );

    // Default matcap texture (128x128 chrome/metallic style with horizon line)
    // This creates a professional studio-lit chrome sphere look
    const matcapSize = 128;
    const matcapData = new Uint8Array(matcapSize * matcapSize * 4);
    for (let y = 0; y < matcapSize; y++) {
      for (let x = 0; x < matcapSize; x++) {
        const idx = (y * matcapSize + x) * 4;
        // Normalize to [-1, 1]
        const nx = (x / (matcapSize - 1)) * 2 - 1;
        const ny = (y / (matcapSize - 1)) * 2 - 1;
        const dist = Math.sqrt(nx * nx + ny * ny);

        if (dist <= 1.0) {
          // Inside the sphere - chrome/metallic matcap
          const nz = Math.sqrt(1 - dist * dist);

          // Reflection vector for chrome look (as if reflecting environment)
          // R = 2 * N * (N.V) - V, where V = (0, 0, 1)
          const ry = -ny;  // Reflected Y component determines horizon

          // === Studio Environment Simulation ===
          // Top = bright sky/softbox, Middle = horizon line, Bottom = dark ground

          // Horizon line position (ry: -1 = top of sphere, +1 = bottom)
          let envBrightness;

          if (ry < -0.3) {
            // Upper region - bright sky/softbox reflection
            const t = (-ry - 0.3) / 0.7;  // 0 to 1 as we go up
            envBrightness = 0.7 + t * 0.5;  // 0.7 to 1.2 (HDR)
          } else if (ry < 0.1) {
            // Horizon band - bright highlight (the key feature of chrome matcaps)
            const t = (ry + 0.3) / 0.4;  // 0 to 1 across horizon
            // Gaussian-like falloff centered at horizon
            const horizonGlow = Math.exp(-((ry + 0.1) ** 2) * 20);
            envBrightness = 0.5 + horizonGlow * 0.8;
          } else {
            // Lower region - dark ground reflection
            const t = (ry - 0.1) / 0.9;  // 0 to 1 as we go down
            envBrightness = 0.5 - t * 0.4;  // 0.5 to 0.1
          }

          // Add a specular highlight (top-left light source)
          const lightDir = [0.4, -0.7, 0.6];  // Light from top-left-front
          const len = Math.sqrt(lightDir[0] ** 2 + lightDir[1] ** 2 + lightDir[2] ** 2);
          const lx = lightDir[0] / len, ly = lightDir[1] / len, lz = lightDir[2] / len;

          // Reflection of light direction
          const NdotL = nx * lx + (-ny) * ly + nz * lz;
          const Rx = 2 * NdotL * nx - lx;
          const Ry = 2 * NdotL * (-ny) - ly;
          const Rz = 2 * NdotL * nz - lz;

          // Specular highlight (view direction is (0, 0, 1))
          const RdotV = Math.max(0, Rz);
          const specular = Math.pow(RdotV, 64) * 1.5;  // Sharp highlight

          // Combine environment + specular
          const finalBrightness = Math.min(1.0, envBrightness + specular);

          // Slight blue tint for chrome look
          const r = Math.floor(Math.min(255, finalBrightness * 240));
          const g = Math.floor(Math.min(255, finalBrightness * 245));
          const b = Math.floor(Math.min(255, finalBrightness * 255));

          matcapData[idx] = r;
          matcapData[idx + 1] = g;
          matcapData[idx + 2] = b;
          matcapData[idx + 3] = 255;
        } else {
          // Outside sphere - black background
          matcapData[idx] = 0;
          matcapData[idx + 1] = 0;
          matcapData[idx + 2] = 0;
          matcapData[idx + 3] = 255;
        }
      }
    }

    this.defaultMatcapTexture = this.device.createTexture({
      size: [matcapSize, matcapSize],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.defaultMatcapTexture },
      matcapData,
      { bytesPerRow: matcapSize * 4 },
      [matcapSize, matcapSize]
    );

    // Generate BRDF LUT (128x128) for IBL split-sum approximation
    // X-axis: NdotV (0 to 1), Y-axis: roughness (0 to 1)
    // R: scale factor for F0, G: bias to add
    const brdfSize = 128;
    const brdfData = new Uint8Array(brdfSize * brdfSize * 4);

    for (let y = 0; y < brdfSize; y++) {
      for (let x = 0; x < brdfSize; x++) {
        const idx = (y * brdfSize + x) * 4;
        const NdotV = (x + 0.5) / brdfSize;
        const roughness = (y + 0.5) / brdfSize;

        // Integrate BRDF over hemisphere using importance sampling approximation
        // This is a simplified analytical fit that closely matches the numerical integration
        const { scale, bias } = this.integrateBRDF(NdotV, roughness);

        brdfData[idx] = Math.floor(Math.max(0, Math.min(1, scale)) * 255);
        brdfData[idx + 1] = Math.floor(Math.max(0, Math.min(1, bias)) * 255);
        brdfData[idx + 2] = 0;
        brdfData[idx + 3] = 255;
      }
    }

    this.brdfLUT = this.device.createTexture({
      size: [brdfSize, brdfSize],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.brdfLUT },
      brdfData,
      { bytesPerRow: brdfSize * 4 },
      [brdfSize, brdfSize]
    );

    // Default AO texture (1x1 white = no occlusion)
    this.defaultAOTexture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.defaultAOTexture },
      new Uint8Array([255, 255, 255, 255]),  // R=1.0 = full light, no occlusion
      { bytesPerRow: 4 },
      [1, 1]
    );

    console.log('Default PBR textures created (including BRDF LUT and AO)');
  }

  /**
   * Integrate BRDF for IBL split-sum approximation
   * Uses importance sampling with GGX distribution
   */
  integrateBRDF(NdotV, roughness) {
    const alpha = roughness * roughness;
    const alpha2 = alpha * alpha;

    // View vector in tangent space (N = 0,0,1)
    const V = [Math.sqrt(1 - NdotV * NdotV), 0, NdotV];

    let scale = 0;
    let bias = 0;
    const numSamples = 64;

    for (let i = 0; i < numSamples; i++) {
      // Hammersley sequence for quasi-random sampling
      const xi1 = i / numSamples;
      let xi2 = 0;
      let bits = i;
      bits = ((bits & 0xAAAAAAAA) >>> 1) | ((bits & 0x55555555) << 1);
      bits = ((bits & 0xCCCCCCCC) >>> 2) | ((bits & 0x33333333) << 2);
      bits = ((bits & 0xF0F0F0F0) >>> 4) | ((bits & 0x0F0F0F0F) << 4);
      bits = ((bits & 0xFF00FF00) >>> 8) | ((bits & 0x00FF00FF) << 8);
      xi2 = (((bits >>> 16) | (bits << 16)) >>> 0) * 2.3283064365386963e-10;

      // GGX importance sampling - sample halfway vector H
      const phi = 2 * Math.PI * xi1;
      const cosTheta = Math.sqrt((1 - xi2) / (1 + (alpha2 - 1) * xi2));
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);

      // H in tangent space
      const H = [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta];

      // L = reflect(-V, H) = 2 * dot(V, H) * H - V
      const VdotH = V[0] * H[0] + V[1] * H[1] + V[2] * H[2];
      const L = [2 * VdotH * H[0] - V[0], 2 * VdotH * H[1] - V[1], 2 * VdotH * H[2] - V[2]];

      const NdotL = Math.max(L[2], 0);
      const NdotH = Math.max(H[2], 0);

      if (NdotL > 0) {
        // Geometry term (Smith GGX)
        const k = alpha / 2;
        const G_V = NdotV / (NdotV * (1 - k) + k);
        const G_L = NdotL / (NdotL * (1 - k) + k);
        const G = G_V * G_L;

        const G_Vis = (G * VdotH) / (NdotH * NdotV + 0.0001);
        const Fc = Math.pow(1 - VdotH, 5);

        scale += (1 - Fc) * G_Vis;
        bias += Fc * G_Vis;
      }
    }

    scale /= numSamples;
    bias /= numSamples;

    return { scale, bias };
  }

  /**
   * Upload PBR textures and create bind group
   */
  uploadPBRTextures(mesh) {
    // Upload or use default base color texture
    if (mesh.textures?.baseColor) {
      this.baseColorTexture = this.createTextureFromImage(mesh.textures.baseColor);
      console.log('PBR: Base color texture uploaded');
    } else {
      this.baseColorTexture = this.defaultWhiteTexture;
    }

    // Upload or use default metallic-roughness texture
    if (mesh.textures?.metallicRoughness) {
      this.metallicRoughnessTexture = this.createTextureFromImage(mesh.textures.metallicRoughness);
      console.log('PBR: Metallic-roughness texture uploaded');
    } else {
      this.metallicRoughnessTexture = this.defaultMRTexture;
    }

    // Upload or use default normal texture
    if (mesh.textures?.normal) {
      this.normalTexture = this.createTextureFromImage(mesh.textures.normal);
      console.log('PBR: Normal texture uploaded');
    } else {
      this.normalTexture = this.defaultNormalTexture;
    }

    // Upload or use default matcap texture
    if (mesh.textures?.matcap) {
      this.matcapTexture = this.createTextureFromImage(mesh.textures.matcap);
      console.log('PBR: Matcap texture uploaded from model');
    } else {
      this.matcapTexture = this.defaultMatcapTexture;
    }

    // Upload or use default occlusion (AO) texture
    if (mesh.textures?.occlusion) {
      this.occlusionTexture = this.createTextureFromImage(mesh.textures.occlusion);
      console.log('PBR: Occlusion (AO) texture uploaded from model');
    } else {
      this.occlusionTexture = this.defaultAOTexture;
    }

    // Create PBR bind group
    this.pbrBindGroup = this.device.createBindGroup({
      layout: this.pbrBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.pbrUniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.baseColorTexture.createView() },
        { binding: 3, resource: this.metallicRoughnessTexture.createView() },
        { binding: 4, resource: this.normalTexture.createView() },
        { binding: 5, resource: this.matcapTexture.createView() },
        { binding: 6, resource: this.brdfLUT.createView() },
        { binding: 7, resource: this.occlusionTexture.createView() },
      ],
    });

    console.log('PBR bind group created');
  }

  /**
   * Create GPU texture from Image element
   */
  createTextureFromImage(image) {
    const texture = this.device.createTexture({
      size: [image.width, image.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.device.queue.copyExternalImageToTexture(
      { source: image },
      { texture: texture },
      [image.width, image.height]
    );

    return texture;
  }

  parseColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, 1.0];
  }

  render(mesh, camera) {
    if (!this.ready || !this.vertexBuffer || !this.depthTexture) return;

    const mvp = camera.getViewProjectionMatrix();
    const modelMatrix = camera.getModelMatrix();
    const viewMatrix = camera.getViewMatrix();
    const cameraPosition = camera.getPosition();

    const mvpArray = new Float32Array(mvp.data);
    const modelMatrixArray = new Float32Array(modelMatrix.data);
    const viewMatrixArray = new Float32Array(viewMatrix.data);
    const colorArray = new Float32Array(this.parseColor(this.settings.color));
    const baseColorArray = new Float32Array(this.baseColorFactor);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    const depthView = this.depthTexture.createView();

    // Parse background color
    const bg = this.parseColor(this.settings.bgColor);

    // Main render pass with depth buffer
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    if (this.settings.wireframe) {
      // Wireframe rendering
      this.device.queue.writeBuffer(this.uniformBuffer, 0, mvpArray);
      this.device.queue.writeBuffer(this.uniformBuffer, 64, colorArray);

      renderPass.setPipeline(this.wireframePipeline);
      renderPass.setBindGroup(0, this.uniformBindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.setIndexBuffer(this.wireframeIndexBuffer, 'uint32');
      renderPass.drawIndexed(this.wireframeIndexCount);
    } else if (this.pbrBindGroup) {
      // PBR rendering
      // Uniform layout (256 bytes total):
      // mvp(64) + modelMatrix(64) + viewMatrix(64) + cameraPos(12) + exposure(4)
      // + baseColorFactor(16) + metallic(4) + roughness(4) + normalScale(4) + renderMode(4)
      // + iblIntensity(4) + directLightIntensity(4) + pad(8)
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 0, mvpArray);
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 64, modelMatrixArray);
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 128, viewMatrixArray);
      // cameraPosition (vec3f) + exposure (f32) packed as vec4 at offset 192
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 192, new Float32Array([
        cameraPosition.x, cameraPosition.y, cameraPosition.z,
        this.lightingSettings.exposure
      ]));
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 208, new Float32Array(this.pbrMaterial.baseColorFactor));
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 224, new Float32Array([
        this.pbrMaterial.metallicFactor,
        this.pbrMaterial.roughnessFactor,
        this.pbrMaterial.normalScale
      ]));
      // renderMode (u32) at offset 236
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 236, new Uint32Array([this.renderMode]));
      // iblIntensity (f32) at offset 240, directLightIntensity (f32) at offset 244
      // occlusionStrength (f32) at offset 248
      this.device.queue.writeBuffer(this.pbrUniformBuffer, 240, new Float32Array([
        this.lightingSettings.iblIntensity,
        this.lightingSettings.directLightIntensity,
        this.pbrMaterial.occlusionStrength
      ]));

      renderPass.setPipeline(this.pbrPipeline);
      renderPass.setBindGroup(0, this.pbrBindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.setIndexBuffer(this.solidIndexBuffer, 'uint32');
      renderPass.drawIndexed(this.solidIndexCount);
    } else {
      // Fallback to legacy solid rendering
      this.device.queue.writeBuffer(this.solidUniformBuffer, 0, mvpArray);
      this.device.queue.writeBuffer(this.solidUniformBuffer, 64, modelMatrixArray);
      this.device.queue.writeBuffer(this.solidUniformBuffer, 128, baseColorArray);

      if (this.hasTexture && this.texturedBindGroup) {
        renderPass.setPipeline(this.texturedPipeline);
        renderPass.setBindGroup(0, this.texturedBindGroup);
      } else {
        renderPass.setPipeline(this.coloredPipeline);
        renderPass.setBindGroup(0, this.coloredBindGroup);
      }

      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.setIndexBuffer(this.solidIndexBuffer, 'uint32');
      renderPass.drawIndexed(this.solidIndexCount);
    }

    // Draw vertex normals if enabled
    if (this.settings.showNormals && this.normalVertexBuffer && this.normalVertexCount > 0) {
      // Ensure MVP is set in wireframe uniform buffer
      this.device.queue.writeBuffer(this.uniformBuffer, 0, mvpArray);
      // Use magenta color for normals to distinguish from wireframe
      const normalColor = new Float32Array([1.0, 0.0, 1.0, 1.0]);  // Magenta
      this.device.queue.writeBuffer(this.uniformBuffer, 64, normalColor);

      renderPass.setPipeline(this.wireframePipeline);
      renderPass.setBindGroup(0, this.uniformBindGroup);
      renderPass.setVertexBuffer(0, this.normalVertexBuffer);
      renderPass.draw(this.normalVertexCount);
    }

    renderPass.end();

    // Render axis helper
    this.axisHelper.render(commandEncoder, textureView, camera, this.width, this.height);

    this.device.queue.submit([commandEncoder.finish()]);
  }

  clear() {}

  updateSettings(settings) {
    const normalLengthChanged = settings.normalLength !== undefined &&
                                 settings.normalLength !== this.settings.normalLength;
    Object.assign(this.settings, settings);

    // Regenerate normal visualization if length changed
    if (normalLengthChanged && this.currentMesh) {
      this.updateNormalVisualization();
    }

    // Update render mode for PBR channel visualization
    if (settings.renderMode !== undefined) {
      this.renderMode = settings.renderMode;
    }

    // Update lighting settings
    if (settings.exposure !== undefined) {
      this.lightingSettings.exposure = settings.exposure;
    }
    if (settings.iblIntensity !== undefined) {
      this.lightingSettings.iblIntensity = settings.iblIntensity;
    }
    if (settings.directLightIntensity !== undefined) {
      this.lightingSettings.directLightIntensity = settings.directLightIntensity;
    }
  }

  getAxisLabelPositions() {
    if (this.axisHelper) {
      return this.axisHelper.getLabelPositions();
    }
    return null;
  }

  getAxisHelperConfig() {
    if (this.axisHelper) {
      return {
        size: this.axisHelper.size,
        margin: this.axisHelper.margin
      };
    }
    return { size: 100, margin: 10 };
  }
}
