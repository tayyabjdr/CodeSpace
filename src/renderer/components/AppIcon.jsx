export default function AppIcon({ size = 18, className }) {
  const id = `cs-icon-${size}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      /* Deliberately a literal, not a token. This component mirrors
         build/icon.svg, which is rasterized into build/icon.ico for the
         taskbar and the installer and strokes this exact hex. Pointing it at
         --cs-cyan would render the mark rose under the Bridge theme while the
         taskbar icon stayed cyan — one brand asset, two colours. It is
         branding rather than chrome, so it is exempt from the accent
         demotion and from literal-hex sweeps; if you change it, change
         build/icon.svg to match. */
      style={{ color: '#67e8f9' }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0a1830" />
          <stop offset="55%" stopColor="#143352" />
          <stop offset="100%" stopColor="#1d4f78" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="78%" cy="82%" r="60%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect width="512" height="512" rx="112" ry="112" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}-clip)`}>
        <rect width="512" height="512" fill={`url(#${id}-bg)`} />
        <rect width="512" height="512" fill={`url(#${id}-glow)`} />
      </g>
      <rect
        x="0.75" y="0.75" width="510.5" height="510.5"
        rx="111.25" ry="111.25"
        fill="none"
        stroke={`url(#${id}-rim)`}
        strokeWidth="1.5"
      />

      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="147 161 229 242 147 324" />
        <line x1="256" y1="351" x2="365" y2="351" />
      </g>
    </svg>
  )
}
