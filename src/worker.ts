// Cloudflare Worker entry — routes /lumina/api/* to leaderboard handlers,
// /casper/* to Casper's GitHub Pages site, and falls through to static
// assets for everything else.

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

// Baseline hardening headers for served static assets. No auth/cookies/PII
// here, so this is defense-in-depth: block MIME sniffing, disallow cross-origin
// framing, and trim the referer sent to third parties.
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Casper's site is built and hosted by GitHub Pages from the Casper repo
// (its site/ folder). Pages serves it under /casper/ too, so paths pass
// through unchanged: one copy of the site, served at choatelabs.app/casper/.
const CASPER_ORIGIN = 'https://choaterboater.github.io';
const CASPER_PASS_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

async function proxyCasper(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const upstreamHeaders = new Headers();
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  let upstream: Response;
  try {
    upstream = await fetch(CASPER_ORIGIN + url.pathname + url.search, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: 'manual',
    });
  } catch {
    return new Response('Casper site unavailable', { status: 502 });
  }
  const headers = new Headers();
  for (const name of CASPER_PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Pages redirects folders (/casper → /casper/) to an absolute github.io
  // URL; keep the visitor on choatelabs.app.
  const location = upstream.headers.get('location');
  if (location) {
    const target = new URL(location, CASPER_ORIGIN);
    headers.set('location', target.origin === CASPER_ORIGIN ? target.pathname + target.search : location);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// JSON 500 that stays CORS-safe, so a thrown handler/D1 error reaches the
// Capacitor WebView as a diagnosable error instead of an opaque CORS failure.
function internalError(origin: string | null): Response {
  const body = JSON.stringify({ error: 'internal error' });
  return withCors(
    new Response(body, {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    origin
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    try {
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

      // Casper's site → GitHub Pages
      if (url.pathname === '/casper' || url.pathname.startsWith('/casper/')) {
        return withSecurityHeaders(await proxyCasper(request, url));
      }

      // Everything else → static assets (index.html, /lumina/*, etc.)
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch {
      return internalError(origin);
    }
  },
};
