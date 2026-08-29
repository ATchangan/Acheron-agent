// MessagesPage.tsx —— v0.4.4 消息平台（对齐参考: 左渠道列表 + 右配置面板 + 底部启用/保存条）
// 已接入: QQ 官方机器人（q.qq.com，WebSocket 网关 + 被动回复，桥接见 store/msg-client.ts）。
// 其余渠道在列表中展示但标记「未接入」，配置面板给出说明 —— 与 Reference 的渠道结构一致。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'

interface MsgConfig { enabled: boolean; appId: string; appSecret: string; sandbox: boolean; groupEnabled: boolean; c2cEnabled: boolean }
const DEFAULTS: MsgConfig = { enabled: false, appId: '', appSecret: '', sandbox: false, groupEnabled: true, c2cEnabled: true }

type Channel = { id: string; name: string; color: string; implemented: boolean; desc: string; badge?: string }
// 渠道全集与 Reference 消息平台一致（顺序亦同）；当前版本仅 QQ Bot 已接入，其余到货即填
const CHANNELS: Channel[] = [
  { id: 'qq', name: 'QQ Bot', color: '#e0526e', implemented: true, desc: '通过 QQ 官方机器人（q.qq.com 开放平台）在 QQ 私聊与群聊中使用助手。' },
  { id: 'wechat', name: 'Weixin / WeChat (微信)', color: '#4fae7e', implemented: false, desc: '个人微信没有官方机器人接口，第三方路线均有封号风险；按「先只做 QQ」的决策暂缓，暂不接入其他渠道。' },
]

