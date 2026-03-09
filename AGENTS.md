# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

This is a monorepo of single-page web tools deployed as Cloudflare Pages. Each tool is independent and lives in its own directory under `pages/`.

## Development Commands

All commands use `wrangler` (Cloudflare Pages) for local development:

```bash
# Install dependencies
pnpm install

# Run local dev server for a specific tool
pnpm dev:exif      # EXIF remover
pnpm dev:flowdown  # FlowDown config generator
pnpm dev:hdr       # HDR tool
pnpm dev:daoli     # Daoli tool
pnpm dev:emoji     # Emoji splitter
pnpm dev:solar     # Solar tool
pnpm dev:pyramid   # Pyramid filter
pnpm dev:wireframe # Wireframe viewer
pnpm dev:gemini    # Gemini watermark remover
```

## Deployment

```bash
# Deploy individual tool
pnpm deploy:exif
pnpm deploy:flowdown
pnpm deploy:hdr
pnpm deploy:daoli
pnpm deploy:emoji
pnpm deploy:solar
pnpm deploy:pyramid
pnpm deploy:wireframe
pnpm deploy:gemini

# Deploy all tools
pnpm deploy:all
```

## Project Structure

```
web-tools/
├── wrangler.jsonc          # Root config with workspaces (pages/*)
├── package.json            # npm scripts for each tool
├── pages/
│   ├── exif-remover/       # Each tool in its own directory
│   │   ├── wrangler.jsonc # Tool-specific config
│   │   └── public/         # Static files (index.html, assets)
│   ├── flowdown-config/
│   ├── hdr-tool/
│   ├── daoli-tool/
│   ├── emoji-splitter/
│   ├── solar/
│   ├── pyramid-filter/
│   ├── wireframe-viewer/
│   └── gemini-watermark/
```

## Adding a New Tool

1. Create directory: `mkdir pages/<tool-name>`
2. Add `index.html` to `pages/<tool-name>/public/`
3. Create `pages/<tool-name>/wrangler.jsonc`:
   ```json
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "tizee-<tool-name>",
     "pages_build_output_dir": "public"
   }
   ```
4. Add scripts to root `package.json`:
   ```json
   "dev:<tool>": "cd pages/<tool-name> && wrangler pages dev public",
   "deploy:<tool>": "cd pages/<tool-name> && wrangler pages deploy public"
   ```

## Architecture Notes

- Each tool is a standalone static site (HTML + JS/CSS)
- No build step required for most tools—they serve static files directly from `public/`
- Some tools (wireframe-viewer) may omit the `public` suffix in wrangler commands
- Deployment target: Cloudflare Pages with format `tizee-<tool-name>.pages.dev`
