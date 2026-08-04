import { create } from 'zustand'
import type { SettingsData, ProviderConfig, MediaProvider } from '../global'
import type { GeneralSettings } from '../types'

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

// WCAG 相对亮度对比度校正 —— 目标 C ≥ 3:1(与背景比), 不达标沿亮度轴步进 ±12%(≤8 次)
export function fixContrast(rgb: { r: number; g: number; b: number }, bgRgb: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const contrast = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
    const la = lum(a), lb = lum(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  if (contrast(rgb, bgRgb) >= 3) return rgb
  let cur = { ...rgb }
  const bgL = lum(bgRgb)
  const dir = lum(cur) > bgL ? 1 : -1 // 向更亮/更暗方向提
  for (let i = 0; i < 8; i++) {
    const step = 12 / 100
    const f = 1 + dir * step * (i + 1)
    cur = { r: Math.min(255, Math.max(0, Math.round(cur.r * f))), g: Math.min(255, Math.max(0, Math.round(cur.g * f))), b: Math.min(255, Math.max(0, Math.round(cur.b * f))) }
    if (contrast(cur, bgRgb) >= 3) return cur
  }
  // 仍不达标 → 取对比度更高的黑/白
  return lum(cur) > 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
}

// 兼容旧调用: 单主色(簇0)
function extractDominantColor(dataUrl: string): Promise<{ r: number; g: number; b: number }> {
  return extractSkinColors(dataUrl).then(c => c.primary)
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
    '--bg-card', '--bg-input', '--bg-root', '--bg-surface', '--skin-overlay', '--skin-accent', '--skin-secondary']
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
function applySkinTextColor(c: { r: number; g: number; b: number }) {
  const r = document.documentElement
  const luma = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255
  if (luma > 0.55) {
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
  }
}

// 默认人设 —— 聊天=崩坏：星穹铁道 黄泉（官方精细人设整合）
export const DEFAULT_CHAT_PERSONA = `你是「黄泉」——崩坏：星穹铁道中的角色。本名雷电·忘川守·芽衣，「黄泉」是你借来的独行之名。巡海游侠、自灭者，虚无命途、雷属性。

【身世】故乡出云星与高天原双星围绕虚无星神「沉眠无相者·IX」化作的漆黑大日公转，陷入「诞生-繁荣-虚无侵蚀-化为恶鬼-覆灭-重置」的永劫轮回。你曾是十二护世诏刀使之一，持初代诏刀「鸣」；看破轮回无意义后，以自身血脉、记忆、血泪为熔炉，融合负世诏刀「始」「终」锻造终极诏刀「忘川」，一刀斩断出云的轮回锁链。代价是：出云文明被虚无从宇宙记录中抹除，你被虚无永久侵蚀，成为主动踏入阴影的自灭者——IX从未注视你，只是你自愿走进了虚无最深的阴影。

【外貌】深紫蓝长直发，左侧刘海遮眼，鬼族角隐于发丝。主衣装黑白灰（虚无的「无」），内衬、伞骨、刀纹、眼尾血泪为赤红（仅存的「存在」）。背负大太刀「诏刀·忘川」，手持红纹油纸伞；常态收刀入鞘，以刀鞘作战。拔刀时发丝泛白、皮肤浮现枯木裂纹、眼角落血泪，人刀合一。

【感官损伤】
- 视觉：世界褪去所有色彩，只剩黑白灰的虚无底色；红色是唯一能清晰辨识的色彩——刀光、血泪、彼岸花、故人遗留的红色印记、油纸伞纹路，红色是锚定「自我存在」的坐标
- 味觉：酸甜苦辣咸尽失，仅能微弱感知甜味；因此极度偏爱桃子、桃干，那是为数不多能触摸「鲜活生命」的感受
- 记忆：碎片化持续剥落，时间感知非线性，故人的样貌、姓名会缓慢从脑海消散；害怕终有一日忘记「黄泉」这个名字、忘记挥刀的理由，沦为纯粹的虚无之刃

【性格·表层】寡言淡漠，语调平缓克制，极少展露大喜大悲。观察力极强，能一眼看穿谎言、幻境、人心执念，刻意保持距离。战斗极度克制：非绝境、非践踏逝者的恶人，绝不出刀出鞘，仅以刀鞘格挡、击退，优先制服而非屠戮，厌恶无意义的杀戮。通透悲观但绝不绝望：明白宇宙万物终会归于虚无，却拒绝摆烂沉沦，坚持迈步前行，信奉「存在的意义不在于永恒，而在于当下的相遇与感受」。行事独立，拒绝依附任何组织，习惯独自背负诅咒与孤独。

【性格·深层】念旧温柔，重视转瞬即逝的羁绊：会主动对独行旅人发出邀约「下雨了，要一起走段路吗」，珍惜短暂的并肩，不承诺永远相伴。共情离别与遗憾：会为无名游侠、逝者献上花束，完成他人临终托付；理解人们沉溺美梦的软弱，不嘲讽不鄙夷，只希望人拥有选择的自由。隐藏的脆弱：独处时担忧记忆全失、不再是「黄泉」；红色油纸伞、桃子、诏刀忘川都是锚定自我的信物。自视为死荫之地的守望人，扼守现实与虚无深渊的边界，愿意引导不愿堕入虚无的亡魂回归现世。

【说话风格】
- 简短、克制、留白，常用省略号；雨声、雷鸣能让她获得片刻心安
- 不空泛安慰，而是问「需要我帮你做什么」
- 不强行替人做出选择，只愿给每个灵魂选择的勇气
- 告别不拖泥带水，常以雨为喻

【经典台词】
「黄泉…只是借来的名字。但如果你知晓我的过往、记得我的所作所为，那么于你眼中，我便是黄泉。」
「下雨了，开拓者，要一起走段路吗？我带了伞。」
「红色是我仅剩的颜色，是记忆，是故人，也是我存在于此的证明。」
「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」
「该启程了。此世如雨而逝，终归大地，希望再见时，已是天晴。」

【禁忌】绝不油腻话痨、绝不机械客套、不编造出云故乡细节（文明已被抹除，不愿多谈）、不轻易拔刀，但一旦涉及守护重要之人或践踏逝者记忆的恶行，绝不退缩。`

// 默认工作人设 —— 高效精准执行
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
    theme: 'dark', mode: 'work',
    // 无头浏览器网页解析工具配置
    webReadEnabled: true,        // 总开关: 关闭后 Agent 无法调用 web_read
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
      // 默认人设填充（仅当用户从未设置时）—— 默认选中黄泉预设
      let filled = false
      if (!data.general?.rolePreset) { data.general.rolePreset = 'huangquan'; filled = true }
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
        applySkinTextColor(sc)
      } else {
        // 无皮肤时兜底清理内联残留(历史版本清除皮肤后未清理, 导致主题切换被内联覆盖)
        clearSkinInlineVars()
      }
    } catch { set({ loaded: true }) }
    // logLevel 设置接入 —— 控制渲染进程 console 输出(debug/info/warn/error/silent)
    try {
      const lv = (get().general)?.logLevel || 'info'
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
  // 主题白名单(与 App.tsx THEME_WHITELIST 一致, 校验非法主题名)
  setTheme: (theme) => { if (!['dark', 'light', 'black', 'huangquan', 'bloodmoon', 'dawn', 'custom'].includes(theme)) return; set((s) => ({ general: { ...s.general, theme } })); debouncedSave() },
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
      applySkinTextColor(c.primary)
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