const norm = (s: string): string => s.toLowerCase()
export default function MessagesPage() {
  const [cfg, setCfg] = useState<MsgConfig>(DEFAULTS)
  const [state, setState] = useState<{ state: string; detail?: string }>({ state: 'off' })
  const [dirty, setDirty] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selId, setSel] = useState('qq')
  const [q, setQ] = useState('')

  const refresh = useCallback(async () => {
    try {
      const r = await window.huangquan.msg.getConfig()
      setCfg({ ...DEFAULTS, ...r.config })
      setState({ state: r.state, detail: r.detail })
      setDirty(false)
    } catch { /* 忽略 */ }
    setLoading(false)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const sel = CHANNELS.find(c => c.id === selId) || CHANNELS.find(c => c.id === 'qq')!
  const filtered = useMemo(() => CHANNELS.filter(c => !q.trim() || norm(c.name).includes(norm(q.trim()))), [q])

  const patch = (p: Partial<MsgConfig>) => { setCfg(c => ({ ...c, ...p })); setDirty(true) }
  const save = async (extra?: Partial<MsgConfig>) => {
    await window.huangquan.msg.setConfig({ ...cfg, ...extra })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
    setTimeout(() => { void refresh() }, 600)
  }

  const stateDot = (id: string): { color: string; title: string } => {
    if (id !== 'qq') return { color: 'var(--text-muted)', title: '未接入' }
    switch (state.state) {
      case 'connected': return { color: 'var(--success)', title: '已连接' }
      case 'connecting': return { color: 'var(--warning)', title: '连接中' }
      case 'error': return { color: 'var(--danger)', title: '连接异常' }
      default: return { color: 'var(--text-muted)', title: '未启用' }
    }
  }

  const inputStyle = { height: 34, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '0 10px', outline: 'none', width: '100%', boxSizing: 'border-box' } as const

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* 左栏: 渠道列表（可搜索） */}
      <div style={{ width: 228, flex: 'none', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', padding: '14px 10px 10px' }}>
        <div className="hq-sb-search" style={{ marginBottom: 10 }}>
          <Search size={13} />
          <input className="hq-search" placeholder="搜索消息平台…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map(c => {
            const dot = stateDot(c.id)
            return (
              <button key={c.id} type="button" className={'sb-menu-item' + (selId === c.id ? ' active' : '')} onClick={() => setSel(c.id)}>
                <span className="sb-ch-icon" style={{ background: c.color }}>{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="sm-label">{c.name}</span>
                <span className="sb-ch-dot" title={dot.title} style={{ background: dot.color }} />
              </button>
            )
          })}
        </div>
      </div>

      {/* 右栏: 选中渠道配置 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span className="sb-ch-icon" style={{ background: sel.color, width: 26, height: 26, fontSize: 13 }}>{sel.name.slice(0, 1).toUpperCase()}</span>
            <span style={{ fontSize: 'calc(var(--ui-font-size) + 4px)', fontWeight: 650, color: 'var(--text-primary)' }}>{sel.name}</span>
            {(() => {
              const chips: { text: string; color: string }[] = []
              if (!cfg.enabled) chips.push({ text: '已禁用', color: 'var(--text-muted)' })
              if (!cfg.appId || !cfg.appSecret) chips.push({ text: '需要设置', color: 'var(--warning)' })
              if (cfg.enabled && state.state !== 'connected') chips.push({ text: '消息网关未运行', color: 'var(--danger)' })
              return chips.map(c2 => <span key={c2.text} className="aux-row-badge" style={{ color: c2.color }}>{c2.text}</span>)
            })()}
            {!sel.implemented && <span className="aux-row-badge">未接入</span>}
          </div>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', marginBottom: 16 }}>{sel.desc}</div>

          {sel.id === 'qq' && (loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 1px)' }}>加载中…</div>
          ) : (
            <>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.7 }}>
                在 <b style={{ color: 'var(--text-secondary)' }}>q.qq.com</b> 创建机器人（选择「机器人」类型，开通群聊/单聊消息权限），把 AppID 和 AppSecret 填到下面。
                官方接口只能<strong style={{ color: 'var(--warning)' }}>被动回复</strong>：用户先 @机器人（群聊）或发私聊消息，助手才会回应。
                {state.state === 'error' && state.detail && <><br /><span style={{ color: 'var(--danger)' }}>{state.detail}</span></>}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>AppID <span style={{ color: 'var(--danger)' }}>必填</span></div>
                <input style={inputStyle} value={cfg.appId} placeholder="q.qq.com 机器人的 AppID" onChange={e => patch({ appId: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>AppSecret <span style={{ color: 'var(--danger)' }}>必填</span></div>
                <input style={{ ...inputStyle, fontFamily: 'JetBrains Mono, Consolas, monospace' }} type="password" value={cfg.appSecret} placeholder="机器人的 AppSecret" onChange={e => patch({ appSecret: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>沙箱环境</div>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)', marginBottom: 8 }}>先在 q.qq.com 沙箱测试（只有指定测试频道/用户能触发），通了再切正式环境</div>
                <button type="button" className={'hq-btn' + (cfg.sandbox ? '' : ' hq-btn-accent')} style={{ height: 30, padding: '0 16px' }} onClick={() => patch({ sandbox: !cfg.sandbox })}>{cfg.sandbox ? '当前：沙箱' : '当前：正式环境'}</button>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>响应范围</div>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)', marginBottom: 8 }}>群聊消息需要 @机器人；单聊直接发消息即可</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className={'hq-btn' + (cfg.groupEnabled ? ' hq-btn-accent' : '')} style={{ height: 30, padding: '0 14px' }} onClick={() => patch({ groupEnabled: !cfg.groupEnabled })}>群聊 {cfg.groupEnabled ? '开' : '关'}</button>
                  <button type="button" className={'hq-btn' + (cfg.c2cEnabled ? ' hq-btn-accent' : '')} style={{ height: 30, padding: '0 14px' }} onClick={() => patch({ c2cEnabled: !cfg.c2cEnabled })}>单聊 {cfg.c2cEnabled ? '开' : '关'}</button>
                </div>
              </div>
            </>
          ))}

          {!sel.implemented && (
            <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border)', borderRadius: 10, padding: '14px 16px', fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              该渠道尚未接入。当前版本按规划优先做了 QQ 官方机器人；其余渠道会陆续补充——列表先放这里方便你看结构。
            </div>
          )}
        </div>

        {/* 底部条: 启用开关 + 保存更改（对齐参考） */}
        {sel.id === 'qq' && (
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px 14px' }}>
            <button type="button" className={'hq-btn' + (cfg.enabled ? ' hq-btn-accent' : '')} style={{ height: 32, padding: '0 18px' }} onClick={() => { void save({ enabled: !cfg.enabled }) }}>
              {cfg.enabled ? '已启用' : '启用'}
            </button>
            <span style={{ flex: 1 }} />
            {savedFlash && <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--success)' }}>已保存</span>}
            <button type="button" className="hq-btn hq-btn-accent" disabled={!dirty} style={{ height: 32, padding: '0 18px', opacity: dirty ? 1 : .45, cursor: dirty ? 'pointer' : 'default' }} onClick={() => { void save() }}>
              <RefreshCw size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />保存更改
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
