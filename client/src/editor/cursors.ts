/**
 * y-monaco tags remote selection/cursor decorations with these class names
 * (verified against yjs/y-monaco src/y-monaco.js):
 *
 *   className:            'yRemoteSelection yRemoteSelection-' + clientID
 *   beforeContentClassName:
 *   afterContentClassName: 'yRemoteSelectionHead yRemoteSelectionHead-' + clientID
 *
 * It ships no stylesheet for them at all — without this module, everything
 * about presence "works" (awareness updates flow, `getStates()` has the
 * right data) and the editor renders completely blank cursors. There is
 * nothing to debug; there is only this file, and it has to exist before the
 * feature can be checked off, not after.
 *
 * Per-client rules are (re)written into one <style> tag whenever awareness
 * changes, embedding each user's name and color directly as CSS text.
 */
import type * as awarenessProtocol from 'y-protocols/awareness'

const STYLE_TAG_ID = 'together-remote-cursors'

interface AwareUser {
  name: string
  color: string
}

const escapeForCssString = (s: string) => s.replace(/["\\]/g, '\\$&')

const ruleFor = (clientId: number, user: AwareUser): string => {
  const id = escapeForCssString(String(clientId))
  const color = escapeForCssString(user.color)
  const name = escapeForCssString(user.name)
  return `
.yRemoteSelection-${id} {
  background-color: ${color};
  opacity: 0.35;
}
.yRemoteSelectionHead-${id} {
  position: relative;
  border-left: 2px solid ${color};
  border-top: 2px solid ${color};
}
.yRemoteSelectionHead-${id}::after {
  content: "${name}";
  position: absolute;
  top: -1.1em;
  left: -2px;
  padding: 0 4px;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  color: #fff;
  background-color: ${color};
  border-radius: 2px 2px 2px 0;
  pointer-events: none;
  z-index: 10;
}`
}

/**
 * Keeps a <style> tag in sync with the awareness list. Returns a disposer
 * that removes the tag and unsubscribes.
 */
export function installRemoteCursorStyles(awareness: awarenessProtocol.Awareness): () => void {
  let styleEl = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE_TAG_ID
    document.head.appendChild(styleEl)
  }

  const render = () => {
    const rules: string[] = []
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return // don't style our own cursor
      const user = (state as { user?: AwareUser } | undefined)?.user
      if (!user?.name || !user?.color) return
      rules.push(ruleFor(clientId, user))
    })
    if (styleEl) styleEl.textContent = rules.join('\n')
  }

  render()
  awareness.on('change', render)

  return () => {
    awareness.off('change', render)
    // Only one editor/room is ever mounted per tab, so clearing outright is
    // correct here (no other instance's rules to preserve) and avoids
    // re-reading awareness state that provider.destroy() may have already
    // torn down by the time this runs.
    if (styleEl) styleEl.textContent = ''
  }
}
