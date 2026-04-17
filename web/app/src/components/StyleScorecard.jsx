/**
 * StyleScorecard — compact panel showing how a draft compares to
 * Scott's published-corpus baseline. Renders inline under the
 * assistant message when a draft scorecard is emitted.
 */
import './StyleScorecard.css'

function Metric({ label, value, baseline, unit = '', good }) {
  const deviation = baseline ? (value - baseline) / baseline : 0
  const status = good ?? (Math.abs(deviation) < 0.25 ? 'ok' : Math.abs(deviation) < 0.5 ? 'warn' : 'bad')
  return (
    <div className={`ss-metric ss-${status}`}>
      <div className="ss-metric-label">{label}</div>
      <div className="ss-metric-value">{value}{unit}</div>
      {baseline != null && <div className="ss-metric-baseline">Scott avg: {baseline}{unit}</div>}
    </div>
  )
}

export default function StyleScorecard({ scorecard: s }) {
  if (!s) return null

  const scoreColour = s.score >= 85 ? 'great' : s.score >= 70 ? 'good' : s.score >= 50 ? 'warn' : 'bad'

  return (
    <div className="style-scorecard">
      <div className="ss-header">
        <div className={`ss-score ss-${scoreColour}`}>
          <div className="ss-score-num">{s.score}</div>
          <div className="ss-score-label">Style match</div>
        </div>
        <div className="ss-checks">
          <div className={`ss-check ${s.hasIteate ? 'ok' : 'bad'}`}>
            {s.hasIteate ? '✓' : '✗'} In-the-end-at-the-end
          </div>
          <div className={`ss-check ${s.hasConcreteOpening ? 'ok' : 'bad'}`}>
            {s.hasConcreteOpening ? '✓' : '✗'} Concrete opening
          </div>
          <div className={`ss-check ${s.firstPersonHits > 0 ? 'ok' : 'bad'}`}>
            {s.firstPersonHits > 0 ? '✓' : '✗'} First-person voice ({s.firstPersonHits})
          </div>
          <div className={`ss-check ${s.doubleQuotesUsed === 0 ? 'ok' : 'bad'}`}>
            {s.doubleQuotesUsed === 0 ? '✓' : '✗'} Single quotes only
          </div>
        </div>
      </div>

      <div className="ss-metrics">
        <Metric label="Word count" value={s.wordCount} baseline={s.baseline_word_count_avg} />
        <Metric label="Avg sentence" value={s.avgSentenceLen} baseline={s.baseline_sentence_word_avg} unit=" words" />
        <Metric label="Short (≤5 words)" value={s.shortSentencePct} baseline={s.baseline_short_pct} unit="%" />
        <Metric label="Long (≥25 words)" value={s.longSentencePct} baseline={s.baseline_long_pct} unit="%" />
      </div>

      {(s.prohibitedHits.length > 0 || s.falseContrastHits > 0 || s.pseudoHits > 0) && (
        <div className="ss-issues">
          <div className="ss-issues-label">Issues found:</div>
          {s.prohibitedHits.length > 0 && (
            <div className="ss-issue">
              Prohibited words: {s.prohibitedHits.map(h => `"${h.term}"${h.count > 1 ? ` ×${h.count}` : ''}`).join(', ')}
            </div>
          )}
          {s.falseContrastHits > 0 && (
            <div className="ss-issue">False-contrast patterns: {s.falseContrastHits}</div>
          )}
          {s.pseudoHits > 0 && (
            <div className="ss-issue">Pseudo-profundity: {s.pseudoHits}</div>
          )}
        </div>
      )}
    </div>
  )
}
