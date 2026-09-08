import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (props: P): P => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...props,
})

export const UndoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5h6a3 3 0 0 1 0 6H7" />
    <path d="M6 3.5 3 6.5l3 3" />
  </svg>
)

export const RedoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.5 6.5h-6a3 3 0 0 0 0 6H9" />
    <path d="m10 3.5 3 3-3 3" />
  </svg>
)

export const BoldIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 3h4a2.5 2.5 0 0 1 0 5h-4zM4.5 8h4.5a2.5 2.5 0 0 1 0 5h-4.5z" />
  </svg>
)

export const AlignIcon = ({ align, ...p }: P & { align: 'left' | 'center' | 'right' }) => (
  <svg {...base(p)}>
    <path d="M2.5 4h11" />
    <path d={align === 'left' ? 'M2.5 8h7' : align === 'center' ? 'M4.5 8h7' : 'M6.5 8h7'} />
    <path d="M2.5 12h11" />
  </svg>
)

export const HistoryIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.5 3v3h3" />
    <path d="M8 5.5V8l2 1.5" />
  </svg>
)

export const SparkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2.5 9.4 6.6 13.5 8l-4.1 1.4L8 13.5 6.6 9.4 2.5 8l4.1-1.4z" />
  </svg>
)

export const ImportIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2.5v7" />
    <path d="m5.5 7 2.5 2.5L10.5 7" />
    <path d="M3 11v2.5h10V11" />
  </svg>
)

export const ExportIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 9.5v-7" />
    <path d="m5.5 5 2.5-2.5L10.5 5" />
    <path d="M3 11v2.5h10V11" />
  </svg>
)

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const HomeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7.5 8 3l5 4.5V13H3z" />
    <path d="M6.5 13V9.5h3V13" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m3 8.5 3 3 7-7" />
  </svg>
)

export const MinusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h10" />
  </svg>
)

export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
)

export const PasteIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3.5" width="10" height="10" rx="1.5" />
    <path d="M6 3.5V2.5h4v1" />
    <path d="M5.5 8h5M5.5 10.5h3" />
  </svg>
)

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.7 8.5h5.6l.7-8.5" />
  </svg>
)

export const GridIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M2.5 6.5h11M2.5 10h11M6.5 2.5v11" />
  </svg>
)

/** The Tabula mark: a tiny grid with one highlighted cell. */
export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--green)" />
    <path d="M7 9h10M7 13h10M7 17h10M11 6v14" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />
    <rect x="11.5" y="9.5" width="5.5" height="3.5" fill="#fff" rx="0.5" />
  </svg>
)
