// POST /lumina/api/score — submit a run's score (global or daily)
// Returns the player's rank in the relevant leaderboard.

import { Env, json, error, sha256Hex, validateSubmission } from './_shared';

const MIN_RUN_DURATION_MS = 3000;     // ignore impossibly short runs
const RATE_LIMIT_WINDOW_MS = 30_000;  // 30s window
const RATE_LIMIT_MAX = 6;             // max 6 submissions per player or per IP per window

export async function handleScorePost(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('invalid json');
  }

  const validated = validateSubmission(body);
  if (typeof validated === 'string') return error(validated);
  const { playerId, initials, score, combo, durationMs, perfects, mode, challengeDate } = validated;

  if (durationMs < MIN_RUN_DURATION_MS) {
    return error('run too short to submit');
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipHash = await sha256Hex(ip);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - Math.floor(RATE_LIMIT_WINDOW_MS / 1000);

  // Rate-limit by player AND by IP (whichever is tighter)
  const limitCheck = await env.LUMINA_DB.prepare(
    `SELECT
       SUM(CASE WHEN player_id = ?1 THEN 1 ELSE 0 END) AS by_player,
       SUM(CASE WHEN ip_hash = ?2 THEN 1 ELSE 0 END) AS by_ip
     FROM submit_log WHERE created_at >= ?3`
  )
    .bind(playerId, ipHash, windowStart)
    .first<{ by_player: number; by_ip: number }>();

  if ((limitCheck?.by_player ?? 0) >= RATE_LIMIT_MAX || (limitCheck?.by_ip ?? 0) >= RATE_LIMIT_MAX) {
    return error('rate limited — slow down', 429);
  }

  // Log this attempt
  await env.LUMINA_DB.prepare(
    `INSERT INTO submit_log (player_id, ip_hash, created_at) VALUES (?1, ?2, ?3)`
  )
    .bind(playerId, ipHash, now)
    .run();

  if (mode === 'daily' && challengeDate) {
    // Upsert: keep best score per (date, player)
    await env.LUMINA_DB.prepare(
      `INSERT INTO scores_daily
        (challenge_date, player_id, initials, score, combo, duration_ms, perfects, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (challenge_date, player_id) DO UPDATE SET
         score = MAX(score, excluded.score),
         initials = excluded.initials,
         combo = CASE WHEN excluded.score > score THEN excluded.combo ELSE combo END,
         duration_ms = CASE WHEN excluded.score > score THEN excluded.duration_ms ELSE duration_ms END,
         perfects = CASE WHEN excluded.score > score THEN excluded.perfects ELSE perfects END,
         created_at = CASE WHEN excluded.score > score THEN excluded.created_at ELSE created_at END`
    )
      .bind(challengeDate, playerId, initials, score, combo, durationMs, perfects, now)
      .run();

    const rankRow = await env.LUMINA_DB.prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM scores_daily
       WHERE challenge_date = ?1 AND score > (
         SELECT score FROM scores_daily WHERE challenge_date = ?1 AND player_id = ?2
       )`
    )
      .bind(challengeDate, playerId)
      .first<{ rank: number }>();

    return json({ ok: true, rank: rankRow?.rank ?? null, mode: 'daily', challengeDate });
  }

  // Global: insert every run; client filters by personal best
  await env.LUMINA_DB.prepare(
    `INSERT INTO scores
      (player_id, initials, score, combo, duration_ms, perfects, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(playerId, initials, score, combo, durationMs, perfects, now)
    .run();

  // Player's rank = 1 + (count of distinct players with a higher best score)
  const rankRow = await env.LUMINA_DB.prepare(
    `SELECT COUNT(*) + 1 AS rank
     FROM (
       SELECT player_id, MAX(score) AS best
       FROM scores
       GROUP BY player_id
       HAVING best > (SELECT MAX(score) FROM scores WHERE player_id = ?1)
     )`
  )
    .bind(playerId)
    .first<{ rank: number }>();

  return json({ ok: true, rank: rankRow?.rank ?? null, mode: 'global' });
}
