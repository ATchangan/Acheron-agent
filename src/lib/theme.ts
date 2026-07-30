type ThemeColors = { bg:string; surface:string; elevated:string; card:string; border:string; accent:string; accentPurple:string; accentGreen:string; text:string; secondary:string; muted:string; danger:string; success:string; gold:string }

export const THEME_COLORS: Record<string, ThemeColors> = {
  huangquan: { bg:'#0D0D1A',surface:'#12122A',elevated:'#1A1A2E',card:'#1E1E38',border:'#2A2A4A',accent:'#6B4C9A',accentPurple:'#8B6FC0',accentGreen:'#2D6A4F',text:'#E8E8F0',secondary:'#9999AA',muted:'#5A5A78',danger:'#C23B22',success:'#2D6A4F',gold:'#D4AF37' },
  dark:      { bg:'#0e1117',surface:'#13171f',elevated:'#181c26',card:'#1c2030',border:'#2a3040',accent:'#4dc9f6',accentPurple:'#b388ff',accentGreen:'#48c98a',text:'#e0e4f0',secondary:'#8b90a8',muted:'#5a5f78',danger:'#ff4466',success:'#48c98a',gold:'#ffaa00' },
  light:     { bg:'#f5f2eb',surface:'#fff',elevated:'#faf8f3',card:'#fff',border:'#e5e1d8',accent:'#2563eb',accentPurple:'#7c3aed',accentGreen:'#059669',text:'#1a1a1a',secondary:'#555',muted:'#888',danger:'#dc2626',success:'#059669',gold:'#b45309' },
  black:     { bg:'#000',surface:'#0a0a0a',elevated:'#111',card:'#151515',border:'#252525',accent:'#fff',accentPurple:'#999',accentGreen:'#0f6',text:'#e0e0e0',secondary:'#808080',muted:'#505050',danger:'#f44',success:'#0f6',gold:'#fa0' },
}
export const DEFAULT_THEME = 'huangquan'
