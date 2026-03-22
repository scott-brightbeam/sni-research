import { useEffect } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/**
 * Register global keyboard shortcuts.
 *
 * @param {Record<string, (e: KeyboardEvent) => void>} shortcuts
 *   Keys are shortcut descriptors like 'cmd+k', 'cmd+1', 'esc'.
 *   'cmd' maps to metaKey on Mac, ctrlKey elsewhere.
 */
export function useKeyboardShortcuts(shortcuts) {
  useEffect(() => {
    function handler(e) {
      const mod = isMac ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()

      for (const [combo, fn] of Object.entries(shortcuts)) {
        const parts = combo.toLowerCase().split('+')
        const needsMod = parts.includes('cmd')
        const target = parts[parts.length - 1]

        if (needsMod && !mod) continue
        if (!needsMod && mod) continue

        // Match Escape without modifier
        if (target === 'esc' && key === 'escape' && !needsMod) {
          e.preventDefault()
          fn(e)
          return
        }

        // Match digit keys (cmd+1 through cmd+9)
        if (needsMod && /^\d$/.test(target) && key === target) {
          e.preventDefault()
          fn(e)
          return
        }

        // Match letter keys (cmd+k)
        if (needsMod && /^[a-z]$/.test(target) && key === target) {
          e.preventDefault()
          fn(e)
          return
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [shortcuts])
}
