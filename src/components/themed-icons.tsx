import React from 'react'

// 黄泉主题专属线性图标 —— 手绘风, 不用 emoji / 通用 AI 应用图标
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

// 面具（式神）
export const MaskMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M4.5 11.5C5.4 6.7 8.2 4.6 12 4.6s6.6 2.1 7.5 6.9c.4 2.3-.7 4.4-3.1 5.3-1.4.5-2.9.6-4.4.6s-3-.1-4.4-.6c-2.4-.9-3.5-3-3.1-5.3z" />
    <path d="M8.8 11.4h.01M15.2 11.4h.01M8.5 15.5c1.1.6 2.2.9 3.5.9s2.4-.3 3.5-.9" />
  </svg>
)

// 符文（符文工坊）
export const RuneMark: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg {...base(size)}>
    <path d="M12 3.2l8.2 8.8-8.2 8.8L3.8 12z" />
    <path d="M12 3.2v17.6M3.8 12h16.4" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
)
