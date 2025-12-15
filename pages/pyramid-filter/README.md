# Triangular Pyramid Image Filter (WebGL)

This page is a WebGL-based real-time image filter that maps an uploaded image onto a **table plane + a triangular pyramid (three-sided pyramid)**. Conceptually: pin 3 points on the table as the base triangle, then “lift” a point (the apex) by height `h` to form a pyramid you can view with a camera.

All logic lives in a single file: `public/index.html`.

## Features

- **Upload image → GPU render → export PNG** (grid overlays are auto-hidden on export).
- **Interactive geometry**
  - Drag the **apex** (lift position). Its projection is clamped to stay inside the base triangle.
  - Drag the **3 base vertices** (the “nails”).
  - **Pyramid spin**: rotates the base triangle around the vertical axis through the apex projection.
  - **Height `h`**: positive = convex pyramid, negative = concave (inverted) pyramid.
- **Camera controls**: yaw / pitch / roll + zoom.
- **Reference overlay**: optional grid + edges + vertex markers. Markers remain visible even when vertices go out of the image UV range.

## How It Works (Pipeline)

This renderer uses **inverse mapping** via per-pixel ray casting:

1) **CPU/UI stage**
   - User uploads an image → JS creates a WebGL texture.
   - UI controls + dragging update parameters:
     - Camera: `yaw`, `pitch`, `roll`, `zoom`
     - Pyramid: `h`, `apex (x,y)`, base vertices `B0/B1/B2 (x,y)`
   - JS sends these to the shader as uniforms on every render.

2) **GPU stage (full-screen quad)**
   - A single quad covers the canvas.
   - For every pixel (fragment), the fragment shader:
     1. Builds a **camera ray** through that pixel.
     2. Intersects the ray with the scene surfaces:
        - **Table plane** `z=0` (but masked under the lifted base triangle when `|h|>0`)
        - The **3 pyramid side faces**:
          - `A-B2-B0`, `A-B0-B1`, `A-B1-B2`
     3. Chooses the **closest hit** that maps to an in-bounds image UV.
     4. Computes image UV from the hit point and samples the texture.
     5. Applies simple face shading and optional reference overlay.

3) **Export**
   - The app temporarily disables the grid overlay and calls `canvas.toDataURL('image/png')`.

## Geometry & Math Notes

### World space → Image UV

The “table” uses a world coordinate system where `x/y` directly map to the source image with an aspect correction:

```
uv = 0.5 + 0.5 * vec2(x / canvasAspect, y)
```

Only `uv ∈ [0,1]²` is sampled; outside becomes transparent.

### Ray / Triangle intersection

Each pyramid face is a triangle. The shader uses the Möller–Trumbore algorithm to compute the ray parameter `t` for intersections:

- If `t < 0`: triangle is behind the camera → ignored
- Small `det` → ray is parallel → ignored
- Otherwise the closest valid `t` wins

### Why the “original image under the pyramid” does not show through

When `|h| > 0`, the table plane hit is **rejected** if the plane intersection point lies inside the base triangle. That prevents the plane from being drawn “under” the pyramid opening.

## Local Usage

- Serve `public/` with any static server and open the page:
  - `python3 -m http.server -d public 8787`
  - open `http://localhost:8787/`

Upload an image, adjust camera/`h`, drag vertices, then download the result.

## 🎨 Preset Parameters

| Preset | Box Angle | Perspective | Scale | Side Width | Effect |
|--------|-----------|-------------|-------|------------|--------|
| 🍜 SNACK BOX | 45° | 1.2 | 1.0 | 0.50 | Classic food packaging |
| 📦 PRODUCT | 35° | 0.8 | 0.9 | 0.40 | Subtle product box |
| 🤪 EXTREME | 60° | 2.0 | 1.2 | 0.60 | Maximum distortion |
| 😏 SUBTLE | 25° | 0.5 | 0.8 | 0.35 | Minimal effect |

## 📄 License

This project is open-source under the MIT License.
