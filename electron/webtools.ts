/**
 * webtools.ts — 无头浏览器网页解析工具模块 ()
 * 基于 Playwright-core + 系统 Edge/Chrome 内核, 按需临时启动, 用完即销毁。
 * 不长期驻留内存; 与现有 browse/browse_screenshot(Electron 内置窗口) 完全独立。
 */
import { existsSync } from 'fs'

// ─── 类型 ───────────────────────────────────────────
export interface WebReadOpts {
  url: string
  mode?: 'text' | 'screenshot' | 'pdf'
  headless?: boolean
  timeoutMs?: number
  userAgent?: string
  proxy?: string
  ignoreHTTPSErrors?: boolean
  cleanAds?: boolean
  autoClose?: boolean
  cookies?: string                       // cookie 注入: JSON 数组或 "k=v; k2=v2" 字符串
}

export interface WebReadResult {
  ok: boolean
  url?: string
  title?: string
  text?: string
  screenshotBase64?: string
  pdfBase64?: string
  error?: string
  advice?: string
}

// ─── 浏览器内核探测 ────────────────────────────────
function findExecutablePath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  for (const c of candidates) { if (c && existsSync(c)) return c }
  return undefined
}

const UA_DEFAULT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// ─── 正文/标题提取(页面内执行, 清洗冗余) ──────────
// 直接传函数引用给 page.evaluate(playwright 自动序列化), 避免字符串转义问题
function extractPage(): { title: string; text: string } {
  try {
    const killSel = ['script','style','noscript','iframe','template','nav','footer','aside',
      '.ad','.ads','.advertisement','.advert','.banner','.popup','.modal','.cookie','.cookie-banner',
      '#ad','.adsbygoogle','[class*="ad-"]','[id*="ad-"]','[class*="advert"]','.share','.social','.related','.recommend']
    document.querySelectorAll(killSel.join(',')).forEach(function(e){ try { e.remove() } catch(_){} })
    document.querySelectorAll('div,section,span').forEach(function(e){
      const t=((e as HTMLElement).innerText||'').trim()
      if(t && t.length < 6 && e.querySelectorAll('a').length === 0) { try { e.remove() } catch(_){} }
      if(e.children.length === 0 && !t) { try { e.remove() } catch(_){} }
    })
    const title = document.title ? document.title.trim() : ''
    const main = document.querySelector('article') || document.querySelector('main')
      || document.querySelector('[role="main"]') || document.querySelector('.article') || document.body
    let text = (main ? main.innerText : document.body.innerText) || ''
    text = text.replace(new RegExp('[\t\r]+', 'g'), '').replace(new RegExp('\n{3,}', 'g'), '\n\n').trim()
    if (text.length > 80000) text = text.slice(0, 80000)
    return { title: title, text: text }
  } catch (e: unknown) {
    return { title: '', text: 'extract-error: ' + String(e && (e instanceof Error ? e.message : String(e)) || e) }
  }
}

