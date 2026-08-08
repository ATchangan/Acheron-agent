// src/store/chat-user-msg.ts —— 用户消息构建(v0.3.1 补丁 D: 从 chat-send.ts 拆出, 行为零变化)
import { v4 as uuidv4 } from 'uuid'
import type { Message } from '../global'
import { normalizeImage } from '../utils/image'
import type { S } from './chat-send'

interface BuildUserMsgDeps {
  sid: string
  get: () => S
  set: (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: boolean) => void
}

interface UserMsgResult {
  content: string
  images?: string[]
  userMsg: Message
  userMsgId: string
  tokBase: Record<string, { readTokens?: number; inputTokens?: number; writeTokens?: number; outputTokens?: number }>
  isVisualTask: boolean
  imgPathMatch: RegExpMatchArray | null
}

// 附件描述/图片路径直读/拖入图压缩/用户消息上屏/视觉任务判定
export async function buildUserMessage(deps: BuildUserMsgDeps, contentIn: string, imagesIn?: string[], attachments?: Message['attachments']): Promise<UserMsgResult> {
  const { sid, get, set } = deps
  let content = contentIn
  let images = imagesIn

  // 附件（视频/音频/文档）描述拼入消息内容，agent 可用 read_file 等工具读取
  if (attachments && attachments.length) {
    const attachLines = attachments.map(a => `- [${a.kind}] ${a.name}（${(a.size / 1024).toFixed(0)} KB，路径: ${a.path}）`)
    content = content + (content ? '\n\n' : '') + '【用户拖入的附件】\n' + attachLines.join('\n') + '\n如需查看内容，请用 read_file 等工具读取上述路径。'
  }

  // 图片路径直读 —— 消息含图片文件路径时, 主进程读为 dataURL 并入 images(支持 9 格式)
  // v0.3.1 修复: 正则要求以盘符/UNC/相对路径开头, 避免贪婪吞掉「帮我看」等中文动词前缀
  const imgPathRe = /(?:[A-Za-z]:[\\\/]|\\\\|\.{1,2}[\\\/])[\w\u4e00-\u9fa5\\\/:\.\- ]+\.(?:png|jpe?g|webp|gif|bmp|svg|avif|heic)/i
  const imgPathMatch = (content || '').match(imgPathRe)
  if (!images?.length && imgPathMatch) {
    const pathTxtA = imgPathMatch[0].trim()
    const raw = await window.huangquan.computer.readFileAsDataUrl(pathTxtA)
    if (raw && !raw.startsWith('E:')) {
      const norm = await normalizeImage(raw)
      if (norm && !norm.startsWith('E:')) images = [norm]
      else content = content + '\n\n[图片处理失败: ' + String(norm).replace(/^E:/, '') + ']'
    } else {
      content = content + '\n\n[图片读取失败: ' + String(raw).replace(/^E:/, '') + '。请确认路径正确或直接拖入图片。]'
    }
  } else if (images?.length) {
    // 拖入图统一压缩(一处覆盖全部后续分支)
    const normed = await Promise.all(images.map((im: string) => normalizeImage(im).catch(() => 'E:decode-failed')))
    const ok = normed.filter((x: string) => x && !x.startsWith('E:'))
    const failN = normed.length - ok.length
    images = ok as string[]
    if (failN > 0) content = content + (content ? '\n\n' : '') + '[' + failN + ' 张图片无法解析, 已忽略]'
  }

  // 追加用户消息到 store —— 立即上屏（不再等视觉分析，避免界面停留初始状态）
  const userMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments }
  // 本任务 token 基线(主角色 + 全部子角色 消耗都计入 sessTok, 任务结束时算增量)
  const tokBase: Record<string, { readTokens?: number; inputTokens?: number; writeTokens?: number; outputTokens?: number }> = JSON.parse(JSON.stringify(get().sessTok[sid] || {}))
  const userMsgId = userMsg.id
  set(s => {
    const session = s.sessions.find(x => x.id === sid)!
    // 会话标题自动取第一条消息（避免一直显示 "New Chat"）
  const isNewChat = !session.title || session.title === '新对话' || session.title === 'New Chat' || session.title === 'Chat'
    const title = isNewChat ? content.replace(/\s+/g, ' ').trim().slice(0, 24) + (content.trim().length > 24 ? '…' : '') : session.title
    return { sessions: s.sessions.map(x => x.id === sid ? { ...session, title, messages: [...session.messages, userMsg] } : x), streaming: s.cid === sid ? true : s.streaming, executing: s.cid === sid ? true : s.executing, error: null }
  })

  // 视觉任务判定(收紧) —— 发图/路径/明确看图表述; 无图无路径的宽正则命中 → 不切模型并提示
  let isVisualTask = !!(images && images.length) || !!imgPathMatch
    || /(看(一?下|看)?.*(图|照片|截图)|(图|照片|截图).*(什么|内容|识别|分析|描述|里(有|是)什么)|识别.*(图|照片|截图)|视觉理解|图片里|图像里|这张图|这张照片|这个截图)/i.test(content)
  // 兜底: 正则命中但 无图 且 无路径 → 不切模型, 提示发图(零 LLM 请求)
  if (isVisualTask && !images?.length && !imgPathMatch) {
    content = content + '\n\n[未检测到图片。如需看图, 请直接拖入图片或提供图片路径。]'
    isVisualTask = false
  }
  return { content, images, userMsg, userMsgId, tokBase, isVisualTask, imgPathMatch }
}
