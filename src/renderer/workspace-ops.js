// Pure workspace-array operations used by App's sidebar tree wiring.
// Kept out of App.jsx so they can be tested without mocking xterm, the
// settings store, or the PTY spawn path.

// Focus a terminal inside an EXPLICITLY named workspace.
//
// Deliberately not routed through App's `updateActive`: that helper is
// closed over the current `activeId`, so calling it in the same tick as
// setActiveId(wsId) writes the focus onto the workspace being navigated
// away from.
export function focusSessionIn(workspaces, wsId, termId) {
  return workspaces.map(w => (w.id === wsId ? { ...w, focusedTerminalId: termId } : w))
}

// Add wsId to an expanded-set, returning the SAME reference when it is
// already present so React can skip the re-render.
export function withExpanded(expandedIds, wsId) {
  if (expandedIds.has(wsId)) return expandedIds
  return new Set(expandedIds).add(wsId)
}