// ─── 核心: 按需启动浏览器 → 读取 → 销毁 ────────────
export async function webRead(rawOpts: WebReadOpts): Promise<WebReadResult> {
  const opts: WebReadOpts = {
    mode: 'text', headless: true, timeoutMs: 15000, cleanAds: true, autoClose: true, ignoreHTTPSErrors: true,
    ...rawOpts,
  }
  const url = (opts.url || '').trim()
  if (!url) return { ok: false, error: '未提供网页 URL', advice: '请传入需要解析的网页地址, 例如 web_read("https://example.com")' }
  let httpUrl = url
  if (!/^https?:\/\//i.test(httpUrl)) httpUrl = 'https://' + httpUrl

  let chromium = null
  try {
    chromium = require('playwright-core').chromium
  } catch (e: unknown) {
    return { ok: false, error: 'Playwright 内核未安装: ' + ((e instanceof Error ? e.message : String(e))), advice: '请执行 npm install playwright-core' }
  }

  const exe = findExecutablePath()
  if (!exe) {
    return { ok: false, error: '未找到可用的 Chromium 内核 (Edge/Chrome)', advice: '请安装 Microsoft Edge 或 Google Chrome 后重试' }
  }

  let browser = null
  try {
    const launchOpts: Record<string, unknown> = {
      executablePath: exe,
      headless: !!opts.headless,
      ignoreHTTPSErrors: !!opts.ignoreHTTPSErrors,
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--disable-default-apps'],
    }
    if (opts.proxy && opts.proxy.trim()) launchOpts.proxy = { server: opts.proxy.trim() }

    browser = await chromium.launch(launchOpts)
    const ctx = await browser.newContext({
      userAgent: (opts.userAgent && opts.userAgent.trim()) || UA_DEFAULT,
      viewport: { width: 1280, height: 900 },
      locale: 'zh-CN',
    })
    const page = await ctx.newPage()

    // cookie 注入(支持 JSON 数组格式 或 "name=value; name2=value2" 字符串格式)
    if (opts.cookies && opts.cookies.trim()) {
      try {
        const rawCookies = opts.cookies.trim()
        let cookieList: { name: string; value: string; domain?: string; path?: string; url?: string }[] = []
        if (rawCookies.startsWith('[')) {
          cookieList = JSON.parse(rawCookies)
        } else {
          // 解析 "k=v; k2=v2" 格式
          rawCookies.split(';').forEach(function (pair: string) {
            const idx = pair.indexOf('=')
            if (idx > 0) {
              cookieList.push({ name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() })
            }
          })
        }
        // 补齐 domain/path/url
        let host: string
        try { host = new URL(httpUrl).hostname } catch { host = 'localhost' }
        const normalized = cookieList.map(function (c: { name: string; value: string; domain?: string; path?: string; url?: string }) {
          const out: { name: string; value: string; path: string; domain?: string; url?: string } = { name: c.name, value: c.value, path: c.path || '/', domain: c.domain || host, url: c.url }
          if (c.url) { delete out.domain }
          return out
        })
        await ctx.addCookies(normalized)
      } catch (e) { /* cookie 解析失败则忽略, 不影响主流程 */ console.debug('[swallow]', e) }
    }

    let navError: string | null = null
    try {
      await page.goto(httpUrl, { waitUntil: 'networkidle', timeout: opts.timeoutMs })
    } catch (_e: unknown) {
      try {
        await page.goto(httpUrl, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs })
        navError = null
      } catch (e2: unknown) {
        navError = String(e2 instanceof Error ? e2.message : e2)
      }
    }
    await page.waitForTimeout(800)

    const finalUrl = page.url()
    if (navError) {
      const advice = /timeout|Timeout/i.test(navError)
        ? '页面加载超时, 可尝试: ① 在设置中调大"页面加载超时时间"; ② 配置代理; ③ 确认网址可访问'
        : /ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(navError)
          ? '域名无法解析, 请检查网址拼写或网络/DNS'
          : /ERR_CERT/i.test(navError)
            ? '证书校验失败, 已开启跳过证书校验仍失败, 可能是网络中间人环境'
            : /404|ERR_ABORTED/i.test(navError)
              ? '页面返回 404 或资源中断, 确认链接是否有效'
              : '反爬拦截或未知错误, 可尝试更换 UA 或配置代理后重试'
      return { ok: false, url: finalUrl, error: '加载失败: ' + navError.slice(0, 300), advice }
    }

    const mode = opts.mode || 'text'
    const out: WebReadResult = { ok: true, url: finalUrl }

    if (mode === 'text') {
      const ex = await page.evaluate(extractPage).catch((e: unknown) => ({ title: '', text: 'evaluate-error: ' + (e instanceof Error ? e.message : String(e)) }))
      out.title = ex.title || ''
      out.text = (ex.text || '')
      if (!ex.text || ex.text.startsWith('extract-error') || ex.text.startsWith('evaluate-error')) {
        out.ok = false
        out.error = '正文提取失败: ' + ex.text.slice(0, 200)
        out.advice = '页面可能依赖特殊渲染或为纯 JS 应用, 可尝试 mode="screenshot" 截图查看'
      }
    } else if (mode === 'screenshot') {
      const shot = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 }).catch(() => null)
      if (shot) out.screenshotBase64 = 'data:image/jpeg;base64,' + shot.toString('base64')
      else { out.ok = false; out.error = '截图失败'; out.advice = '页面可能过大或渲染异常' }
      const ex = await page.evaluate(extractPage).catch(() => ({ title: '', text: '' }))
      out.title = ex.title || ''
    } else if (mode === 'pdf') {
      if (!opts.headless) {
        out.ok = false; out.error = 'PDF 导出仅在无头模式下可用'; out.advice = '请在设置中勾选"强制无头模式运行"后重试'
      } else {
        const pdf = await page.pdf({ format: 'A4', printBackground: true }).catch(() => null)
        if (pdf) out.pdfBase64 = pdf.toString('base64')
        else { out.ok = false; out.error = 'PDF 导出失败'; out.advice = '页面可能阻止打印或内核不支持' }
      }
    }

    if (opts.autoClose !== false) {
      await ctx.close().catch(() => {})
      await browser.close().catch(() => {})
      browser = null
    }
    return out
  } catch (e: unknown) {
    const msg = (e instanceof Error ? e.message : String(e))
    return {
      ok: false,
      error: 'web_read 异常: ' + msg.slice(0, 300),
      advice: '请检查: ① 浏览器内核是否被占用; ② 代理配置是否正确; ③ 稍后重试',
    }
  } finally {
    if (browser) { try { await browser.close() } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
  }
}

// 供调试用的快速自检
export async function selfTest(url = 'https://example.com'): Promise<WebReadResult> {
  return webRead({ url, mode: 'text', headless: true, timeoutMs: 15000, cleanAds: true, autoClose: true })
}
