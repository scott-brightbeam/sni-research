/**
 * fixtures.js — Seed functions for MCP tool tests.
 *
 * Each function is idempotent within a single freshly-migrated DB (the
 * caller is responsible for calling _resetDbSingleton() + migrateSchema()
 * between tests). All parameterised queries use the libSQL {sql, args}
 * object form per codebase conventions.
 *
 * seedDrafts() is filesystem-based and writes to <fsRoot>/output/.
 */

import fs from 'fs'
import path from 'path'

const SECTORS = [
  'general-ai',
  'biopharma',
  'medtech',
  'manufacturing',
  'insurance',
]

const POST_STATUSES = ['suggested', 'approved', 'published', 'archived']
const POST_PRIORITIES = ['low', 'medium', 'high']

/**
 * Insert n rows into articles.
 * slug: `art-${i}`, sectors cycle round-robin across the 5 valid values.
 * score: 0.7 + i*0.01.
 */
export async function seedArticles(db, n) {
  for (let i = 0; i < n; i++) {
    const sector = SECTORS[i % SECTORS.length]
    await db.execute({
      sql: `INSERT INTO articles
              (slug, title, url, source, source_type, date_published, sector, score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `art-${i}`,
        `Article ${i}`,
        `https://example.com/article/${i}`,
        'fixture',
        'rss',
        '2026-04-30',
        sector,
        0.7 + i * 0.01,
      ],
    })
  }
}

/**
 * Insert n themes with codes T01..T0N (zero-padded to 2 digits while n < 100).
 * If withEvidence is true, inserts 2 evidence rows per theme.
 */
export async function seedThemes(db, n, { withEvidence = false } = {}) {
  for (let i = 0; i < n; i++) {
    const code = `T${String(i + 1).padStart(2, '0')}`
    await db.execute({
      sql: `INSERT INTO themes (code, name, document_count, archived)
            VALUES (?, ?, ?, ?)`,
      args: [code, `Theme ${i + 1}`, i + 1, 0],
    })

    if (withEvidence) {
      for (let j = 0; j < 2; j++) {
        await db.execute({
          sql: `INSERT INTO theme_evidence (theme_code, session, source, content, url)
                VALUES (?, ?, ?, ?, ?)`,
          args: [
            code,
            i + 1,
            'fixture',
            `Evidence ${j + 1} for ${code}`,
            `https://example.com/evidence/${code}/${j}`,
          ],
        })
      }
    }
  }
}

/**
 * Insert n rows into episodes.
 * filename: `ep-${i}.md`, week: 17.
 */
export async function seedPodcasts(db, n) {
  for (let i = 0; i < n; i++) {
    await db.execute({
      sql: `INSERT INTO episodes
              (filename, date, source, source_slug, title, week, summary, episode_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `ep-${i}.md`,
        '2026-04-30',
        'Test Pod',
        'test-pod',
        `Episode ${i}`,
        17,
        `Summary for episode ${i}`,
        `https://podcast.example/${i}`,
      ],
    })
  }
}

/**
 * Insert n rows into posts.
 * status cycles ['suggested','approved','published','archived'].
 * priority cycles ['low','medium','high'].
 */
export async function seedPosts(db, n) {
  for (let i = 0; i < n; i++) {
    const status = POST_STATUSES[i % POST_STATUSES.length]
    const priority = POST_PRIORITIES[i % POST_PRIORITIES.length]
    await db.execute({
      sql: `INSERT INTO posts
              (id, title, status, core_argument, format, freshness, priority, source_urls, date_added)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        i + 1,
        `Post ${i + 1}`,
        status,
        `Argument for post ${i + 1}`,
        'standalone',
        'evergreen',
        priority,
        '[]',
        '2026-04-30',
      ],
    })
  }
}

/**
 * Insert n rows into decisions.
 * id: `dec-${i}`, session: i+1.
 */
export async function seedDecisions(db, n) {
  for (let i = 0; i < n; i++) {
    await db.execute({
      sql: `INSERT INTO decisions (id, session, title, decision, reasoning, archived)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        `dec-${i}`,
        i + 1,
        `Decision ${i}`,
        `Chose option ${i}`,
        `Reasoning ${i}`,
        0,
      ],
    })
  }
}

/**
 * Write n minimal markdown draft files to <fsRoot>/output/draft-week-{week}.md.
 * Week numbers start at 17 and increment. Creates the output directory if absent.
 */
export async function seedDrafts(fsRoot, n) {
  const outputDir = path.join(fsRoot, 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  for (let i = 0; i < n; i++) {
    const week = 17 + i
    const filePath = path.join(outputDir, `draft-week-${week}.md`)
    fs.writeFileSync(filePath, `# Draft week ${week}\n\nbody for week ${week}\n`)
  }
}
