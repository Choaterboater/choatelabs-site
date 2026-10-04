// GET /lumina/api/top?mode=global|daily&date=YYYY-MM-DD&limit=50&offset=0[&playerId=…]
// Returns a slice of the requested leaderboard. Ranks in the response are
// absolute (offset + index + 1) so paging clients can render correct numbers.
// Rows show a hashed playerId; with &playerId=, that player's own row keeps
// the real one (see publicPlayerId).

import { Env, json, error, publicPlayerId, viewerIdParam } from './_shared';

const MAX_LIMIT = 500;

export async function handleTopGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'daily' ? 'daily' : 'global';
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const viewerId = viewerIdParam(url);

  if (mode === 'daily') {
    const date = url.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return error('invalid date');
    }
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
      entries: await Promise.all((rows.results ?? []).map(async (r, i) => ({
        rank: offset + i + 1,
        playerId: await publicPlayerId(r.player_id, viewerId),
        initials: r.initials,
        score: r.score,
        combo: r.combo,
        durationMs: r.duration_ms,
        perfects: r.perfects,
        createdAt: r.created_at,
      }))),
    });
  }

  // Global: per-player best score
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
    entries: await Promise.all((rows.results ?? []).map(async (r, i) => ({
      rank: offset + i + 1,
      playerId: await publicPlayerId(r.player_id, viewerId),
      initials: r.initials,
      score: r.score,
      combo: r.combo,
      durationMs: r.duration_ms,
      perfects: r.perfects,
      createdAt: r.created_at,
    }))),
  });
}
