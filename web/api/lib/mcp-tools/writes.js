import { wrapTool } from './audit.js'
import { SubmitPostCandidateIn, ContributionOut } from './schemas.js'
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
}
