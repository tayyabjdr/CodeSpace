import './Toggle.css'

export default function Toggle({ checked, onChange, ariaLabel, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`cs-toggle${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`}
      onClick={() => !disabled && onChange?.(!checked)}
    >
      <span className="cs-toggle-thumb" />
    </button>
  )
}
