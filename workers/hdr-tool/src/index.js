// Embed the favicon SVG directly as a string to avoid build loader issues
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00d4aa;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ff6b9d;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="36" height="36" rx="6" fill="url(#grad)" />
  <text x="50%" y="50%" dy="2" dominant-baseline="middle" text-anchor="middle" fill="#f5f5f7" font-family="sans-serif" font-weight="bold" font-size="22">L</text>
</svg>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/favicon.svg') {
      return new Response(FAVICON_SVG, {
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': 'public, max-age=86400',
        },
      });
    }

    // Serve the main HTML page for all routes
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await import('../public/index.html');
      return new Response(html.default, {
        headers: {
          'content-type': 'text/html;charset=UTF-8',
        },
      });
    }

    // For any other path, return the main page (SPA behavior)
    const html = await import('../public/index.html');
    return new Response(html.default, {
      headers: {
        'content-type': 'text/html;charset=UTF-8',
      },
    });
  },
};
