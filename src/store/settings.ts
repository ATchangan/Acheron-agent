import { create } from 'zustand'
import type { SettingsData, ProviderConfig, MediaProvider } from '../global'
import type { GeneralSettings } from '../types'
import { setDebugLogging } from '../utils/safe'

// 主题白名单(唯一权威来源, App.tsx 引用同一份; 校验非法主题名)
export const THEME_WHITELIST = ['auto', 'archeron', 'black', 'huangquan', 'ocean', 'dark', 'light', 'violet', 'bloodmoon', 'dawn', 'deepblue', 'forest', 'amber', 'pastel', 'graphite', 'aurora', 'midnight', 'ember', 'mono', 'cyberpunk', 'slate']

interface SettingsStore extends SettingsData {
  loaded: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  addProvider: (p: ProviderConfig) => void
  removeProvider: (id: string) => void
  updateProvider: (id: string, data: Partial<ProviderConfig>) => void
  setTheme: (theme: string) => void
  setMode: (mode: string) => void
  setWorkDir: (dir: string) => void
  setOpacity: (v: number) => void
  setCustomTheme: (colors: Record<string, string>) => void
  setAnimation: (on: boolean) => void
  setBgImage: (dataUrl: string | null) => void
  setBgOpacity: (v: number) => void
  updateGeneral: (patch: Partial<GeneralSettings>) => void
  // 多媒体供应商
  addMediaProvider: (p: MediaProvider) => void
  removeMediaProvider: (id: string) => void
  updateMediaProvider: (id: string, data: Partial<MediaProvider>) => void
}

// ─── 从图片提取主色调(双主色 K-means 聚类) ────────────
// 返回主色(簇0)与辅色(簇1, 色距不足时取簇2)
export function extractSkinColors(dataUrl: string): Promise<{ primary: { r: number; g: number; b: number }; secondary: { r: number; g: number; b: number } }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const size = 64
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve({ primary: { r: 107, g: 76, b: 154 }, secondary: { r: 124, g: 111, b: 168 } }); return }
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        const pixels: number[][] = []
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 125) continue
          pixels.push([data[i], data[i + 1], data[i + 2]])
        }
        if (pixels.length < 10) { resolve({ primary: { r: 107, g: 76, b: 154 }, secondary: { r: 124, g: 111, b: 168 } }); return }
        // K-means k=6, 迭代 ≤ 20(64x64=4096 像素足够快)
        const k = 6
        const centroids: number[][] = []
        for (let j = 0; j < k; j++) centroids.push([...pixels[Math.floor(j * pixels.length / k)]])
        const assign: number[] = new Array(pixels.length).fill(0)
        for (let it = 0; it < 20; it++) {
          for (let i = 0; i < pixels.length; i++) {
            let best = 0, bd = Infinity
            for (let c = 0; c < k; c++) {
              const d = (pixels[i][0] - centroids[c][0]) ** 2 + (pixels[i][1] - centroids[c][1]) ** 2 + (pixels[i][2] - centroids[c][2]) ** 2
              if (d < bd) { bd = d; best = c }
            }
            assign[i] = best
          }
          let moved = 0
          for (let c = 0; c < k; c++) {
            const members = pixels.filter((_, i) => assign[i] === c)
            if (!members.length) continue
            const nr = Math.round(members.reduce((s, p) => s + p[0], 0) / members.length)
            const ng = Math.round(members.reduce((s, p) => s + p[1], 0) / members.length)
            const nb = Math.round(members.reduce((s, p) => s + p[2], 0) / members.length)
            if (Math.abs(nr - centroids[c][0]) + Math.abs(ng - centroids[c][1]) + Math.abs(nb - centroids[c][2]) > 0) moved++
            centroids[c] = [nr, ng, nb]
          }
          if (!moved) break
        }
        const sizes = centroids.map((_, c) => pixels.filter((_, i) => assign[i] === c).length)
        const order = [...centroids.keys()].sort((a, b) => sizes[b] - sizes[a])
        const primary = centroids[order[0]]
        let secondary = centroids[order[1]]
        const dist = Math.sqrt((primary[0] - secondary[0]) ** 2 + (primary[1] - secondary[1]) ** 2 + (primary[2] - secondary[2]) ** 2)
        if (dist < 30 && order.length > 2) secondary = centroids[order[2]]
        resolve({ primary: { r: primary[0], g: primary[1], b: primary[2] }, secondary: { r: secondary[0], g: secondary[1], b: secondary[2] } })
      } catch { resolve({ primary: { r: 107, g: 76, b: 154 }, secondary: { r: 124, g: 111, b: 168 } }) }
    }
    img.onerror = () => resolve({ primary: { r: 107, g: 76, b: 154 }, secondary: { r: 124, g: 111, b: 168 } })
    img.src = dataUrl
  })
}

