import './RightToolbar.css'

const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 2l2.39 7.36H22l-6.19 4.49L18.2 21 12 16.51 5.8 21l2.39-7.15L2 9.36h7.61z"/>
  </svg>
)

const SlashIcon = () => (
  <span aria-hidden style={{ fontFamily: 'var(--cs-font-mono)', fontSize: 15, fontWeight: 700, lineHeight: 1 }}>/</span>
)

const FileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
)

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const PANELS = [
  { id: 'skills',   label: 'Skills',         icon: SparkleIcon, enabled: true  },
  { id: 'commands', label: 'Slash commands', icon: SlashIcon,   enabled: false },
  { id: 'editor',   label: 'Editor',         icon: FileIcon,    enabled: false },
  { id: 'search',   label: 'Search',         icon: SearchIcon,  enabled: false },
]

export default function RightToolbar({ activePanel, onSelectPanel, onOpenSettings }) {
  // TODO(a11y): role="toolbar" should support ArrowUp/ArrowDown to move
  // focus between buttons (roving tabindex). Tab-only nav works for now.
  return (
    <div className="right-toolbar" role="toolbar" aria-orientation="vertical" aria-label="Tools">
      {PANELS.map(p => {
        const Icon = p.icon
        const isActive = activePanel === p.id
        return (
          <button
            key={p.id}
            type="button"
            className={`right-toolbar-btn${isActive ? ' is-active' : ''}${p.enabled ? '' : ' is-stub'}`}
            title={p.enabled ? p.label : `${p.label} (coming soon)`}
            aria-label={p.label}
            aria-pressed={p.enabled ? isActive : undefined}
            disabled={!p.enabled}
            onClick={() => p.enabled && onSelectPanel(p.id)}
          >
            <Icon />
          </button>
        )
      })}
      <div className="right-toolbar-spacer" />
      <button
        type="button"
        className="right-toolbar-btn"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </button>
    </div>
  )
}
