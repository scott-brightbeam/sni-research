/**
 * Clickable theme code that opens the theme viewer in a new tab.
 * Use anywhere a theme code (T01, T54, etc.) is displayed.
 */
export default function ThemeLink({ code }) {
  if (!code || !/^T\d{2}$/.test(code)) return <span>{code}</span>
  return (
    <a
      href={`/theme/${code}`}
      target="_blank"
      rel="noopener noreferrer"
      className="source-link"
      onClick={e => e.stopPropagation()}
    >
      {code}
    </a>
  )
}

/**
 * Render an array of theme codes as clickable links.
 */
export function ThemeLinks({ themes }) {
  if (!themes || themes.length === 0) return <span>None</span>
  const codes = typeof themes === 'string' ? JSON.parse(themes) : themes
  return (
    <span>
      {codes.map((code, i) => (
        <span key={code}>
          {i > 0 && ', '}
          <ThemeLink code={code} />
        </span>
      ))}
    </span>
  )
}
