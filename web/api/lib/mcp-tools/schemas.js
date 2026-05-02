import { z } from 'zod'

export const SECTORS = ['general-ai', 'biopharma', 'medtech', 'manufacturing', 'insurance']
export const sector = z.enum(SECTORS)

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

// Shared atom — write tools (Tasks 5–7) accept an optional clientRequestId
// for idempotent retries. Decision #9 in the master plan; enforced at the
// schema level by the UNIQUE partial index on (client_request_id, user_email).
export const clientRequestId = z.string().max(64).optional()

export const SearchArticlesIn = z.object({
  query: z.string().max(500).optional(),
  sector: sector.optional(),
  dateFrom: dateString.optional(),
  dateTo: dateString.optional(),
  limit: z.number().int().min(1).max(200).optional().default(20),
}).describe('Search the SNI article corpus by keyword, sector, or date range.')

export const SubmitPostCandidateIn = z.object({
  title: z.string().max(120),
  coreArgument: z.string().max(2000),
  format: z.enum(['standalone', 'series', 'thread']).optional(),
  freshness: z.enum(['evergreen', 'time-sensitive', 'urgent']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  sourceUrls: z.array(z.string().url().max(2000)).max(10).optional(),
  notes: z.string().max(2000).optional(),
  clientRequestId,
}).describe('Submit a new post candidate for the editorial backlog.')

export const ContributionOut = z.object({
  contributionId: z.string().uuid(),
  queuedFor: z.string(),
  idempotent: z.boolean().optional(),
})

export const SearchPodcastsIn = z.object({
  query: z.string().max(500).optional(),
  source: z.string().max(100).optional(),
  dateFrom: dateString.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
}).describe('Search the SNI podcast episode corpus by source or date.')

export const GetThemesIn = z.object({
  archived: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
}).describe('List active editorial themes.')

export const GetThemeDetailIn = z.object({
  code: z.string().regex(/^T\d{1,4}$/, 'Theme code like T05 or T123').max(8),
}).describe('Get full detail for one theme — evidence, connections, linked entries.')

export const GetPostBacklogIn = z.object({
  status: z.enum(['suggested', 'approved', 'published', 'archived']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
}).describe('List items in the editorial post backlog.')

export const GetWritingPreferencesIn = z.object({}).describe(
  'Get the canonical writing preferences, vocabulary fingerprint, and permanent preferences.'
)

export const GetDraftsIn = z.object({
  week: z.number().int().optional(),
  limit: z.number().int().min(1).max(20).optional().default(5),
}).describe('List newsletter drafts (metadata + summary; full body via dashboard).')

export const GetDecisionsIn = z.object({
  archived: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
}).describe('List editorial decisions.')

// ── Write-tool schemas (Task 7) ────────────────────────────────────────────

const themeCodeRegex = /^T\d{1,4}$/

export const SubmitThemeEvidenceIn = z.object({
  themeCode: z.string().regex(themeCodeRegex, 'Theme code like T05 or T123').max(8),
  content: z.string().max(2000),
  source: z.string().max(500).optional(),
  url: z.string().url().max(2000).optional(),
  clientRequestId,
}).describe('Submit a piece of evidence for an existing theme.')

export const ProposeNewThemeIn = z.object({
  name: z.string().max(80),
  rationale: z.string().max(2000),
  initialEvidence: z.array(z.object({
    content: z.string().max(2000),
    source: z.string().max(500).optional(),
    url: z.string().url().max(2000).optional(),
  })).max(5).optional(),
  clientRequestId,
}).describe('Propose a new editorial theme with optional initial evidence.')

export const SubmitArticleIn = z.object({
  url: z.string().url().max(2000),
  title: z.string().max(200),
  sector,
  source: z.string().max(200).optional(),
  snippet: z.string().max(2000).optional(),
  scoreReason: z.string().max(500).optional(),
  clientRequestId,
}).describe('Submit a manually-curated article for the corpus.')

export const AddDecisionIn = z.object({
  title: z.string().max(200),
  decision: z.string().max(2000),
  reasoning: z.string().max(4000).optional(),
  clientRequestId,
}).describe('Record an editorial decision with optional reasoning.')

export const SubmitStoryReferenceIn = z.object({
  url: z.string().url().max(2000),
  headline: z.string().max(300),
  sector: sector.optional(),
  context: z.string().max(1000).optional(),
  clientRequestId,
}).describe('Submit a story reference for the next DISCOVER pass.')

export const SubmitDraftSuggestionIn = z.object({
  week: z.number().int(),
  target: z.enum(['tldr', 'sector_bullet', 'analysis', 'podcast_commentary']),
  suggestion: z.string().max(4000),
  rationale: z.string().max(2000).optional(),
  clientRequestId,
}).describe('Suggest a revision to a section of the current week\'s draft.')
