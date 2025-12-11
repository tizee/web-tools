# OTTO Projection Tool (Web Version)

This is a WebGL-based real-time image processing tool designed to generate "说的道理" (Daoli) and "栗子头" (Lizitou) style projections.

This project is a web port of [Stereographic Projection of Otto](https://github.com/Golevka2001/Stereographic-Projection-of-Otto), featuring a "Cyber-Optic" darkroom aesthetic, mobile-first design, and GPU-accelerated rendering for instant previews.

## 🔄 Algorithm Compatibility

This WebGL implementation produces **identical output** to the original Python script when using the same input image and preset parameters. The core stereographic projection algorithm, rotation matrices, and spherical mapping formulas have been faithfully ported from the Python implementation:

| Preset | Python Parameters | WebGL Parameters |
|--------|-------------------|------------------|
| 😂 PRINCIPLE | `scale=1.5, beta=-5°, offset_y=0.4` | `scale=1.5, beta=-5°, offset_y=0.4` |
| 🌰 CHESTNUT | `scale=1.0, beta=155°, offset_y=-0.4` | `scale=1.0, beta=155°, offset_y=-0.4` |

The mathematical transformations (sphere projection, Euler rotation, spherical coordinate mapping) are equivalent between implementations, ensuring visual parity for reproducible results.

## ✨ Features

*   **Real-time WebGL Rendering**: Utilizes GPU parallel processing for millisecond-level response to image transformations.
*   **Interactive Controls**:
    *   **Scale**: Adjusts the radius of the projection sphere.
    *   **3D Rotation**: Free rotation along X/Y/Z axes (Alpha/Beta/Gamma).
    *   **Offset**: Horizontal and vertical displacement on the projection plane.
*   **One-Click Presets**:
    *   😂 **PRINCIPLE**: The classic frontal projection.
    *   🌰 **CHESTNUT**: A chestnut-like shape obtained by rotating the sphere to a specific angle.
*   **Assistive Tools**:
    *   **Grid Assist**: Toggleable neon green grid for alignment and distortion reference.
    *   **HD Download**: Automatically hides the grid and generates files with unique hashes and resolution tags (Format: `otto-{hash}-{size}.png`).
*   **Responsive Design**: Layout optimized for mobile devices with touch-friendly sliders and controls.

## 🛠 How It Works (Algorithm Pipeline)

The core logic resides in the WebGL Fragment Shader (`fsSource`) within `index.html`. The rendering pipeline uses an **Inverse Mapping** approach, meaning it traces back from screen pixels to sampling points on the original image.

The processing flow is as follows:

### 1. Screen Space -> Projection Plane
The program first normalizes the current canvas pixel coordinates and applies the user-defined **Offset**.
*   Input: Screen pixel coordinates $(x, y)$
*   Parameter: `uOffset` (Horizontal/Vertical displacement)

### 2. Inverse Stereographic Projection
Maps points from the 2D plane back onto the surface of a 3D sphere. The algorithm assumes the projection point is at the pole of the sphere. It connects a point $Q$ on the plane $z=0$ to the projection point to find the intersection $P$ on the sphere.

Shader logic (`projectToSphere` function):
```glsl
float k = 2.0 * r * r / (x * x + y * y + r * r);
vec3 P = vec3(k * x, k * y, (k - 1.0) * r);
```
This step handles both the projection mapping and the **Scale** logic (by altering the sphere radius $r$).

### 3. 3D Rotation
Rotates the point $P$ in spherical space. The tool constructs a $3 \times 3$ rotation matrix applying Euler angle transformations.

Shader logic (`computeRotationMatrix` function):
*   Input: Spherical coordinate $P$, Rotation angles `uRotation` ($\alpha, \beta, \gamma$)
*   Output: Rotated spherical coordinate $P'$
*   Operation: $P' = Mat_{rot} \times P$

### 4. Spherical Mapping
Unwraps the rotated 3D spherical coordinate $P'(x', y', z')$ into 2D texture coordinates $(u, v)$ to sample from the original image.

Shader logic (`getPixOnImg` function):
*   $v$ (Vertical): Calculated based on the arccosine of the $z'$ axis $\arccos(z'/r)$, mapped to $[0, 1]$.
*   $u$ (Horizontal): Calculated based on the arctangent of $x', y'$ $\arctan(y', x')$, mapped to $[0, 1]$.

### 5. Texture Sampling
Finally, WebGL uses the calculated $(u, v)$ coordinates to sample the color from the uploaded image (`uSampler`) and outputs it to the screen. If coordinates are out of bounds, transparent pixels are rendered.

## 📄 License

This project is open-source under the MIT License, based on the algorithmic concepts from [Stereographic-Projection-of-Otto](https://github.com/Golevka2001/Stereographic-Projection-of-Otto).
