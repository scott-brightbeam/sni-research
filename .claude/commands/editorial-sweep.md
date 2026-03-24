Wednesday evening quality sweep — verify all editorial state is complete before Thursday newsletter.

## Instructions

1. Read `data/editorial/state.json` and `data/editorial/url-queue.json`

2. **URL completeness audit:**
   - Check every active (non-archived) entry in `analysisIndex` has a `url` field that is not null
   - Check every evidence item in active themes in `themeRegistry` has a `url` field that is not null
   - Check every post in `postBacklog` with status != archived/rejected has `sourceUrls` array with at least one URL
   - For any missing URLs: search the web for the actual page (using title + source), fetch it to verify the content matches, then write it to state.json

3. **URL validation:**
   - For every URL added this week (check entries with recent `dateProcessed` or session >= current - 3), fetch the URL and confirm it resolves (not 404/403)
   - If a URL is dead, search for an alternative and update it

4. **Transcript coverage audit:**
   - Check `~/Desktop/Podcast Transcripts/` for any .md files not yet in the analysisIndex (match by filename field)
   - Report how many transcripts are pending

5. **Theme health check:**
   - Flag any active theme with fewer than 2 evidence items (underdeveloped)
   - Flag any theme not updated in the last 5 sessions (going stale)
   - Check for themes that should have cross-connections but don't

6. **Post backlog health:**
   - Count posts by status (suggested, approved, in-progress, published, archived)
   - Flag any posts without sourceDocuments or sourceUrls

7. **Write a sweep report** to `data/editorial/sweep-report.json`:
   ```json
   {
     "date": "YYYY-MM-DD",
     "urlCoverage": {
       "analysisEntries": { "total": N, "withUrl": N, "fixed": N },
       "themeEvidence": { "total": N, "withUrl": N, "fixed": N },
       "postBacklog": { "total": N, "withUrls": N, "fixed": N }
     },
     "deadUrls": { "found": N, "fixed": N, "remaining": [] },
     "pendingTranscripts": N,
     "themeHealth": { "underdeveloped": [], "stale": [] },
     "backlogHealth": { "bySatus": {}, "missingUrls": N },
     "issues": []
   }
   ```

8. If any issues were found and fixed, save state.json with the write-validate-swap pattern (backup first).

9. Report summary to the user.
