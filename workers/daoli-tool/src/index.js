export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve the main HTML page for all routes
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await import('../public/index.html');
      return new Response(html.default, {
        headers: {
          'content-type': 'text/html;charset=UTF-8',
        },
      });
    }

    // Attempt to fetch static assets from the ASSETS binding
    // This handles /favicon.svg and any other static files in 'public'
    try {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status === 200) {
          return assetResponse;
      }
    } catch (e) {
      // Ignore error and fall through to SPA behavior
    }

    // For any other path, return the main page (SPA behavior)
    // This catches unknown routes and serves the app
    const html = await import('../public/index.html');
    return new Response(html.default, {
      headers: {
        'content-type': 'text/html;charset=UTF-8',
      },
    });
  },
};
