/**
 * Mesh class for storing vertices and extracting edges
 */

import { Vec3 } from './math3d.js';

export class Mesh {
  constructor() {
    this.vertices = [];   // Array of Vec3
    this.normals = [];    // Array of Vec3 (vertex normals for smooth shading)
    this.colors = [];     // Array of [r, g, b, a] per vertex
    this.uvs = [];        // Array of [u, v] per vertex
    this.edges = [];      // Array of [index1, index2]
    this.triangles = [];  // Array of triangle indices [i0, i1, i2, ...]
    this.hasNormals = false;
    this.hasColors = false;
    this.hasUVs = false;

    // PBR texture maps
    this.textures = {
      baseColor: null,           // Image element for base color/albedo
      metallicRoughness: null,   // Image element (G=roughness, B=metallic)
      normal: null,              // Image element for tangent-space normal map
      occlusion: null,           // Image element for ambient occlusion (R channel)
      matcap: null               // Image element for matcap (if present in model)
    };

    // PBR material properties
    this.material = {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 1.0,
      roughnessFactor: 1.0,
      normalScale: 1.0,
      occlusionStrength: 1.0,
      isUnlit: false
    };

    // Legacy property for backward compatibility
    this.texture = null;
    this.baseColorFactor = [1, 1, 1, 1];

    this.boundingBox = {
      min: new Vec3(Infinity, Infinity, Infinity),
      max: new Vec3(-Infinity, -Infinity, -Infinity)
    };
    this.center = new Vec3();
    this.radius = 1;
  }

