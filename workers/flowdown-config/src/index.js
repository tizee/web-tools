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

    // For any other path, return the main page (SPA behavior)
    const html = await import('../public/index.html');
    return new Response(html.default, {
      headers: {
        'content-type': 'text/html;charset=UTF-8',
      },
    });
  },
};
