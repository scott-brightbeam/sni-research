/**
 * podcast-queries.js — SQL query functions for episodes + episode_stories tables.
 *
 * All functions take a libSQL `db` client as first argument.
 * Uses parameterised queries exclusively (no string interpolation).
 */

// ---------------------------------------------------------------------------
// getEpisodes
// ---------------------------------------------------------------------------

/**
 * List episodes with optional filters, sorted by date DESC.
 * Includes story_count and full stories array per episode.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {number} [opts.week] - filter by week number
 * @param {string} [opts.source] - filter by source_slug
 * @returns {Promise<object[]>}
 */
export async function getEpisodes(db, { week, source } = {}) {
  const conditions = []
  const args = []

  if (week != null) {
    conditions.push('e.week = ?')
    args.push(week)
  }
  if (source) {
    conditions.push('e.source_slug = ?')
    args.push(source)
  }

  const where = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : ''

  const result = await db.execute({
    sql: `SELECT e.*,
            (SELECT COUNT(*) FROM episode_stories es WHERE es.episode_id = e.id) AS story_count
          FROM episodes e
          ${where}
          ORDER BY e.date DESC`,
    args,
  })

  // Attach stories array to each episode
  const episodes = []
  for (const row of result.rows) {
    const storiesResult = await db.execute({
      sql: `SELECT headline, detail, url, sector
            FROM episode_stories
            WHERE episode_id = ?`,
      args: [row.id],
    })
    episodes.push({
      ...row,
      story_count: Number(row.story_count),
      stories: storiesResult.rows,
    })
  }

  return episodes
}

// ---------------------------------------------------------------------------
// getEpisode
// ---------------------------------------------------------------------------

/**
 * Get a single episode by filename (unique). Includes full stories array.
 * @param {import('@libsql/client').Client} db
 * @param {string} filename
 * @returns {Promise<object|null>}
 */
export async function getEpisode(db, filename) {
  const result = await db.execute({
    sql: 'SELECT * FROM episodes WHERE filename = ?',
    args: [filename],
  })

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  const storiesResult = await db.execute({
    sql: `SELECT headline, detail, url, sector
          FROM episode_stories
          WHERE episode_id = ?`,
    args: [row.id],
  })

  return { ...row, stories: storiesResult.rows }
}

// ---------------------------------------------------------------------------
// upsertEpisode
// ---------------------------------------------------------------------------

/**
 * Insert a new episode or update an existing one (matched by filename).
 * On conflict, updates duration, episode_url, tier, summary, archived, week, year.
 * @param {import('@libsql/client').Client} db
 * @param {object} episode
 * @returns {Promise<number>} episode id
 */
export async function upsertEpisode(db, episode) {
  // Check if episode already exists
  const existing = await db.execute({
    sql: 'SELECT id FROM episodes WHERE filename = ?',
    args: [episode.filename],
  })

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id
    await db.execute({
      sql: `UPDATE episodes SET
              duration = ?,
              episode_url = ?,
              tier = ?,
              summary = ?,
              archived = ?,
              week = ?,
              year = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
      args: [
        episode.duration ?? null,
        episode.episode_url ?? null,
        episode.tier ?? 1,
        episode.summary ?? null,
        episode.archived ?? 0,
        episode.week ?? null,
        episode.year ?? null,
        id,
      ],
    })
    return Number(id)
  }

  const result = await db.execute({
    sql: `INSERT INTO episodes (
            filename, date, source, source_slug, title,
            week, year, duration, episode_url, tier,
            summary, archived
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      episode.filename,
      episode.date,
      episode.source,
      episode.source_slug,
      episode.title,
      episode.week ?? null,
      episode.year ?? null,
      episode.duration ?? null,
      episode.episode_url ?? null,
      episode.tier ?? 1,
      episode.summary ?? null,
      episode.archived ?? 0,
    ],
  })
  return Number(result.lastInsertRowid)
}

// ---------------------------------------------------------------------------
// upsertEpisodeStories
// ---------------------------------------------------------------------------

/**
 * Replace all stories for an episode. Deletes existing, inserts new.
 * @param {import('@libsql/client').Client} db
 * @param {number} episodeId
 * @param {object[]} stories - array of { headline, detail, url, sector }
 */
export async function upsertEpisodeStories(db, episodeId, stories) {
  await db.execute({
    sql: 'DELETE FROM episode_stories WHERE episode_id = ?',
    args: [episodeId],
  })

  for (const story of stories) {
    await db.execute({
      sql: `INSERT INTO episode_stories (episode_id, headline, detail, url, sector)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        episodeId,
        story.headline,
        story.detail ?? null,
        story.url ?? null,
        story.sector ?? 'general-ai',
      ],
    })
  }
}

// ---------------------------------------------------------------------------
// patchEpisode
// ---------------------------------------------------------------------------

/**
 * Find an episode by date + source_slug + partial filename match, then apply updates.
 * @param {import('@libsql/client').Client} db
 * @param {string} date
 * @param {string} sourceSlug - source_slug value
 * @param {string} slug - partial match against filename (LIKE %slug%)
 * @param {object} updates - field:value pairs to SET (e.g. { archived: 1 })
 */
export async function patchEpisode(db, date, sourceSlug, slug, updates) {
  const keys = Object.keys(updates)
  if (keys.length === 0) return

  const setClauses = keys.map(k => `${k} = ?`)
  setClauses.push("updated_at = datetime('now')")

  const args = [
    ...keys.map(k => updates[k]),
    date,
    sourceSlug,
    `%${slug}%`,
  ]

  await db.execute({
    sql: `UPDATE episodes SET ${setClauses.join(', ')}
          WHERE date = ? AND source_slug = ? AND filename LIKE ?`,
    args,
  })
}
