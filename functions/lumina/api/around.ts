// GET /lumina/api/around?mode=global|daily&playerId=…&date=YYYY-MM-DD&window=2
// Returns the player's rank plus a window of neighbors above and below.
// Used by the leaderboard UI to show a "you are here" slice without paging
// through the entire board.
//
// Ranking SQL mirrors score.ts (the rank returned at submit-time): a player's
// rank is 1 + (count of players with a strictly higher score). For global,
// "score" means MAX(score) per player; for daily it's the single per-date row.
//
// If the player has never submitted, returns { rank: null, entries: [] }.

import { Env, json, error } from './_shared';

const MAX_WINDOW = 10;

export async function handleAroundGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'daily' ? 'daily' : 'global';
  const playerId = url.searchParams.get('playerId') ?? '';
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(playerId)) return error('invalid playerId');

  const window = Math.min(
    MAX_WINDOW,
    Math.max(1, Number(url.searchParams.get('window')) || 2)
  );

  if (mode === 'daily') {
    const date = url.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return error('invalid date');

    // Rank: 1 + count of daily entries with a higher score (mirrors score.ts:71-79).
    const rankRow = await env.LUMINA_DB.prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM scores_daily
       WHERE challenge_date = ?1 AND score > (
         SELECT score FROM scores_daily WHERE challenge_date = ?1 AND player_id = ?2
       )`
    )
      .bind(date, playerId)
      .first<{ rank: number }>();

    // Confirm the player has actually submitted today — the COUNT subquery
    // would return COUNT(*) + 1 even if the inner SELECT returned NULL,
    // which would falsely position the player at last+1.
    const hasEntry = await env.LUMINA_DB.prepare(
      `SELECT 1 AS x FROM scores_daily WHERE challenge_date = ?1 AND player_id = ?2`
    )
      .bind(date, playerId)
      .first<{ x: number }>();

    if (!hasEntry || !rankRow) {
      return json({ mode: 'daily', date, rank: null, entries: [] });
    }

    const rank = rankRow.rank;
    const offset = Math.max(0, rank - 1 - window);
    const limit = window * 2 + 1;

    const rows = await env.LUMINA_DB.prepare(
      `SELECT player_id, initials, score, combo, duration_ms, perfects, created_at
       FROM scores_daily
       WHERE challenge_date = ?1
       ORDER BY score DESC, created_at ASC
       LIMIT ?2 OFFSET ?3`
    )
      .bind(date, limit, offset)
      .all<{
        player_id: string;
        initials: string;
        score: number;
        combo: number;
        duration_ms: number;
        perfects: number;
        created_at: number;
      }>();

    return json({
      mode: 'daily',
      date,
      rank,
      entries: (rows.results ?? []).map((r, i) => ({
        rank: offset + i + 1,
        playerId: r.player_id,
        initials: r.initials,
        score: r.score,
        combo: r.combo,
        durationMs: r.duration_ms,
        perfects: r.perfects,
        createdAt: r.created_at,
      })),
    });
  }

  // Global: rank by per-player best score (mirrors score.ts:94-104).
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

  const hasEntry = await env.LUMINA_DB.prepare(
    `SELECT 1 AS x FROM scores WHERE player_id = ?1 LIMIT 1`
  )
    .bind(playerId)
    .first<{ x: number }>();

  if (!hasEntry || !rankRow) {
    return json({ mode: 'global', rank: null, entries: [] });
  }

  const rank = rankRow.rank;
  const offset = Math.max(0, rank - 1 - window);
  const limit = window * 2 + 1;

  const rows = await env.LUMINA_DB.prepare(
    `SELECT player_id, initials, MAX(score) AS score, combo, duration_ms, perfects, created_at
     FROM scores
     GROUP BY player_id
     ORDER BY score DESC, created_at ASC
     LIMIT ?1 OFFSET ?2`
  )
    .bind(limit, offset)
    .all<{
      player_id: string;
      initials: string;
      score: number;
      combo: number;
      duration_ms: number;
      perfects: number;
      created_at: number;
    }>();

  return json({
    mode: 'global',
    rank,
    entries: (rows.results ?? []).map((r, i) => ({
      rank: offset + i + 1,
      playerId: r.player_id,
      initials: r.initials,
      score: r.score,
      combo: r.combo,
      durationMs: r.duration_ms,
      perfects: r.perfects,
      createdAt: r.created_at,
    })),
  });
}
