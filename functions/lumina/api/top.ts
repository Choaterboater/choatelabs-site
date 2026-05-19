// GET /lumina/api/top?mode=global|daily&date=YYYY-MM-DD&limit=50&offset=0
// Returns a slice of the requested leaderboard. Ranks in the response are
// absolute (offset + index + 1) so paging clients can render correct numbers.

import { Env, json, error } from './_shared';

const MAX_LIMIT = 500;

export async function handleTopGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'daily' ? 'daily' : 'global';
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

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
