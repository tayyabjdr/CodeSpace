export default function Toolbar({ onAdd }) {
  return <button onClick={() => onAdd('powershell')}>+ Add Terminal</button>
}
