/**
 * podcast-url.js — shared helper for detecting podcast-platform URLs.
 *
 * Used by the cleanup script and any future code that needs to filter out
 * contaminated "story URLs" that are actually podcast-episode URLs.
 *
 * Rule: podcasts are never the right answer when we're looking for the
 * original article source. If a story's url points at a podcast platform
 * or show site, the story is unresolved — DISCOVER must find the real URL.
 *
 * Newsletters (exponentialview.co, bigtechnology.com) are explicitly
 * allowed because their URLs really are article/post URLs.
 */

// Podcast-platform hosts. Wildcards are implicit: `simplecast.com` matches
// `a16z.simplecast.com`, `www.simplecast.com`, `foo.simplecast.com`, etc.
export const PODCAST_PLATFORM_HOSTS = [
  // Generic podcast platforms
  'podcasters.spotify.com', 'open.spotify.com',
  'simplecast.com', 'blubrry.net', 'libsyn.com', 'buzzsprout.com',
  'podbean.com', 'acast.com', 'art19.com', 'transistor.fm',
  'anchor.fm', 'megaphone.fm', 'omnystudio.com',
  'podcasts.apple.com', 'overcast.fm', 'pocketcasts.com',
  'castbox.fm', 'castos.com',

  // Individual podcast/show sites (URLs on these are always episode pages)
  'lexfridman.com', 'jimruttshow.com', 'dwarkesh.com',
  'intelligencesquared.com', 'cognitiverevolution.ai',
  'complexsystemspodcast.com',
]

// Newsletter hosts — URLs here are valid story URLs and must NOT be
// treated as contaminated, even though some of these brands also run
// podcasts.
export const NEWSLETTER_HOSTS = [
  'exponentialview.co',
  'bigtechnology.com',
]

/**
 * Strip leading `www.` for host matching.
 */
function normaliseHost(host) {
  return host.toLowerCase().replace(/^www\./, '')
}

/**
 * Does `host` match any entry in `list` (exact or suffix)?
 * Suffix match is `host === entry || host.endsWith('.' + entry)`.
 */
function hostMatches(host, list) {
  const h = normaliseHost(host)
  return list.some(e => h === e || h.endsWith('.' + e))
}

/**
 * Is `url` a known-contaminated "podcast URL" that should never be
 * treated as a valid story URL?
 *
 * Returns true for:
 *   • Podcast-platform hosts (spotify, simplecast, blubrry, etc.)
 *   • Podcast show sites (lexfridman.com, dwarkesh.com, etc.)
 *   • YouTube search fallback URLs (`youtube.com/@handle/search?query=...`)
 *
 * Returns false for:
 *   • Null / undefined / empty / non-http URLs
 *   • Newsletter hosts (exponentialview.co, bigtechnology.com)
 *   • Any other real article URL
 */
export function isPodcastPlatformUrl(url) {
  if (!url || typeof url !== 'string') return false
  if (!/^https?:\/\//i.test(url)) return false
  let parsed
  try { parsed = new URL(url) } catch { return false }

  const host = normaliseHost(parsed.host)

  // Newsletter allowlist always wins
  if (hostMatches(host, NEWSLETTER_HOSTS)) return false

  // YouTube search/handle-search fallback URLs — always contaminated
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (/\/search(\?|$)|\/@[^/]+\/search/.test(parsed.pathname + parsed.search)) {
      return true
    }
    // Other YouTube URLs (watch?v=..., channel pages, etc.) are not
    // automatically contaminated — a news video IS a valid story URL.
    return false
  }

  return hostMatches(host, PODCAST_PLATFORM_HOSTS)
}

/**
 * Decide whether a story URL should be nulled out.
 * Returns true if:
 *   • URL is a podcast-platform URL (isPodcastPlatformUrl), OR
 *   • URL is exactly equal to the episode's own URL (episodeUrl match)
 */
export function shouldNullifyStoryUrl(storyUrl, episodeUrl) {
  if (!storyUrl) return false
  if (episodeUrl && storyUrl === episodeUrl) return true
  return isPodcastPlatformUrl(storyUrl)
}
