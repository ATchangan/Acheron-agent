// src/store/slash.ts —— 统一斜杠命令体系(v0.4.5)
// composer 内输入 / 触发补全, Enter 执行; 命令分两类:
//   local: 渲染层直接完成(新建/停止/改标题/查看信息)
//   prompt: 转成提示词走标准 send 流程(压缩/日记/流程提取)
import { useChatStore } from './chat'
import { useSettingsStore } from './settings'

export interface SlashDef {
  cmd: string
  argsHint?: string
  desc: string
  kind: 'local' | 'prompt'
}

export const SLASH_DEFS: SlashDef[] = [
  { cmd: '/new', desc: '新建会话', kind: 'local' },
  { cmd: '/retry', desc: '重新生成上一条回复', kind: 'local' },
  { cmd: '/stop', desc: '停止当前任务', kind: 'local' },
  { cmd: '/title', argsHint: '<标题>', desc: '设置当前会话标题', kind: 'local' },
  { cmd: '/usage', desc: '查看上下文用量', kind: 'local' },
  { cmd: '/sessions', desc: '查看全部会话', kind: 'local' },
  { cmd: '/model', desc: '查看当前模型', kind: 'local' },
  { cmd: '/skills', desc: '查看已注册技能', kind: 'local' },
  { cmd: '/help', desc: '列出全部命令', kind: 'local' },
  { cmd: '/compact', desc: '精简压缩对话历史', kind: 'prompt' },
  { cmd: '/diary', desc: '将本次对话整理为日记', kind: 'prompt' },
  { cmd: '/xing', desc: '从对话提取可复用流程', kind: 'prompt' },
]

export function slashCompletions(query: string): SlashDef[] {
  const q = query.toLowerCase()
  return SLASH_DEFS.filter(d => d.cmd.startsWith('/' + q))
}

function fmtUsage(): string {
  const st = useChatStore.getState()
  const used = st.cl
  const ctx = st.cu
  return '上下文用量: ' + Math.round(ctx / 1000) + 'k / ' + Math.round(used / 1000) + 'k tokens'
}

/** 执行斜杠命令; 返回 true=已处理(调用方不再走 send) */
export function execSlash(raw: string): boolean {
  const t = raw.trim()
  if (!t.startsWith('/')) return false
  const sp = t.indexOf(' ')
  const cmd = (sp < 0 ? t : t.slice(0, sp)).toLowerCase()
  const arg = sp < 0 ? '' : t.slice(sp + 1).trim()
  const st = useChatStore.getState()

  switch (cmd) {
    case '/new':
      st.create()
      return true
    case '/retry':
      void st.regen()
      return true
    case '/stop':
      st.stop()
      return true
    case '/title': {
      const title = arg || '新对话'
      useChatStore.setState(s => ({
        sessions: s.sessions.map(x => (x.id === s.cid ? { ...x, title } : x)),
      }))
      const cur = st.cur()
      if (cur) void window.huangquan.sessions.save({ ...cur, title }).catch(() => {})
      return true
    }
    case '/usage':
      window.alert(fmtUsage())
      return true
    case '/sessions': {
      const lines = st.sessions.slice(0, 15).map((s, i) => (i + 1) + '. ' + s.title + (s.busy ? '（执行中）' : ''))
      window.alert('会话共 ' + st.sessions.length + ' 个:\n' + lines.join('\n'))
      return true
    }
    case '/model':
      window.alert('当前模型: ' + (useSettingsStore.getState().general.mainModel || st.curModel || '默认'))
      return true
    case '/skills': {
      void window.huangquan.skills.list().then(list => {
        window.alert('已注册技能 ' + list.length + ' 个:\n' + list.map(s => '· ' + s.name + (s.builtin ? '（内置）' : '')).join('\n'))
      }).catch(() => window.alert('技能列表获取失败'))
      return true
    }
    case '/help':
      window.alert('命令列表:\n' + SLASH_DEFS.map(d => d.cmd + (d.argsHint ? ' ' + d.argsHint : '') + ' — ' + d.desc).join('\n'))
      return true
    case '/compact':
      void st.send('请精简压缩本次对话历史。')
      return true
    case '/diary':
      void st.send('请将本次对话整理为一篇日记。')
      return true
    case '/xing':
      void st.send('请从本次对话中提取可复用的流程。')
      return true
    default:
      return false
  }
}
