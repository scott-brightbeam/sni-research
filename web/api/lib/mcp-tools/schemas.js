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