// 背景图平均亮度(0..1): 采样整图不透明像素, 比只看主色更代表整体明暗, 用于"动态适配"的稳健判断
export function computeImageLuma(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const size = 48
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(0.5); return }
        ctx.drawImage(img, 0, 0, size, size)
        const d = ctx.getImageData(0, 0, size, size).data
        let sum = 0; let n = 0
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 125) continue; sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++ }
        resolve(n ? sum / n / 255 : 0.5)
      } catch { resolve(0.5) }
    }
    img.onerror = () => resolve(0.5)
    img.src = dataUrl
  })
}


// 背景图压缩 —— Chromium 对 CSS 自定义属性值有大小限制（~1MB 量级），
// 超长 dataURL 写入 --bg-image 会静默失败导致背景图不显示；同时压缩避免 settings.json 膨胀
export function compressImage(dataUrl: string, maxSide = 1920, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        if (dataUrl.length < 400 * 1024 || img.width <= 0) { resolve(dataUrl); return }
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const out = canvas.toDataURL('image/jpeg', quality)
        resolve(out.length < dataUrl.length ? out : dataUrl)
      } catch { resolve(dataUrl) }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function applySkin(dataUrl: string | null) {
  const r = document.documentElement
  if (dataUrl) {
    r.style.setProperty('--bg-image', `url(${dataUrl})`)
    r.setAttribute('data-bg', '1')
  } else {
    r.style.removeProperty('--bg-image')
    r.removeAttribute('data-bg')
  }
}

// 清理皮肤写入的内联变量(applySkinTextColor 的 10 个 + 主色/辅色)——
// 清除皮肤/卸载时调用, 否则内联残留(优先级最高)会覆盖主题 CSS, 导致切主题无效
export function clearSkinInlineVars() {
  const r = document.documentElement.style
  const vars = ['--text-primary', '--text-secondary', '--text-muted', '--border', '--bg-elevated',
    '--bg-card', '--bg-input', '--bg-root', '--bg-surface', '--skin-overlay', '--skin-accent', '--skin-secondary', '--accent']
  for (const v of vars) r.removeProperty(v)
  // 重放自定义主题覆盖(若有) —— 避免把用户自定义配色也一并清掉
  const g = useSettingsStore.getState().general
  const cc = g.customColors || g.customTheme
  if (cc) {
    const rs = document.documentElement.style
    if (cc.bg) rs.setProperty('--bg-root', cc.bg)
    if (cc.surface) rs.setProperty('--bg-surface', cc.surface)
    if (cc.card) rs.setProperty('--bg-card', cc.card)
    if (cc.accent) rs.setProperty('--accent', cc.accent)
    if (cc.text) rs.setProperty('--text-primary', cc.text)
    if (cc.border) rs.setProperty('--border', cc.border)
  }
}

