import { useMemo, useState } from 'react'
import './SkillsPanel.css'

export default function SkillsPanel({
  width,
  loadState,  // 'loading' | 'content' | 'error' — 'error' currently renders nothing; UI deferred.
  skills,
  pluginSkills = [],
  sourcePath,
  onClose,
  onCreate,
  onRevealDir,
}) {
  const [filter, setFilter] = useState('')
  const [mode, setMode] = useState('list')  // 'list' | 'create'
  const [tab, setTab] = useState('user')    // 'user' | 'plugins'
  const [draftName, setDraftName] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [createError, setCreateError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const activeList = tab === 'plugins' ? pluginSkills : skills

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return activeList
    return activeList.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    )
  }, [activeList, filter])

  const openCreate = () => {
    setDraftName('')
    setDraftBody('')
    setCreateError(null)
    setMode('create')
  }
  const cancelCreate = () => {
    setMode('list')
    setCreateError(null)
  }
  const submitCreate = async (e) => {
    e?.preventDefault()
    setSubmitting(true)
    setCreateError(null)
    const r = await onCreate({ name: draftName, body: draftBody })
    setSubmitting(false)
    if (r?.ok) {
      setDraftName('')
      setDraftBody('')
      setMode('list')
    } else if (r?.reason === 'exists') {
      setCreateError(`A skill named "${draftName}" already exists`)
    } else if (r?.reason === 'invalid-name') {
      setCreateError('Name must contain letters, numbers, hyphens, or underscores')
    } else {
      setCreateError(r?.message ?? 'Could not save the skill')
    }
  }

  return (
    <aside
      className="skills-panel"
      style={{ width: `${width}px` }}
      role="complementary"
      aria-label="Skills"
    >
      <header className="skills-panel-header">
        <div className="skills-panel-title">
          <span>{mode === 'create' ? 'New skill' : 'Skills'}</span>
        </div>
        <div className="skills-panel-actions">
          <button type="button" className="skills-panel-closebtn" aria-label="Close Skills" onClick={onClose}>✕</button>
        </div>
      </header>

      {mode === 'list' && (
        <>
          <nav className="skills-panel-tabs" role="tablist" aria-label="Skill source">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'user'}
              className={`skills-panel-tab${tab === 'user' ? ' is-active' : ''}`}
              onClick={() => setTab('user')}
            >
              <span className="skills-panel-tab-label">User</span>
              <span className="skills-panel-tab-count">{skills.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'plugins'}
              className={`skills-panel-tab${tab === 'plugins' ? ' is-active' : ''}`}
              onClick={() => setTab('plugins')}
            >
              <span className="skills-panel-tab-label">Plugins</span>
              <span className="skills-panel-tab-count">{pluginSkills.length}</span>
            </button>
          </nav>

          <div className="skills-panel-filter">
            <svg className="skills-panel-filter-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Filter skills…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="skills-panel-body">
            {loadState === 'loading' && (
              <div className="skills-panel-loading" data-testid="skills-loading">
                <div className="skills-panel-loading-bar" />
              </div>
            )}

            {loadState === 'content' && visible.length === 0 && activeList.length === 0 && tab === 'user' && (
              <div className="skills-panel-empty">
                <p className="skills-panel-empty-title">No skills yet</p>
                <p className="skills-panel-empty-hint">Drop a <code>&lt;name&gt;/SKILL.md</code> under <code>~/.claude/skills/</code>, or use the button below.</p>
              </div>
            )}

            {loadState === 'content' && visible.length === 0 && activeList.length === 0 && tab === 'plugins' && (
              <div className="skills-panel-empty">
                <p className="skills-panel-empty-title">No plugin skills installed</p>
                <p className="skills-panel-empty-hint">Skills bundled with Claude Code plugins will appear here.</p>
              </div>
            )}

            {loadState === 'content' && visible.length === 0 && activeList.length > 0 && (
              <div className="skills-panel-empty">
                <p className="skills-panel-empty-title">No matches</p>
              </div>
            )}

            {loadState === 'content' && visible.length > 0 && (
              <ul className="skills-panel-list">
                {visible.map(skill => (
                  <li
                    key={skill.filePath}
                    className="skills-panel-card"
                    data-testid="skill-card"
                    draggable={true}
                    onDragStart={e => {
                      e.dataTransfer.setData('application/x-codespace-skill', skill.body ?? '')
                      e.dataTransfer.setData('application/x-codespace-skill-name', skill.name)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <div className="skills-panel-card-name" data-testid="skill-name">{skill.name}</div>
                    {skill.description && (
                      <div className="skills-panel-card-desc">{skill.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {loadState === 'content' && tab === 'user' && filter.trim().length === 0 && (
              <button type="button" className="skills-panel-create-row" onClick={openCreate}>
                <span className="skills-panel-create-plus" aria-hidden>+</span>
                <span className="skills-panel-create-label">Create skill</span>
              </button>
            )}

          </div>
        </>
      )}

      {mode === 'create' && (
        <form className="skills-panel-form" onSubmit={submitCreate}>
          <label className="skills-panel-field">
            <span>Skill name</span>
            <input
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              placeholder="my-skill"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="skills-panel-field skills-panel-field-grow">
            <span>Prompt</span>
            <textarea
              value={draftBody}
              onChange={e => setDraftBody(e.target.value)}
              placeholder="The instruction to inject into the terminal when this skill is dropped on it."
              spellCheck={false}
            />
          </label>
          {createError && <div className="skills-panel-form-error">{createError}</div>}
          <div className="skills-panel-form-actions">
            <button
              type="button"
              className="skills-panel-cancelbtn"
              onClick={cancelCreate}
              disabled={submitting}
            >Cancel</button>
            <button
              type="submit"
              className="skills-panel-savebtn"
              disabled={submitting || draftName.trim().length === 0 || draftBody.trim().length === 0}
            >Save</button>
          </div>
        </form>
      )}

      <footer className="skills-panel-footer">
        <button
          type="button"
          className="skills-panel-footer-path"
          onClick={onRevealDir}
          title="Open in file explorer"
        >
          {sourcePath ?? '~/.claude/skills/'}
        </button>
        <span className="skills-panel-footer-count">
          {activeList.length} {activeList.length === 1 ? 'skill' : 'skills'}
        </span>
      </footer>
    </aside>
  )
}
