# web-tools

A collection of single-page web tools deployed as Cloudflare Pages.

- Inspiration: from [simonw/tools](https://github.com/simonw/tools/)

## Tools

- **exif-remover**: Remove EXIF meta info from images
  - Idea from [image-scrubber](https://github.com/everestpipkin/image-scrubber)
  - Deployed at: `exif-remover.pages.dev`

- **flowdown-config**: FlowDown Enterprise Configuration Generator
  - Deployed at: `flowdown-config.pages.dev`

- **hdr-tool**: HDR processing tool
  - Deployed at: `hdr-tool.pages.dev`

- **daoli-tool**: Daoli tool
  - Deployed at: `daoli-tool.pages.dev`

- **emoji-splitter**: Emoji splitter tool
  - Deployed at: `emoji-splitter.pages.dev`

- **solar**: Solar tool
  - Deployed at: `solar.pages.dev`

## Prerequisites

1. Install [Node.js](https://nodejs.org/) (v16.17.0 or later)
2. Install [pnpm](https://pnpm.io/) or npm
3. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

## Development

### Install dependencies
```bash
pnpm install
```

### Run local development server
```bash
pnpm dev:exif      # EXIF remover
pnpm dev:flowdown  # FlowDown config generator
pnpm dev:hdr       # HDR tool
pnpm dev:daoli     # Daoli tool
pnpm dev:emoji     # Emoji splitter
pnpm dev:solar     # Solar tool
```

## Deployment

### Deploy individual tools
```bash
pnpm deploy:exif
pnpm deploy:flowdown
pnpm deploy:hdr
pnpm deploy:daoli
pnpm deploy:emoji
pnpm deploy:solar
```

### Deploy all tools
```bash
pnpm deploy:all
```

## Creating a New Tool

To add a new tool:

1. Create the directory:
   ```bash
   mkdir pages/<tool-name>
   ```

2. Add your HTML file as `pages/<tool-name>/index.html`

3. Create `pages/<tool-name>/wrangler.jsonc`:
   ```json
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "<tool-name>",
     "pages_build_output_dir": "."
   }
   ```

4. Add npm scripts to the root `package.json`

5. Update this README with the new tool information
