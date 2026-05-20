import { useMemo, useState } from 'react'
import './SkillsPanel.css'

export default function SkillsPanel({
  width,
  loadState,  // 'loading' | 'content' | 'error' — 'error' currently renders nothing; UI deferred.
  skills,
  sourcePath,
  onClose,
  onCreate,
  onRevealDir,
}) {
  const [filter, setFilter] = useState('')
  const [mode, setMode] = useState('list')  // 'list' | 'create'
  const [draftName, setDraftName] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [createError, setCreateError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    )
  }, [skills, filter])

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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cs-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 2l2.39 7.36H22l-6.19 4.49L18.2 21 12 16.51 5.8 21l2.39-7.15L2 9.36h7.61z"/>
          </svg>
          <span>{mode === 'create' ? 'New skill' : 'Skills'}</span>
        </div>
        <div className="skills-panel-actions">
          {mode === 'list' && (
            <button type="button" className="skills-panel-newbtn" onClick={openCreate}>+ new</button>
          )}
          <button type="button" className="skills-panel-closebtn" aria-label="Close Skills" onClick={onClose}>✕</button>
        </div>
      </header>

      {mode === 'list' && (
        <>
          <div className="skills-panel-filter">
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

            {loadState === 'content' && visible.length === 0 && skills.length === 0 && (
              <div className="skills-panel-empty">
                <p className="skills-panel-empty-title">No skills yet</p>
                <p className="skills-panel-empty-hint">Create one with <strong>+ new</strong>, or add an <code>.md</code> file to <code>~/.claude/commands/</code></p>
              </div>
            )}

            {loadState === 'content' && visible.length === 0 && skills.length > 0 && (
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
                    <div className="skills-panel-card-row">
                      <span className="skills-panel-card-name" data-testid="skill-name">{skill.name}</span>
                      <span className="skills-panel-card-grip" aria-hidden>⠿</span>
                    </div>
                    {skill.description && (
                      <div className="skills-panel-card-desc">{skill.description}</div>
                    )}
                  </li>
                ))}
              </ul>
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
          {sourcePath ?? '~/.claude/commands/'}
        </button>
        <span className="skills-panel-footer-count">
          {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
        </span>
      </footer>
    </aside>
  )
}
