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