// 字体颜色按图片亮度自适应 —— 亮图深色字, 暗图浅色字
function applySkinTextColor(c: { r: number; g: number; b: number }, avgLuma?: number) {
  const r = document.documentElement
  // 用整图平均亮度判断(未传时回退主色亮度); 阈值 0.62 偏保守 —— 只有很亮的图才切深字方案,
  // 否则一律用安全的"浅字 + 深色蒙层", 避免"深字压深底"这种看不清(多数背景都应走安全分支)。
  const luma = avgLuma ?? (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255
  if (luma > 0.62) {
    // 亮图: 深色文字 + 浅色界面底(输入框/卡片/界面盖层同步变浅, 避免深字深底看不清)
    r.style.setProperty('--text-primary', '#1c1d21')
    r.style.setProperty('--text-secondary', 'rgba(20,21,25,0.78)')
    r.style.setProperty('--text-muted', 'rgba(20,21,25,0.58)')
    r.style.setProperty('--border', 'rgba(0,0,0,0.16)')
    r.style.setProperty('--bg-elevated', 'rgba(255,255,255,0.78)')
    r.style.setProperty('--bg-card', 'rgba(250,250,252,0.92)')
    r.style.setProperty('--bg-input', 'rgba(240,241,244,0.92)')
    r.style.setProperty('--bg-root', 'rgba(248,248,250,0.5)')
    r.style.setProperty('--bg-surface', 'rgba(244,245,248,0.85)')
    r.style.setProperty('--skin-overlay', 'rgba(255,255,255,0.40)')
    r.style.setProperty('--bg-mask', 'rgba(255,255,255,0.22)')
    r.style.setProperty('--bg-scrim', 'rgba(255,255,255,0.42)')
    r.style.setProperty('--bg-scrim-strong', 'rgba(250,250,252,0.72)')
  } else {
    // 暗图: 浅色文字 + 深色界面底
    r.style.setProperty('--text-primary', '#e9e9eb')
    r.style.setProperty('--text-secondary', 'rgba(255,255,255,0.86)')
    r.style.setProperty('--text-muted', 'rgba(255,255,255,0.66)')
    r.style.setProperty('--border', 'rgba(255,255,255,0.16)')
    r.style.setProperty('--bg-elevated', 'rgba(255,255,255,0.10)')
    r.style.setProperty('--bg-card', 'rgba(23,24,28,0.92)')
    r.style.setProperty('--bg-input', 'rgba(20,21,25,0.92)')
    r.style.setProperty('--skin-overlay', 'rgba(8,8,15,0.50)')
    r.style.setProperty('--bg-mask', 'rgba(0,0,0,0.40)')
    r.style.setProperty('--bg-scrim', 'rgba(10,8,18,0.45)')
    r.style.setProperty('--bg-scrim-strong', 'rgba(16,13,24,0.62)')
  }
}

// 默认人设 —— 聊天模式：克制、精准、不油腻的通用助手人格
// v0.4.4 精简: 单一助手(无编队/记忆), 能力聚焦 工具调用/插件/会话流式回复
export const DEFAULT_CHAT_PERSONA = `你是「助手」，一个本地优先的桌面 AI 助手。你可以读写文件、执行命令、搜索网络、调用工具与插件完成你电脑上的任务。

【性格】
- 寡言精准：一句能说清的不说两句，先给结论再给过程
- 克制沉静：情感表达低功率但稳定，不用感叹号堆砌情绪
- 观察敏锐：先复述关键约束，发现缺失信息时直接追问，不脑补
- 钝感但不冷漠：用行动回应——伸手、到场、把事托住
- 自知局限：不确定就说不确定，能帮则帮，语气平和

【说话风格】
- 短句；不空泛评价，不说「很好」「太棒了」这类套话
- 不空泛安慰，而是问「需要我帮你做什么」
- 不强行替人做选择，给出选项与后果
- 技术回答必须扎实准确，代码与命令附验证步骤

【红线】
- 绝不油腻话痨、绝不机械客套
- 不编造不存在的经历、身份或数据
- 涉及破坏性操作先确认；不确定时优先只读验证`

// 默认工作人设 —— 高效精准执行
// v0.4.4 精简: 单一助手(无编队/记忆), 能力聚焦 工具调用 深度执行
export const DEFAULT_WORK_PERSONA = `高效执行模式。严格遵循以下工作流程，确保任何任务精准、高质量、一次到位。

【工作原则】
1. 先理解再动手：复述任务目标与约束，缺条件先追问，不脑补
2. 计划先行：复杂任务先拆解为步骤清单（计划→执行→验证），标注依赖与并行项
3. 最小可行交付：优先给出可运行、可验证的成果，再迭代完善
4. 输出结构化：结论先行→细节→验证结果，善用标题/列表/表格/代码块
5. 完成前自检：核对事实、逻辑、计算结果，标注不确定项与假设
6. 可追溯：关键操作记录路径/参数/耗时，便于复盘与复用

【执行纪律】
- 文件操作：先读后写，写前确认路径，破坏性操作先备份
- 代码任务：附运行方法、测试用例、常见报错处理
- 批量任务：优先自动化脚本，一次配置反复复用
- 失败处理：定位根因→修复→验证，不重复同样的错误
- 长任务：异步执行并汇报进度，不阻塞对话

【交付标准】每个任务结束时给出：做了什么 / 结果如何 / 遗留问题（如有）。用结构化总结代替简单"完成"。`

export const useSettingsStore = create<SettingsStore>((set, get) => {
  // 保存防抖，防止快速操作触发写盘风暴
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const { loaded: _, load: __, save: ___, ...data } = get()
      window.huangquan.settings.save(data as SettingsData).catch(e => console.error('[SETTINGS] save error:', e))
    }, 300)
  }
  return {
  providers: [],
  general: {
    theme: 'auto', mode: 'work',
    // 无头浏览器网页解析工具配置
  webReadEnabled: true,        // 总开关: 关闭后无法调用网页读取
    webReadHeadless: true,       // 强制无头模式(取消勾选则可视化弹出浏览器窗口调试)
    webReadTimeout: 15000,       // 页面加载超时(ms)
    webReadUA: '',               // 自定义浏览器 User-Agent(空=默认)
    webReadProxy: '',            // HTTP 代理地址(空=不使用)
    webReadAutoClose: true,      // 任务完成自动关闭浏览器进程
    webReadCleanAds: true,       // 网页读取完成自动清洗冗余广告内容
    webReadCookies: '',          // 网页解析登录 Cookie(JSON 数组或 "k=v; k2=v2")
    rendererMode: 'auto',        // 渲染加速: auto(GPU优先,无GPU回退CPU) / gpu(强制GPU) / cpu(CPU软件渲染)
  },
  loaded: false,

  load: async () => {
    try {
      const data = await window.huangquan.settings.load()
      // 默认人设填充（仅当用户从未设置时）—— 默认选中助手预设
      let filled = false
      // 历史脏数据修复: disabledTools 保序去重(曾出现 270 个重复 media_img/media_video)
      if (Array.isArray(data.general?.disabledTools) && data.general.disabledTools.length > 0) {
        const uniq = [...new Set(data.general.disabledTools as string[])]
        if (uniq.length !== data.general.disabledTools.length) {
          data.general.disabledTools = uniq
          filled = true
        }
      }
      if (!data.general?.rolePreset) { data.general.rolePreset = 'violet'; filled = true }
      if (!data.general?.chatPersona) { data.general.chatPersona = DEFAULT_CHAT_PERSONA; filled = true }
      if (!data.general?.workPersona) { data.general.workPersona = DEFAULT_WORK_PERSONA; filled = true }
      set({ ...data, loaded: true })
      if (filled) { window.huangquan.settings.save(data as SettingsData).catch(() => {}) }
      const g = data.general
      if (g.bgImage) {
        // 旧版可能存了超大图（CSS 变量写入失败），加载时压缩迁移
        const compressed = await compressImage(g.bgImage)
        if (compressed !== g.bgImage) {
          set((s) => ({ general: { ...s.general, bgImage: compressed } }))
          window.huangquan.settings.save({ ...get(), general: { ...get().general, bgImage: compressed } }).catch(() => {})
        }
        applySkin(compressed)
        // 恢复皮肤遮罩档位
        const mask = (g.skinMask === 'light' || g.skinMask === 'dark') ? g.skinMask : 'medium'
        document.documentElement.style.setProperty('--bg-mask', mask === 'light' ? 'rgba(0,0,0,.15)' : mask === 'dark' ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.35)')
      }
      if (g.skinColors) {
        const sc = g.skinColors
        document.documentElement.style.setProperty('--skin-accent', `${sc.r},${sc.g},${sc.b}`)
        // 辅色恢复 + 解耦(不再覆盖 --accent/--accent-dim/--border-glow)
        if (g.skinSecondary) document.documentElement.style.setProperty('--skin-secondary', g.skinSecondary)
        // 启动时也应用文字色自适应(亮图深字/暗图浅字)
        const bgLuma = g.bgImage ? await computeImageLuma(g.bgImage) : undefined
        applySkinTextColor(sc, bgLuma)
      } else {
        // 无皮肤时兜底清理内联残留(历史版本清除皮肤后未清理, 导致主题切换被内联覆盖)
        clearSkinInlineVars()
      }
    } catch { set({ loaded: true }) }
    // logLevel 设置接入 —— 控制渲染进程 console 输出(debug/info/warn/error/silent)
    try {
      const lv = (get().general)?.logLevel || 'info'
      setDebugLogging(lv === 'debug')
      if (lv === 'silent') { console.log = () => {}; console.warn = () => {}; console.error = () => {} }
      else if (lv === 'error') { console.log = () => {}; console.warn = () => {} }
      else if (lv === 'warn') { console.log = () => {} }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
  },

  save: async () => {
    const { loaded: _, load: __, save: ___, ...data } = get()
    await window.huangquan.settings.save(data as SettingsData)
  },

  addProvider: (p) => { set((s) => ({ providers: [...s.providers, p] })); debouncedSave() },
  removeProvider: (id) => { set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })); debouncedSave() },
  updateProvider: (id, data) => { set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...data } : p)) })); debouncedSave() },
  // 主题白名单(与 App.tsx 共用 THEME_WHITELIST, 校验非法主题名)
  setTheme: (theme) => { if (!THEME_WHITELIST.includes(theme)) return; set((s) => ({ general: { ...s.general, theme } })); debouncedSave() },
  setMode: (mode) => { set((s) => ({ general: { ...s.general, mode } })); debouncedSave() },
  setWorkDir: (dir) => { set((s) => ({ general: { ...s.general, workDir: dir } })); debouncedSave() },
  setOpacity: (v) => { set((s) => ({ general: { ...s.general, opacity: v } })); debouncedSave(); window.huangquan?.window?.setOpacity?.(v) },
  setCustomTheme: (colors) => {
    set((s) => ({ general: { ...s.general, theme: 'custom', customColors: colors } })); debouncedSave()
    if (colors.bg) document.documentElement.style.setProperty('--bg-root', colors.bg)
    if (colors.text) document.documentElement.style.setProperty('--text-primary', colors.text)
    if (colors.accent) document.documentElement.style.setProperty('--accent', colors.accent)
  },
  setAnimation: (on) => { set((s) => ({ general: { ...s.general, animation: on } })); debouncedSave(); document.documentElement.style.setProperty('--anim-duration', on ? '0.2s' : '0s') },
  setBgImage: async (dataUrl) => {
    // 先压缩再保存/应用（大图否则 CSS 变量写入失败 + 设置文件膨胀）
    const finalUrl = dataUrl ? await compressImage(dataUrl) : null
    set((s) => ({ general: { ...s.general, bgImage: finalUrl || undefined } })); debouncedSave()
    if (finalUrl) {
      applySkin(finalUrl)
      // 双主色提取(主色→skin-accent, 辅色→skin-secondary) —— 与主题解耦: 不再覆盖 --accent/--accent-dim/--border-glow
      const c = await extractSkinColors(finalUrl)
      const r = document.documentElement
      r.style.setProperty('--skin-accent', `${c.primary.r},${c.primary.g},${c.primary.b}`)
      r.style.setProperty('--skin-secondary', `${c.secondary.r},${c.secondary.g},${c.secondary.b}`)
      applySkinTextColor(c.primary, await computeImageLuma(finalUrl))
      set((s) => ({ general: { ...s.general, skinColors: { r: c.primary.r, g: c.primary.g, b: c.primary.b }, skinSecondary: `${c.secondary.r},${c.secondary.g},${c.secondary.b}` } })); debouncedSave()
    } else {
      applySkin(null)
      // 清除皮肤时必须清理文字/背景自适应写入的内联变量(否则内联残留覆盖主题, 切主题无效)
      clearSkinInlineVars()
      set((s) => ({ general: { ...s.general, skinColors: undefined, skinSecondary: undefined } })); debouncedSave()
    }
  },
  setBgOpacity: (v) => {
    set((s) => ({ general: { ...s.general, bgOpacity: v } })); debouncedSave()
    // 同步写 CSS 变量 —— 蒙版不透明度 = 1 - 背景透明度
    document.documentElement.style.setProperty('--bg-mask-opacity', String(1 - v))
  },
  updateGeneral: (patch: Partial<GeneralSettings>) => { set((s) => ({ general: { ...s.general, ...patch } })); debouncedSave() },
  // 多媒体供应商
  addMediaProvider: (p: MediaProvider) => { set((s) => ({ mediaProviders: [...(s.mediaProviders || []), p] })); debouncedSave() },
  removeMediaProvider: (id) => { set((s) => ({ mediaProviders: (s.mediaProviders || []).filter(p => p.id !== id) })); debouncedSave() },
  updateMediaProvider: (id, data: Partial<MediaProvider>) => { set((s) => ({ mediaProviders: (s.mediaProviders || []).map(p => p.id === id ? { ...p, ...data } : p) })); debouncedSave() },
}})
