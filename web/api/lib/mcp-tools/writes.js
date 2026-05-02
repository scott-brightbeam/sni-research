import { wrapTool } from './audit.js'
import {
  SubmitPostCandidateIn,
  ContributionOut,
  SubmitThemeEvidenceIn,
  ProposeNewThemeIn,
  SubmitArticleIn,
  AddDecisionIn,
  SubmitStoryReferenceIn,
  SubmitDraftSuggestionIn,
} from './schemas.js'
import { submitContribution } from './contribute.js'

/**
 * Pattern for write-tool handlers (Task 7 will add 6 more like this):
 *
 *   wrapTool(server, 'sni_<verb>', SchemaIn, ContributionOut,
 *     async (args, { user }) => {
 *       const { clientRequestId, ...payload } = args  // strip BEFORE pass
 *       return submitContribution('<type>', payload, user, clientRequestId)
 *     }
 *   )
 *
 * The strip-before-pass keeps clientRequestId out of sidecar.payload (it
 * lives at sidecar.clientRequestId at the top level). Without the strip,
 * pullContributions sees the same id in two places.
 */
export function registerWriteTools(server) {
  wrapTool(server, 'sni_submit_post_candidate', SubmitPostCandidateIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('post_candidate', payload, user, clientRequestId)
    }
  )

  wrapTool(server, 'sni_submit_theme_evidence', SubmitThemeEvidenceIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('theme_evidence', payload, user, clientRequestId)
    }
  )

  wrapTool(server, 'sni_propose_new_theme', ProposeNewThemeIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('new_theme', payload, user, clientRequestId)
    }
  )

  wrapTool(server, 'sni_submit_article', SubmitArticleIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('article', payload, user, clientRequestId)
    }
  )

  wrapTool(server, 'sni_add_decision', AddDecisionIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('decision', payload, user, clientRequestId)
    }
  )

  wrapTool(server, 'sni_submit_story_reference', SubmitStoryReferenceIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('story_reference', payload, user, clientRequestId)
    }
  )

  wrapTool(server, 'sni_submit_draft_suggestion', SubmitDraftSuggestionIn, ContributionOut,
    async (args, { user }) => {
      const { clientRequestId, ...payload } = args
      return submitContribution('draft_suggestion', payload, user, clientRequestId)
    }
  )
}