  /**
   * Build mesh from glTF geometry data
   * @param {Object} gltfData - Data from GLTFLoader.extractGeometry()
   */
  buildFromGLTF(gltfData) {
    const { positions: positionsArrays, indices: indicesArrays, colors: colorsArrays, uvs: uvsArrays, normals: normalsArrays, materials, images } = gltfData;

    const edgeSet = new Set();
    let vertexOffset = 0;

    for (let p = 0; p < positionsArrays.length; p++) {
      const positions = positionsArrays[p];
      const indices = indicesArrays[p];
      const colors = colorsArrays[p];
      const uvs = uvsArrays[p];
      const normals = normalsArrays[p];
      const material = materials[p];

      const vertexCount = positions.length / 3;

      // Get material color for this primitive (bake into vertex colors if no COLOR_0)
      const materialColor = material?.baseColorFactor || [1.0, 1.0, 1.0, 1.0];

      // Add vertices and attributes
      for (let i = 0; i < vertexCount; i++) {
        const v = new Vec3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        this.vertices.push(v);
        this.updateBoundingBox(v);

        // Add vertex color
        if (colors) {
          // Use actual vertex colors (COLOR_0 attribute)
          const stride = colors.length / vertexCount;
          if (stride === 3) {
            this.colors.push([colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], 1.0]);
          } else {
            this.colors.push([colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]]);
          }
          this.hasColors = true;
        } else {
          // Bake material's baseColorFactor into vertex colors
          // This handles per-primitive materials correctly
          this.colors.push([...materialColor]);
          this.hasColors = true;  // We have colors now (baked from material)
        }

        // Add UV coordinates (default to 0,0 if not present)
        if (uvs) {
          this.uvs.push([uvs[i * 2], uvs[i * 2 + 1]]);
          this.hasUVs = true;
        } else {
          this.uvs.push([0, 0]);
        }

        // Add vertex normal (for smooth shading)
        if (normals) {
          this.normals.push(new Vec3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]));
          this.hasNormals = true;
        } else {
          // Default normal pointing up (will be computed per-face in shader if needed)
          this.normals.push(new Vec3(0, 1, 0));
        }
      }

      // Store textures and material properties (use first primitive's material)
      if (p === 0 && material) {
        console.log('Material:', material, 'Images available:', images?.length || 0);

        // Base color texture
        if (material.textureIndex !== null && images && images[material.textureIndex]) {
          this.textures.baseColor = images[material.textureIndex];
          this.texture = this.textures.baseColor;  // Legacy compatibility
          console.log('Base color texture loaded from index:', material.textureIndex);
        }

        // Metallic-roughness texture
        if (material.metallicRoughnessTextureIndex !== null && images && images[material.metallicRoughnessTextureIndex]) {
          this.textures.metallicRoughness = images[material.metallicRoughnessTextureIndex];
          console.log('Metallic-roughness texture loaded from index:', material.metallicRoughnessTextureIndex);
        }

        // Normal texture
        if (material.normalTextureIndex !== null && images && images[material.normalTextureIndex]) {
          this.textures.normal = images[material.normalTextureIndex];
          console.log('Normal texture loaded from index:', material.normalTextureIndex);
        }

        // Occlusion (AO) texture
        if (material.occlusionTextureIndex !== null && images && images[material.occlusionTextureIndex]) {
          this.textures.occlusion = images[material.occlusionTextureIndex];
          console.log('Occlusion texture loaded from index:', material.occlusionTextureIndex);
        }

        // Store PBR material properties
        this.material.baseColorFactor = material.baseColorFactor || [1, 1, 1, 1];
        this.material.metallicFactor = material.metallicFactor ?? 1.0;
        this.material.roughnessFactor = material.roughnessFactor ?? 1.0;
        this.material.normalScale = material.normalScale ?? 1.0;
        this.material.occlusionStrength = material.occlusionStrength ?? 1.0;
        this.material.isUnlit = material.isUnlit || false;

        // Legacy compatibility
        this.baseColorFactor = this.material.baseColorFactor;

        console.log('PBR material loaded:', {
          metallic: this.material.metallicFactor,
          roughness: this.material.roughnessFactor,
          normalScale: this.material.normalScale,
          occlusionStrength: this.material.occlusionStrength,
          isUnlit: this.material.isUnlit,
          hasBaseColorTex: !!this.textures.baseColor,
          hasMRTex: !!this.textures.metallicRoughness,
          hasNormalTex: !!this.textures.normal,
          hasAOTex: !!this.textures.occlusion
        });
      }

      // Extract edges and triangles
      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] + vertexOffset;
        const i1 = indices[i + 1] + vertexOffset;
        const i2 = indices[i + 2] + vertexOffset;

        // Store triangle indices
        this.triangles.push(i0, i1, i2);

        // Extract unique edges
        this.addEdge(edgeSet, i0, i1);
        this.addEdge(edgeSet, i1, i2);
        this.addEdge(edgeSet, i2, i0);
      }

      vertexOffset += vertexCount;
    }

    // Convert edge set to array
    for (const key of edgeSet) {
      const [a, b] = key.split(',').map(Number);
      this.edges.push([a, b]);
    }

    this.calculateCenterAndRadius();
    console.log(`Mesh built: hasNormals=${this.hasNormals}, hasColors=${this.hasColors}, hasUVs=${this.hasUVs}, hasTexture=${!!this.texture}`);

    // Debug: sample vertex colors from different parts
    if (this.hasColors && this.colors.length > 0) {
      // Show colors from beginning, middle, and end to verify per-material coloring
      const samples = [
        { idx: 0, color: this.colors[0] },
        { idx: Math.floor(this.colors.length / 3), color: this.colors[Math.floor(this.colors.length / 3)] },
        { idx: Math.floor(this.colors.length * 2 / 3), color: this.colors[Math.floor(this.colors.length * 2 / 3)] },
      ];
      console.log('Sample vertex colors (from different primitives):', samples);
    }
  }

  /**
   * Add edge to set with normalized key
   */
  addEdge(edgeSet, i0, i1) {
    const min = Math.min(i0, i1);
    const max = Math.max(i0, i1);
    const key = `${min},${max}`;
    edgeSet.add(key);
  }

  /**
   * Update bounding box with vertex
   */
  updateBoundingBox(v) {
    this.boundingBox.min.x = Math.min(this.boundingBox.min.x, v.x);
    this.boundingBox.min.y = Math.min(this.boundingBox.min.y, v.y);
    this.boundingBox.min.z = Math.min(this.boundingBox.min.z, v.z);
    this.boundingBox.max.x = Math.max(this.boundingBox.max.x, v.x);
    this.boundingBox.max.y = Math.max(this.boundingBox.max.y, v.y);
    this.boundingBox.max.z = Math.max(this.boundingBox.max.z, v.z);
  }

  /**
   * Calculate center and bounding sphere radius, then center the model at origin
   */
  calculateCenterAndRadius() {
    const { min, max } = this.boundingBox;

    const center = new Vec3(
      (min.x + max.x) / 2,
      (min.y + max.y) / 2,
      (min.z + max.z) / 2
    );

    // Radius is half the diagonal
    const diagonal = max.sub(min);
    this.radius = diagonal.length() / 2;

    // Translate all vertices so model center is at world origin
    // This ensures rotation happens around the model's center
    for (let i = 0; i < this.vertices.length; i++) {
      this.vertices[i].x -= center.x;
      this.vertices[i].y -= center.y;
      this.vertices[i].z -= center.z;
    }

    // Update bounding box to reflect new positions
    this.boundingBox.min.x -= center.x;
    this.boundingBox.min.y -= center.y;
    this.boundingBox.min.z -= center.z;
    this.boundingBox.max.x -= center.x;
    this.boundingBox.max.y -= center.y;
    this.boundingBox.max.z -= center.z;

    // Center is now at origin
    this.center = new Vec3(0, 0, 0);
  }

  /**
   * Get statistics about the mesh
   */
  getStats() {
    return {
      vertices: this.vertices.length,
      edges: this.edges.length,
      triangles: this.triangles.length / 3
    };
  }
}
