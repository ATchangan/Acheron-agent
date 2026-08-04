import React from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle, StepSetting } from '../settings-ui'

// v0.3.1 块 H: 策略 tab(从 SettingsView 拆分, 行为零变化)
export default function StrategyTab() {
  const g = useSettingsStore(s => s.general) || {}
  const providers = useSettingsStore(s => s.providers || [])
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const modelOpts = providers.flatMap(pr => (pr.models || []).map(m => ({ id: pr.id + '::' + m, label: pr.name + ' · ' + m })))
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>多模型策略</div>
        <div style={S.hint}>统一调度各能力模型：文字对话、视觉理解、图片生成、视频生成、语音识别，全部联动下方已配置的供应商</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: C.accent, margin: '10px 0 6px' }}>文字模型（联动供应商）</div>
        <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>主对话模型</div><div style={S.hint}>由聊天输入框右侧模型选择器指定（选择即生效），此处不再单独设置</div></div>
        <div style={S.row}><div style={S.label}>长文本模型</div><select style={S.sel} value={g.longTextModel || ''} onChange={e => save({ longTextModel: e.target.value })}><option value="">跟随主模型</option>{modelOpts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>文档分析 / 长上下文任务</div></div>
        <div style={S.row}><div style={S.label}>代码模型</div><select style={S.sel} value={g.codeModel || ''} onChange={e => save({ codeModel: e.target.value })}><option value="">跟随主模型</option>{modelOpts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>代码生成 / 审查</div></div>
        <div style={S.row}><div style={S.label}>快速响应模型</div><select style={S.sel} value={g.fastModel || ''} onChange={e => save({ fastModel: e.target.value })}><option value="">跟随主模型</option>{modelOpts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>简单任务 / 工具调度</div></div>
        <Toggle checked={g.autoFastModel !== false} onChange={v => save({ autoFastModel: v })} label="简单任务自动使用快速模型" hint="Token < 2000 且 工具调用 ≤ 2 次时切换" />
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: C.accent, margin: '16px 0 6px' }}>调度绑定（所有模型公用，含自定义）</div>
        <div style={S.row}><div style={S.label}>小模型</div><select style={S.sel} value={g.smallModel || ''} onChange={e => save({ smallModel: e.target.value })}><option value="">跟随主模型</option>{modelOpts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>轻量任务（简单问答 / 单步工具）</div></div>
        <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>大模型</div><select style={S.sel} value={g.largeModel || ''} onChange={e => save({ largeModel: e.target.value })}><option value="">跟随主模型</option>{modelOpts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>复杂任务（多步骤 / 代码 / 文档）</div></div>
      </div>
      <div style={S.card}>
        <div style={S.section}>视觉理解（联动供应商）</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginBottom: 8 }}>勾选要用的视觉辅助模型（<b style={{ color: C.text }}>顺序即优先级</b>）：优先尝试排在前面的，连不通自动切换下一个，全部失败会提示原因</div>
        {(() => {
          const visCands: { id: string; label: string; pname: string; mname: string; keyed: boolean }[] = []
          const pushFrom = (pname: string, models: string[], keyed: boolean) => {
            // 能力校验 —— 区分 识图多模态/绘图模型/纯文本; 绘图模型(seedream/dall/flux/sdxl/cogview 等)禁止进入视觉理解列表
            const hits = (models || []).filter((m: string) => {
              const ml = m.toLowerCase()
              if (/(dall|flux|sdxl|stable-diffusion|seedream|cogview|imagen|midjourney|\bmj\b|draw|文生图|图片生成|image-gen|text2img|video-gen|sora|kling|runway|pika|veo)/.test(ml)) return false
              return /gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|qwen2-vl|glm-4v|llava|yi-vision|internvl|deepseek-vl|step-1v|moonshot-v1|minimax-vl|识图|多模态/i.test(ml)
            })
            hits.forEach((m: string) => { const id = pname + '::' + m; if (!visCands.some(c => c.id === id)) visCands.push({ id, label: pname + ' · ' + m, pname, mname: m, keyed }) })
          }
          providers.forEach(pr => pushFrom(pr.name, pr.models || [], !!pr.apiKey))
          mediaProviders.forEach(mp => pushFrom(mp.name, [...(mp.imgModels || []), ...(mp.videoModels || []), ...(mp.audioModels || [])], !!mp.apiKey))
          providers.forEach(pr => { if (pr.apiKey && (pr.models || []).length && !visCands.some(c => c.pname === pr.name)) visCands.push({ id: pr.name + '::' + (pr.models || [])[0], label: pr.name + ' · ' + (pr.models || [])[0] + '（自动）', pname: pr.name, mname: (pr.models || [])[0], keyed: true }) })
          const curList: string[] = Array.isArray(g.visionModels) ? [...g.visionModels] : (g.visionModel ? [g.visionModel] : [])
          const toggleVis = (id: string) => {
            const next = curList.includes(id) ? curList.filter(x => x !== id) : [...curList, id]
            save({ visionModels: next, visionModel: next.length ? next[0] : '' })
          }
          const moveVis = (id: string, dir: -1 | 1) => {
            const i = curList.indexOf(id)
            if (i < 0) return
            const j = i + dir
            if (j < 0 || j >= curList.length) return
            const next = [...curList]
            ;[next[i], next[j]] = [next[j], next[i]]
            save({ visionModels: next, visionModel: next[0] })
          }
          return (
            <div style={{ border: '1px solid ' + C.border, borderRadius: 8, padding: '6px 8px', maxHeight: 180, overflowY: 'auto', background: C.input }}>
              {visCands.length === 0 && <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: 6 }}>暂无已配置的视觉模型候选（请先在供应商中填入 API Key 并读取模型）</div>}
              {visCands.map(c => {
                const idx = curList.indexOf(c.id)
                const on = idx >= 0
                const alive = providers.some(pr => pr.name === c.pname && (pr.models || []).includes(c.mname)) || mediaProviders.some(mp => mp.name === c.pname && [...(mp.imgModels || []), ...(mp.videoModels || []), ...(mp.audioModels || [])].includes(c.mname))
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', fontSize: 'calc(var(--ui-font-size) - 2px)', color: on ? C.text : C.label }}>
                    <input type="checkbox" checked={on} onChange={() => toggleVis(c.id)} style={{ accentColor: C.accent }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on && <b style={{ color: C.accent }}>#{idx + 1}</b>} {c.label}{!alive && <span style={{ color: 'var(--danger)' }}>（已失效）</span>}{!c.keyed && <span style={{ color: 'var(--warning)' }}>（未填Key）</span>}</span>
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button style={{ ...S.btn('ghost'), height: 20, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => moveVis(c.id, -1)} disabled={!on || idx === 0}>↑</button>
                      <button style={{ ...S.btn('ghost'), height: 20, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={() => moveVis(c.id, 1)} disabled={!on || idx === curList.length - 1}>↓</button>
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })()}
        <Toggle checked={g.visionAutoSwitch !== false} onChange={v => save({ visionAutoSwitch: v })} label="自动切换" hint="视觉任务时自动切到视觉模型，完成后恢复原模型" />
      </div>
      <div style={S.card}>
        <div style={S.section}>图片生成（联动供应商）</div>
        <div style={S.row}><div style={S.label}>默认平台</div><select style={S.sel} value={g.mediaImgProvider || ''} onChange={e => save({ mediaImgProvider: e.target.value })}><option value="">自动探测</option>{mediaProviders.filter(mp2 => (mp2.imgModels || []).length).map(mp2 => <option key={mp2.id} value={mp2.id}>{mp2.name}</option>)}</select><div style={S.hint}>选择供应商中的图片生成平台</div></div>
        <div style={S.row}><div style={S.label}>默认模型</div><select style={S.sel} value={g.mediaImgModel || ''} onChange={e => save({ mediaImgModel: e.target.value })}><option value="">跟随平台默认</option>{mediaProviders.filter(mp2 => (mp2.imgModels || []).length).flatMap(mp2 => (mp2.imgModels || []).map(m => ({ id: mp2.id + '::' + m, label: mp2.name + ' · ' + m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        <div style={S.row}><div style={S.label}>默认模式</div><select style={S.sel} value={g.mediaImgMode || 'text2image'} onChange={e => save({ mediaImgMode: e.target.value })}><option value="text2image">文生图 text2image</option><option value="image2image">图生图 image2image</option></select></div>
        <div style={S.row}><div style={S.label}>默认比例</div><select style={S.sel} value={g.mediaImgRatio || '1:1'} onChange={e => save({ mediaImgRatio: e.target.value })}>{[['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['2:3', '2:3'], ['21:9', '21:9']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div style={S.row}><div style={S.label}>默认并发</div><input type="number" style={S.num} min={1} max={9} value={g.mediaImgConcurrency || 1} onChange={e => save({ mediaImgConcurrency: parseInt(e.target.value) || 1 })} /><span style={S.hint}>一次生成张数（1~9）</span></div>
        <Toggle checked={g.autoMediaImg !== false} onChange={v => save({ autoMediaImg: v })} label="自动生图" hint="对话中遇到「画/生成一张图片」等需求时自动调用生成工具(关闭后仅用户明确要求才生成)" />
      </div>
      <div style={S.card}>
        <div style={S.section}>视频生成（联动供应商）</div>
        <div style={S.row}><div style={S.label}>默认平台</div><select style={S.sel} value={g.mediaVideoProvider || ''} onChange={e => save({ mediaVideoProvider: e.target.value })}><option value="">自动探测</option>{mediaProviders.filter(mp2 => (mp2.videoModels || []).length).map(mp2 => <option key={mp2.id} value={mp2.id}>{mp2.name}</option>)}</select></div>
        <div style={S.row}><div style={S.label}>默认模型</div><select style={S.sel} value={g.mediaVideoModel || ''} onChange={e => save({ mediaVideoModel: e.target.value })}><option value="">跟随平台默认</option>{mediaProviders.filter(mp2 => (mp2.videoModels || []).length).flatMap(mp2 => (mp2.videoModels || []).map(m => ({ id: mp2.id + '::' + m, label: mp2.name + ' · ' + m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        <div style={S.row}><div style={S.label}>默认模式</div><select style={S.sel} value={g.mediaVideoMode || 'text2video'} onChange={e => save({ mediaVideoMode: e.target.value })}><option value="text2video">文生视频 text2video</option><option value="image2video">图生视频 image2video</option></select></div>
        <StepSetting label="默认时长" hint="视频生成默认时长" value={g.mediaVideoDuration || 5} min={4} max={15} unit=" 秒" onChange={v => save({ mediaVideoDuration: v })} />
        <Toggle checked={g.autoMediaVideo !== false} onChange={v => save({ autoMediaVideo: v })} label="自动生视频" hint="对话中遇到「生成/制作一个视频」等需求时自动调用生成工具(关闭后仅用户明确要求才生成)" />
      </div>
      <div style={S.card}>
        <div style={S.section}>语音识别 / 合成（联动供应商）</div>
        <div style={S.row}><div style={S.label}>默认平台</div><select style={S.sel} value={g.mediaAudioProvider || ''} onChange={e => save({ mediaAudioProvider: e.target.value })}><option value="">自动探测</option>{mediaProviders.filter(mp2 => (mp2.audioModels || []).length).map(mp2 => <option key={mp2.id} value={mp2.id}>{mp2.name}</option>)}</select></div>
        <div style={S.row}><div style={S.label}>默认模型</div><select style={S.sel} value={g.mediaAudioModel || ''} onChange={e => save({ mediaAudioModel: e.target.value })}><option value="">跟随平台默认</option>{mediaProviders.filter(mp2 => (mp2.audioModels || []).length).flatMap(mp2 => (mp2.audioModels || []).map(m => ({ id: mp2.id + '::' + m, label: mp2.name + ' · ' + m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        <Toggle checked={g.ttsEnabled !== false} onChange={v => save({ ttsEnabled: v })} label="启用语音合成 (TTS)" />
      </div>
    </div>
  )
}
