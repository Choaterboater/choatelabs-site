// Shared helpers for the LUMINA leaderboard API
// Cloudflare Pages Functions context: env.LUMINA_DB is the D1 binding

export interface Env {
  LUMINA_DB: D1Database;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // Same-origin only — game and API live under the same host (choatelabs.app)
      // so no CORS needed; if cross-origin is added later, set this explicitly.
    },
  });

export const error = (msg: string, status = 400): Response => json({ error: msg }, status);

/** SHA-256 hash, used to anonymize IPs in submit_log (avoids storing raw IPs). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** UTC date string YYYY-MM-DD — used as the daily challenge key. */
export function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface ScoreSubmission {
  playerId: string;
  initials: string;
  score: number;
  combo: number;
  durationMs: number;
  perfects: number;
  mode?: 'global' | 'daily';
  challengeDate?: string;
}

/**
 * Validate + normalize a score submission. Returns the cleaned object or an Error message.
 * Anti-cheat is best-effort, not bulletproof — a determined client can fabricate values,
 * but these checks make casual cheating much harder.
 */
export function validateSubmission(body: unknown): ScoreSubmission | string {
  if (typeof body !== 'object' || body === null) return 'invalid body';
  const b = body as Record<string, unknown>;

  const playerId = typeof b.playerId === 'string' ? b.playerId.trim() : '';
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(playerId)) return 'invalid playerId';

  // Accept up to 16 chars: A-Z, 0-9, and single spaces between words.
  // Names <3 chars are right-padded with underscores so display columns stay aligned.
  let initials = typeof b.initials === 'string'
    ? b.initials.trim().toUpperCase().replace(/\s+/g, ' ')
    : '';
  if (!/^[A-Z0-9](?:[A-Z0-9 ]{0,14}[A-Z0-9])?$/.test(initials)) return 'invalid initials';
  if (initials.length < 3) initials = initials.padEnd(3, '_');

  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 0 || score > 10_000_000) return 'invalid score';

  const combo = Number(b.combo);
  if (!Number.isInteger(combo) || combo < 0 || combo > 100) return 'invalid combo';

  const durationMs = Number(b.durationMs);
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 60 * 60 * 1000) {
    return 'invalid durationMs';
  }

  const perfects = Number(b.perfects ?? 0);
  if (!Number.isInteger(perfects) || perfects < 0 || perfects > 10000) return 'invalid perfects';

  // Score-vs-time sanity: max realistic score per second
  // (combo 12 + scoreMult 1.2 + perfect 3x ≈ ~700 pts/coin worst case; cap at 1000/s lenient)
  if (durationMs > 0 && score / (durationMs / 1000) > 1000) {
    return 'score/time ratio exceeds reasonable limit';
  }

  const mode = b.mode === 'daily' ? 'daily' : 'global';
  const challengeDate = typeof b.challengeDate === 'string' ? b.challengeDate : undefined;
  if (mode === 'daily' && (!challengeDate || !/^\d{4}-\d{2}-\d{2}$/.test(challengeDate))) {
    return 'invalid challengeDate for daily mode';
  }

  return { playerId, initials, score, combo, durationMs, perfects, mode, challengeDate };
}
