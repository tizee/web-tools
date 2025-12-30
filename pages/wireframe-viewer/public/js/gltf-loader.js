/**
 * glTF/GLB Loader
 * Supports: .glb, .gltf with embedded data, .gltf + external .bin
 */

const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array
};

const COMPONENT_SIZES = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4
};

const TYPE_COUNTS = {
  'SCALAR': 1,
  'VEC2': 2,
  'VEC3': 3,
  'VEC4': 4,
  'MAT2': 4,
  'MAT3': 9,
  'MAT4': 16
};

export class GLTFLoader {
  constructor() {
    this.json = null;
    this.buffers = [];
    this.images = [];  // Loaded image data
  }

  /**
   * Load from multiple files (gltf + bin)
   * @param {FileList|File[]} files
   */
  async load(files) {
    this.buffers = [];

    // Convert to array
    const fileArray = Array.from(files);

    // Find gltf/glb file
    const mainFile = fileArray.find(f =>
      f.name.toLowerCase().endsWith('.gltf') ||
      f.name.toLowerCase().endsWith('.glb')
    );

    if (!mainFile) {
      throw new Error('No .gltf or .glb file found');
    }

    const ext = mainFile.name.toLowerCase().split('.').pop();

    if (ext === 'glb') {
      const arrayBuffer = await mainFile.arrayBuffer();
      this.parseGLB(arrayBuffer);
    } else {
      // gltf file - may have external bin
      const arrayBuffer = await mainFile.arrayBuffer();
      await this.parseGLTF(arrayBuffer, fileArray);
    }

    // Load images for textures
    await this.loadImages(fileArray);

    return this.extractGeometry();
  }

  /**
   * Load images from glTF
   */
  async loadImages(files) {
    if (!this.json.images) {
      console.log('No images in glTF');
      return;
    }

    console.log(`Loading ${this.json.images.length} images...`);

    for (let i = 0; i < this.json.images.length; i++) {
      const imageDef = this.json.images[i];
      let imageData = null;

      console.log(`Image ${i}:`, imageDef);

      if (imageDef.bufferView !== undefined) {
        // Image embedded in buffer (common in GLB)
        const bufferView = this.json.bufferViews[imageDef.bufferView];
        const buffer = this.buffers[bufferView.buffer];

        if (!buffer) {
          console.log(`Buffer ${bufferView.buffer} not found`);
          continue;
        }

        const byteOffset = bufferView.byteOffset || 0;
        const byteLength = bufferView.byteLength;

        console.log(`Image ${i}: bufferView=${imageDef.bufferView}, offset=${byteOffset}, length=${byteLength}, bufferSize=${buffer.byteLength}`);

        // Create a view into the buffer
        const imageBytes = new Uint8Array(buffer, byteOffset, byteLength);
        const mimeType = imageDef.mimeType || 'image/png';
        const blob = new Blob([imageBytes], { type: mimeType });

        console.log(`Created blob: ${blob.size} bytes, type: ${mimeType}`);

        imageData = await this.loadImageFromBlob(blob);

        if (imageData) {
          console.log(`Image ${i} loaded: ${imageData.width}x${imageData.height}`);
        } else {
          console.log(`Image ${i} failed to load`);
        }
      } else if (imageDef.uri) {
        if (imageDef.uri.startsWith('data:')) {
          // Base64 embedded
          imageData = await this.loadImageFromDataURI(imageDef.uri);
        } else {
          // External file
          const imageFileName = imageDef.uri.split('/').pop();
          const imageFile = files.find(f =>
            f.name.toLowerCase() === imageFileName.toLowerCase()
          );
          if (imageFile) {
            imageData = await this.loadImageFromBlob(imageFile);
          } else {
            console.log(`External image not found: ${imageFileName}`);
          }
        }
      }

      this.images[i] = imageData;
    }

    console.log(`Loaded images:`, this.images.filter(img => img !== null).length, 'of', this.json.images.length);
  }

