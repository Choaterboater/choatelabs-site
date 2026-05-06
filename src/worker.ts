// Cloudflare Worker entry — routes /lumina/api/* to leaderboard handlers,
// falls through to static assets for everything else.

import { handleScorePost } from '../functions/lumina/api/score';
import { handleTopGet } from '../functions/lumina/api/top';

export interface Env {
  LUMINA_DB: D1Database;
  ASSETS: Fetcher; // static assets binding (auto-injected when assets.directory is set)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Leaderboard API routes
    if (url.pathname === '/lumina/api/score' && request.method === 'POST') {
      return handleScorePost(request, env);
    }
    if (url.pathname === '/lumina/api/top' && request.method === 'GET') {
      return handleTopGet(request, env);
    }
    if (url.pathname.startsWith('/lumina/api/')) {
      return new Response('not found', { status: 404 });
    }

    // Everything else → static assets (index.html, /lumina/*, etc.)
    return env.ASSETS.fetch(request);
  },
};
