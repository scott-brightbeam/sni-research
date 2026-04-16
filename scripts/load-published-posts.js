#!/usr/bin/env bun
/**
 * load-published-posts.js — Load captured blog posts into the Turso
 * published_posts table. Idempotent: upserts by slug.
 *
 * Usage: bun scripts/load-published-posts.js
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getDb, migrateSchema } from '../web/api/lib/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const postsPath = join(ROOT, 'data/editorial/published-posts.json')
const posts = JSON.parse(readFileSync(postsPath, 'utf-8'))

console.log(`Loading ${posts.length} posts into published_posts table...`)

const db = getDb()
await migrateSchema(db)

let inserted = 0, updated = 0

for (const post of posts) {
  const wordCount = post.body ? post.body.split(/\s+/).length : 0

  // Extract opening line (first sentence)
  const openingMatch = post.body?.match(/^(.+?[.!?])\s/)
  const openingLine = openingMatch ? openingMatch[1] : (post.body?.split('\n')[0] || '').slice(0, 200)

  // Extract ITEATE (everything after "in-the-end-at-the-end" marker)
  // Variants: "So what's today's...", "here's today's...", "what is today's..."
  const iteateMatch = post.body?.match(/(?:So |And )?(?:what(?:'s|.s| is)|here(?:'s|.s)) today(?:'s|.s) in-the-end-at-the-end[.?!]?\s*([\s\S]+?)$/i)
  const iteate = iteateMatch ? iteateMatch[1].trim() : null

  // Check if exists
  const existing = await db.execute({
    sql: 'SELECT id FROM published_posts WHERE slug = ?',
    args: [post.slug],
  })

  if (existing.rows.length > 0) {
    await db.execute({
      sql: `UPDATE published_posts SET
              title = ?, date_published = ?, url = ?, category = ?,
              body = ?, word_count = ?, opening_line = ?, iteate = ?,
              updated_at = datetime('now')
            WHERE slug = ?`,
      args: [
        post.title, post.date || null, post.url || null, post.category || 'article',
        post.body, wordCount, openingLine, iteate,
        post.slug,
      ],
    })
    updated++
  } else {
    await db.execute({
      sql: `INSERT INTO published_posts
              (title, slug, date_published, url, category, body, word_count, opening_line, iteate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        post.title, post.slug, post.date || null, post.url || null,
        post.category || 'article', post.body, wordCount, openingLine, iteate,
      ],
    })
    inserted++
  }
}

console.log(`Done: ${inserted} inserted, ${updated} updated`)

// Verify
const count = await db.execute('SELECT COUNT(*) as n FROM published_posts')
console.log(`Total published_posts in DB: ${count.rows[0].n}`)

const withIteate = await db.execute("SELECT COUNT(*) as n FROM published_posts WHERE iteate IS NOT NULL")
console.log(`Posts with ITEATE extracted: ${withIteate.rows[0].n}`)
