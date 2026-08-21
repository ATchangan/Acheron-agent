import React from 'react'

// 经典紫主题专属线性图标 —— 手绘风, 不用 emoji / 通用 AI 应用图标
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

// 时漏（定时任务）
export const HourglassMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M6 3h12M6 21h12" />
    <path d="M7.2 3c1.4 3.8 3.2 5.7 4.8 7.2-1.6 1.5-3.4 3.4-4.8 7.2M16.8 3c-1.4 3.8-3.2 5.7-4.8 7.2 1.6 1.5 3.4 3.4 4.8 7.2" />
    <path d="M10.2 12.5h3.6" />
  </svg>
)

// 卷轴（藏书阁）
export const ScrollMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M7 3h9a3 3 0 0 1 3 3v11a4 4 0 0 1-4 4H7a1.5 1.5 0 0 1-1.5-1.5V4.5A1.5 1.5 0 0 1 7 3z" />
    <path d="M16 6h1.5M9 8h6M9 12h6M9 16h4" />
  </svg>
)

// 面具（插件）
export const MaskMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M4.5 11.5C5.4 6.7 8.2 4.6 12 4.6s6.6 2.1 7.5 6.9c.4 2.3-.7 4.4-3.1 5.3-1.4.5-2.9.6-4.4.6s-3-.1-4.4-.6c-2.4-.9-3.5-3-3.1-5.3z" />
    <path d="M8.8 11.4h.01M15.2 11.4h.01M8.5 15.5c1.1.6 2.2.9 3.5.9s2.4-.3 3.5-.9" />
  </svg>
)

// ─── 通用小图标（与上述大图标同一套手绘风） ───
export const PlusMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
)

export const TemplateMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9h10M7 13h6" />
  </svg>
)

export const FolderMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M8 12h8" />
  </svg>
)

export const LinkMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
)

export const SearchMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
)

export const UploadMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M12 16V5M8 9l4-4 4 4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </svg>
)

export const AskMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.3V13" />
    <path d="M12 16h.01" />
  </svg>
)

export const DocMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h4" />
  </svg>
)

export const TrashMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
)

export const EmptyMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M4 5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    <path d="M8 9h8M8 13h5" />
  </svg>
)

export const InfoMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M12 12v4" />
  </svg>
)

export const LockMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

export const ToolMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 12l-2-2z" />
  </svg>
)

export const BoltMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></svg>
)

export const TagMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </svg>
)
