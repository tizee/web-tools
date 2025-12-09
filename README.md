# web-tools

A collection of single-page web tools designed to be deployed as Cloudflare Workers.

- Inspiration: from [simonw/tools](https://github.com/simonw/tools/)

## Tools

### Do-one-thing

- **exif-remover**: Remove EXIF meta info from images
  - Idea from [image-scrubber](https://github.com/everestpipkin/image-scrubber)
  - Location: `workers/exif-remover/`
  - Deployed at: `exif-remover.<your-subdomain>.workers.dev`

- **flowdown-config**: FlowDown Enterprise Configuration Generator
  - Location: `workers/flowdown-config/`
  - Deployed at: `flowdown-config.<your-subdomain>.workers.dev`

- **hdr-tool**: HDR processing tool
  - Location: `workers/hdr-tool/`
  - Deployed at: `hdr-tool.<your-subdomain>.workers.dev`

## Project Structure

```
web-tools/
├── package.json              # Root package.json with shared dev dependencies
├── wrangler.jsonc           # Workspace configuration for all workers
├── workers/
│   ├── exif-remover/        # EXIF removal tool
│   │   ├── src/index.js     # Worker script
│   │   ├── public/index.html # Tool HTML interface
│   │   └── wrangler.jsonc   # Worker configuration
│   ├── flowdown-config/     # FlowDown config generator
│   │   ├── src/index.js
│   │   ├── public/index.html
│   │   └── wrangler.jsonc
│   └── hdr-tool/            # HDR processing tool
│       ├── src/index.js
│       ├── public/index.html
│       └── wrangler.jsonc
└── README.md
```

## Prerequisites

1. Install [Node.js](https://nodejs.org/) (v16.17.0 or later)
2. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) v4.0.0 or later:
   ```bash
   npm install -g wrangler@^4.0.0
   ```
3. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

## Development

### Install dependencies
```bash
npm install
```

### Run local development server
```bash
# For specific tools
npm run dev:exif      # EXIF remover
npm run dev:flowdown  # FlowDown config generator
npm run dev:hdr       # HDR tool

# Or manually for any tool
npx wrangler dev --config workers/<tool-name>/wrangler.jsonc
```

## Deployment

### Deploy individual tools
```bash
# Deploy EXIF remover
npm run deploy:exif

# Deploy FlowDown config generator
npm run deploy:flowdown

# Deploy HDR tool
npm run deploy:hdr
```

### Deploy all tools
```bash
npm run deploy:all
```

## Creating a New Tool

To add a new tool:

1. Create the directory structure:
   ```bash
   mkdir -p workers/<tool-name>/{src,public}
   ```

2. Add your HTML file to `workers/<tool-name>/public/index.html`

3. Create a worker script at `workers/<tool-name>/src/index.js`:
   ```javascript
   export default {
     async fetch(request, env, ctx) {
       const html = await import('../public/index.html');
       return new Response(html.default, {
         headers: { 'content-type': 'text/html;charset=UTF-8' },
       });
     },
   };
   ```

4. Create a `workers/<tool-name>/wrangler.jsonc` configuration file

5. Add npm scripts to the root `package.json`

6. Update this README with the new tool information