  async loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  async loadImageFromDataURI(dataURI) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataURI;
    });
  }

  parseGLB(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);

    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546C67) {
      throw new Error('Invalid GLB file');
    }

    const version = dataView.getUint32(4, true);
    if (version !== 2) {
      throw new Error(`Unsupported glTF version: ${version}`);
    }

    let offset = 12;
    const jsonChunkLength = dataView.getUint32(offset, true);
    const jsonChunkType = dataView.getUint32(offset + 4, true);

    if (jsonChunkType !== 0x4E4F534A) {
      throw new Error('First chunk is not JSON');
    }

    const jsonBytes = new Uint8Array(arrayBuffer, offset + 8, jsonChunkLength);
    this.json = JSON.parse(new TextDecoder().decode(jsonBytes));

    // Debug: log glTF structure
    console.log('=== glTF JSON Structure ===');
    console.log('Materials:', this.json.materials?.length || 0, this.json.materials);
    console.log('Textures:', this.json.textures?.length || 0, this.json.textures);
    console.log('Images:', this.json.images?.length || 0, this.json.images);
    console.log('Samplers:', this.json.samplers?.length || 0);
    if (this.json.meshes) {
      for (let i = 0; i < this.json.meshes.length; i++) {
        const mesh = this.json.meshes[i];
        console.log(`Mesh ${i}:`, mesh.name || 'unnamed');
        for (let j = 0; j < mesh.primitives.length; j++) {
          const prim = mesh.primitives[j];
          console.log(`  Primitive ${j}: material=${prim.material}, attributes=`, Object.keys(prim.attributes));
        }
      }
    }
    console.log('===========================');

    offset += 8 + jsonChunkLength;

    if (offset < arrayBuffer.byteLength) {
      const binChunkLength = dataView.getUint32(offset, true);
      const binChunkType = dataView.getUint32(offset + 4, true);

      if (binChunkType === 0x004E4942) {
        this.buffers[0] = arrayBuffer.slice(offset + 8, offset + 8 + binChunkLength);
        console.log(`GLB binary chunk: ${binChunkLength} bytes`);
      }
    }
  }

  async parseGLTF(arrayBuffer, files) {
    const text = new TextDecoder().decode(arrayBuffer);
    this.json = JSON.parse(text);

    // Debug: log glTF structure
    console.log('=== glTF JSON Structure ===');
    console.log('Materials:', this.json.materials?.length || 0, this.json.materials);
    console.log('Textures:', this.json.textures?.length || 0, this.json.textures);
    console.log('Images:', this.json.images?.length || 0, this.json.images);
    console.log('Samplers:', this.json.samplers?.length || 0);
    if (this.json.meshes) {
      for (let i = 0; i < this.json.meshes.length; i++) {
        const mesh = this.json.meshes[i];
        console.log(`Mesh ${i}:`, mesh.name || 'unnamed');
        for (let j = 0; j < mesh.primitives.length; j++) {
          const prim = mesh.primitives[j];
          console.log(`  Primitive ${j}: material=${prim.material}, attributes=`, Object.keys(prim.attributes));
        }
      }
    }
    console.log('===========================');

    if (!this.json.buffers) return;

    for (let i = 0; i < this.json.buffers.length; i++) {
      const bufferDef = this.json.buffers[i];

      if (bufferDef.uri) {
        if (bufferDef.uri.startsWith('data:')) {
          // Base64 embedded
          const base64 = bufferDef.uri.split(',')[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) {
            bytes[j] = binary.charCodeAt(j);
          }
          this.buffers[i] = bytes.buffer;
        } else {
          // External file - find in uploaded files
          const binFileName = bufferDef.uri.split('/').pop();
          const binFile = files.find(f =>
            f.name.toLowerCase() === binFileName.toLowerCase()
          );

          if (binFile) {
            this.buffers[i] = await binFile.arrayBuffer();
            console.log(`Loaded external buffer: ${binFileName}`);
          } else {
            throw new Error(`Missing buffer file: ${binFileName}\nPlease upload both .gltf and .bin files together.`);
          }
        }
      }
    }
  }

  getAccessorData(accessorIndex) {
    const accessor = this.json.accessors[accessorIndex];

    if (accessor.bufferView === undefined) {
      const typeCount = TYPE_COUNTS[accessor.type];
      const TypedArray = COMPONENT_TYPES[accessor.componentType];
      return new TypedArray(accessor.count * typeCount);
    }

    const bufferView = this.json.bufferViews[accessor.bufferView];
    const buffer = this.buffers[bufferView.buffer];

    if (!buffer) {
      throw new Error(`Buffer ${bufferView.buffer} not loaded`);
    }

    const TypedArray = COMPONENT_TYPES[accessor.componentType];
    const componentSize = COMPONENT_SIZES[accessor.componentType];
    const typeCount = TYPE_COUNTS[accessor.type];
    const count = accessor.count;

    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const byteStride = bufferView.byteStride || 0;

    const result = new TypedArray(count * typeCount);
    const view = new DataView(buffer);
    const stride = byteStride || componentSize * typeCount;

    for (let i = 0; i < count; i++) {
      const elementOffset = byteOffset + i * stride;
      for (let j = 0; j < typeCount; j++) {
        const valueOffset = elementOffset + j * componentSize;
        switch (accessor.componentType) {
          case 5126:
            result[i * typeCount + j] = view.getFloat32(valueOffset, true);
            break;
          case 5123:
            result[i * typeCount + j] = view.getUint16(valueOffset, true);
            break;
          case 5125:
            result[i * typeCount + j] = view.getUint32(valueOffset, true);
            break;
          case 5121:
            result[i * typeCount + j] = view.getUint8(valueOffset);
            break;
          case 5122:
            result[i * typeCount + j] = view.getInt16(valueOffset, true);
            break;
          case 5120:
            result[i * typeCount + j] = view.getInt8(valueOffset);
            break;
        }
      }
    }

    return result;
  }

  extractGeometry() {
    const allPositions = [];
    const allIndices = [];
    const allColors = [];
    const allUVs = [];
    const allNormals = [];
    const allMaterials = [];

    if (!this.json.meshes || this.json.meshes.length === 0) {
      throw new Error('No meshes found in glTF file');
    }

    for (const mesh of this.json.meshes) {
      for (const primitive of mesh.primitives) {
        if (primitive.attributes.POSITION === undefined) continue;

        const positions = this.getAccessorData(primitive.attributes.POSITION);

        let indices;
        if (primitive.indices !== undefined) {
          indices = this.getAccessorData(primitive.indices);
        } else {
          const vertexCount = positions.length / 3;
          indices = new Uint32Array(vertexCount);
          for (let i = 0; i < vertexCount; i++) indices[i] = i;
        }

        // Extract vertex colors (COLOR_0)
        let colors = null;
        if (primitive.attributes.COLOR_0 !== undefined) {
          const colorAccessor = this.json.accessors[primitive.attributes.COLOR_0];
          colors = this.getAccessorData(primitive.attributes.COLOR_0);

          // Normalize colors if stored as unsigned bytes (0-255 -> 0-1)
          if (colorAccessor.componentType === 5121) {  // UNSIGNED_BYTE
            console.log('Normalizing vertex colors from UNSIGNED_BYTE');
            colors = Array.from(colors).map(v => v / 255);
          } else if (colorAccessor.componentType === 5123) {  // UNSIGNED_SHORT
            console.log('Normalizing vertex colors from UNSIGNED_SHORT');
            colors = Array.from(colors).map(v => v / 65535);
          }
          console.log('COLOR_0 componentType:', colorAccessor.componentType, 'type:', colorAccessor.type);
        }

        // Extract UV coordinates (TEXCOORD_0)
        let uvs = null;
        if (primitive.attributes.TEXCOORD_0 !== undefined) {
          uvs = this.getAccessorData(primitive.attributes.TEXCOORD_0);
        }

        // Extract vertex normals (NORMAL)
        let normals = null;
        if (primitive.attributes.NORMAL !== undefined) {
          normals = this.getAccessorData(primitive.attributes.NORMAL);
          console.log('Loaded vertex normals for primitive');
        }

        // Extract material info
        let material = this.extractMaterial(primitive.material);

        allPositions.push(Array.from(positions));
        allIndices.push(Array.from(indices));
        allColors.push(colors ? Array.from(colors) : null);
        allUVs.push(uvs ? Array.from(uvs) : null);
        allNormals.push(normals ? Array.from(normals) : null);
        allMaterials.push(material);
      }
    }

    if (allPositions.length === 0) {
      throw new Error('No valid geometry found');
    }

    return {
      positions: allPositions,
      indices: allIndices,
      colors: allColors,
      uvs: allUVs,
      normals: allNormals,
      materials: allMaterials,
      images: this.images
    };
  }

  /**
   * Extract material information including PBR properties
   */
  extractMaterial(materialIndex) {
    if (materialIndex === undefined || !this.json.materials) {
      console.log('%c[PBR Debug] No material specified, using defaults', 'color: orange; font-weight: bold');
      console.table({
        'metallicFactor': { value: 1.0, source: 'default (no material)' },
        'roughnessFactor': { value: 1.0, source: 'default (no material)' }
      });
      return {
        baseColorFactor: [0.8, 0.8, 0.8, 1.0],
        textureIndex: null,
        metallicFactor: 1.0,
        roughnessFactor: 1.0,
        metallicRoughnessTextureIndex: null,
        normalTextureIndex: null,
        normalScale: 1.0,
        isUnlit: false
      };
    }

    const material = this.json.materials[materialIndex];
    const materialName = material.name || `Material_${materialIndex}`;

    console.log(`%c[PBR Debug] ══════════════════════════════════════`, 'color: #4CAF50; font-weight: bold');
    console.log(`%c[PBR Debug] Loading Material: "${materialName}" (index: ${materialIndex})`, 'color: #4CAF50; font-weight: bold');
    console.log('%c[PBR Debug] Raw material JSON:', 'color: #2196F3', material);

    const pbr = material.pbrMetallicRoughness || {};
    console.log('%c[PBR Debug] pbrMetallicRoughness block:', 'color: #2196F3', pbr);

    let baseColorFactor = pbr.baseColorFactor || [1.0, 1.0, 1.0, 1.0];
    let textureIndex = null;

    // PBR metallic-roughness properties
    // Note: glTF spec defaults to metallic=1.0, but most non-PBR models expect metallic=0
    // We use 0.0 as default for better compatibility with models that don't specify
    // Default roughness 0.8 for matte appearance when not specified (avoids "oily" look)
    const metallicFromModel = pbr.metallicFactor;
    const roughnessFromModel = pbr.roughnessFactor;
    const metallicFactor = metallicFromModel ?? 0.0;
    const roughnessFactor = roughnessFromModel ?? 0.8;
    let metallicRoughnessTextureIndex = null;
    let normalTextureIndex = null;
    let normalScale = 1.0;

    // Check for baseColorTexture in PBR
    if (pbr.baseColorTexture) {
      const textureInfo = pbr.baseColorTexture;
      if (this.json.textures && this.json.textures[textureInfo.index]) {
        const texture = this.json.textures[textureInfo.index];
        textureIndex = texture.source;
        console.log(`%c[PBR Debug] ✓ baseColorTexture found`, 'color: #4CAF50', { textureIndex: textureInfo.index, imageSource: textureIndex });
      }
    } else {
      console.log(`%c[PBR Debug] ✗ No baseColorTexture`, 'color: #FF9800');
    }

    // Extract metallicRoughnessTexture (glTF spec: G=roughness, B=metallic)
    if (pbr.metallicRoughnessTexture) {
      const textureInfo = pbr.metallicRoughnessTexture;
      if (this.json.textures && this.json.textures[textureInfo.index]) {
        const texture = this.json.textures[textureInfo.index];
        metallicRoughnessTextureIndex = texture.source;
        console.log(`%c[PBR Debug] ✓ metallicRoughnessTexture found (G=roughness, B=metallic)`, 'color: #4CAF50', { textureIndex: textureInfo.index, imageSource: metallicRoughnessTextureIndex });
      }
    } else {
      console.log(`%c[PBR Debug] ✗ No metallicRoughnessTexture - using factor values only`, 'color: #FF9800');
    }

    // Extract normalTexture
    if (material.normalTexture) {
      const textureInfo = material.normalTexture;
      normalScale = textureInfo.scale ?? 1.0;
      if (this.json.textures && this.json.textures[textureInfo.index]) {
        const texture = this.json.textures[textureInfo.index];
        normalTextureIndex = texture.source;
        console.log(`%c[PBR Debug] ✓ normalTexture found`, 'color: #4CAF50', { textureIndex: textureInfo.index, imageSource: normalTextureIndex, scale: normalScale });
      }
    } else {
      console.log(`%c[PBR Debug] ✗ No normalTexture`, 'color: #FF9800');
    }

    // Extract occlusionTexture (AO map, stored in R channel)
    let occlusionTextureIndex = null;
    let occlusionStrength = 1.0;
    if (material.occlusionTexture) {
      const textureInfo = material.occlusionTexture;
      occlusionStrength = textureInfo.strength ?? 1.0;
      if (this.json.textures && this.json.textures[textureInfo.index]) {
        const texture = this.json.textures[textureInfo.index];
        occlusionTextureIndex = texture.source;
        console.log(`%c[PBR Debug] ✓ occlusionTexture (AO) found`, 'color: #4CAF50', { textureIndex: textureInfo.index, imageSource: occlusionTextureIndex, strength: occlusionStrength });
      }
    } else {
      console.log(`%c[PBR Debug] ✗ No occlusionTexture (AO)`, 'color: #FF9800');
    }

    // Check for KHR_materials_unlit extension (common in Sketchfab exports)
    const isUnlit = material.extensions?.KHR_materials_unlit !== undefined;
    if (isUnlit) {
      console.log('%c[PBR Debug] ⚠ Material uses KHR_materials_unlit extension (unlit mode)', 'color: #E91E63; font-weight: bold');
    }

    // Check for emissive texture as fallback for baseColor
    if (textureIndex === null && material.emissiveTexture) {
      if (this.json.textures && this.json.textures[material.emissiveTexture.index]) {
        const texture = this.json.textures[material.emissiveTexture.index];
        textureIndex = texture.source;
        console.log(`%c[PBR Debug] Using emissiveTexture as baseColor fallback`, 'color: #9C27B0', { imageSource: textureIndex });
      }
    }

    // Summary table showing what values are used and their sources
    console.log('%c[PBR Debug] ─── Material Properties Summary ───', 'color: #4CAF50; font-weight: bold');
    console.table({
      'metallicFactor': {
        modelValue: metallicFromModel ?? '(not specified)',
        finalValue: metallicFactor,
        source: metallicFromModel !== undefined ? '📦 FROM MODEL' : '⚙️ DEFAULT'
      },
      'roughnessFactor': {
        modelValue: roughnessFromModel ?? '(not specified)',
        finalValue: roughnessFactor,
        source: roughnessFromModel !== undefined ? '📦 FROM MODEL' : '⚙️ DEFAULT'
      },
      'hasMetallicRoughnessTexture': {
        value: metallicRoughnessTextureIndex !== null,
        note: metallicRoughnessTextureIndex !== null ? 'Texture will MULTIPLY with factors' : 'Factor values used directly'
      }
    });

    // Warning for potentially problematic values
    if (roughnessFactor < 0.3) {
      console.log(`%c[PBR Debug] ⚠️ WARNING: Low roughness (${roughnessFactor}) may cause "oily" appearance!`, 'color: #FF5722; font-weight: bold; font-size: 14px');
    }
    if (metallicFactor > 0.5 && metallicRoughnessTextureIndex === null) {
      console.log(`%c[PBR Debug] ⚠️ WARNING: High metallic (${metallicFactor}) without texture - is this intended?`, 'color: #FF5722; font-weight: bold');
    }

    return {
      baseColorFactor,
      textureIndex,
      metallicFactor,
      roughnessFactor,
      metallicRoughnessTextureIndex,
      normalTextureIndex,
      normalScale,
      occlusionTextureIndex,
      occlusionStrength,
      isUnlit
    };
  }
}
