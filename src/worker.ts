// Cloudflare Worker entry — routes /lumina/api/* to leaderboard handlers,
// falls through to static assets for everything else.

import { handleScorePost } from '../functions/lumina/api/score';
import { handleTopGet } from '../functions/lumina/api/top';
import { handleAroundGet } from '../functions/lumina/api/around';

export interface Env {
  LUMINA_DB: D1Database;
  ASSETS: Fetcher; // static assets binding (auto-injected when assets.directory is set)
}

// Origins allowed to call /lumina/api/*. The web app is same-origin (no
// CORS needed), but the iOS Capacitor WebView uses capacitor://localhost —
// without CORS its non-simple POST preflight fails and every score submit
// is silently dropped.
const ALLOWED_ORIGINS = new Set([
  'https://choatelabs.app',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://choatelabs.app';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    // CORS preflight for any /lumina/api/* call.
    if (url.pathname.startsWith('/lumina/api/') && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Leaderboard API routes
    if (url.pathname === '/lumina/api/score' && request.method === 'POST') {
      return withCors(await handleScorePost(request, env), origin);
    }
    if (url.pathname === '/lumina/api/top' && request.method === 'GET') {
      return withCors(await handleTopGet(request, env), origin);
    }
    if (url.pathname === '/lumina/api/around' && request.method === 'GET') {
      return withCors(await handleAroundGet(request, env), origin);
    }
    if (url.pathname.startsWith('/lumina/api/')) {
      return withCors(new Response('not found', { status: 404 }), origin);
    }

    // Everything else → static assets (index.html, /lumina/*, etc.)
    return env.ASSETS.fetch(request);
  },
};
