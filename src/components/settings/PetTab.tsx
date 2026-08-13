import React from 'react'
import { useSettingsStore } from '../../store/settings'
import { S, Toggle, StepSetting } from '../settings-ui'
import { U } from '../ui-styles'

// v0.4.0: 桌宠(式神伴身)独立设置页 —— 从「外观」拆出, 大部分参数可自由调节并实时生效
export default function PetTab() {
  const g = useSettingsStore(s => s.general) || {}
  const pet = g.pet || {}

  const save = (patch: Record<string, unknown>) => {
    useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), pet: { ...((s2.general || {}).pet || {}), ...patch } } }))
    setTimeout(() => useSettingsStore.getState().save(), 150)
  }

  const petPatch = (patch: Record<string, unknown>) => {
    save(patch)
    void window.huangquan?.pet?.setOptions?.(patch)
  }

  const sel: React.CSSProperties = {
    ...S.sel, minWidth: 180,
  }
  const fpsUnlimited = (pet.fps ?? 60) === 0
  const fpsValue = fpsUnlimited ? 60 : Math.max(30, Math.min(144, pet.fps || 60))

  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>桌宠（式神伴身）</div>
        <div style={S.hint}>桌面常驻式神角色：任务状态动画联动、定时任务气泡提醒、单击直接对话。关闭后立即销毁，不留后台进程。所有参数改动实时生效，无需重启。</div>
        <Toggle checked={pet.enabled === true} onChange={v => { save({ enabled: v }); void window.huangquan?.pet?.toggle?.(v) }} label="启用桌宠" hint="在桌面显示透明置顶小窗（不抢焦点）" />
        <div style={{ ...S.row, marginTop: 8 }}>
          <div style={S.label}>角色形象</div>
          <select style={sel} value={pet.agent || '黄泉'} onChange={e => save({ agent: e.target.value })}>
            {['黄泉', '姬子', '三月七', '银狼', '艾丝妲', '知更鸟', '黑天鹅', '螺丝咕姆'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={S.row}>
          <div style={S.label}>黄泉形态</div>
          <select style={sel} value={pet.form || 'normal'} onChange={e => { const v = e.target.value as 'normal' | 'ultimate'; save({ form: v }); void window.huangquan?.pet?.setForm?.(v) }}>
            <option value="normal">正常</option>
            <option value="ultimate">大招（白发）</option>
          </select>
        </div>
        <div style={S.row}>
          <div style={S.label}>黄泉动作</div>
          <select style={sel} value={pet.action || 'idle'} onChange={e => { const v = e.target.value as 'idle' | 'dance1' | 'dance2' | 'dance3'; save({ action: v }); void window.huangquan?.pet?.setAction?.(v) }}>
            <option value="idle">待机（呼吸/张望/小动作）</option>
            <option value="dance1">极乐净土</option>
            <option value="dance2">彩虹节拍</option>
            <option value="dance3">Good Time</option>
          </select>
        </div>
        <div style={S.row}>
          <div style={S.label}>模型格式</div>
          <select style={sel} value={pet.modelFormat || 'vrm'} onChange={e => petPatch({ modelFormat: e.target.value as 'vrm' | 'pmx' })}>
            <option value="vrm">VRM（弹簧骨自然摆动）</option>
            <option value="pmx">PMX（支持 MMD 舞蹈）</option>
          </select>
        </div>
        <div style={S.hint}>VRM 不支持 MMD 舞蹈动作；想跳舞时切回 PMX，其余功能两者一致。</div>
        <div style={S.row}>
          <div style={S.label}>位置锚定</div>
          <select style={sel} value={pet.anchor || 'float'} onChange={e => { const v = e.target.value as 'float' | 'window' | 'taskbar'; save({ anchor: v }); void window.huangquan?.pet?.setAnchor?.(v) }}>
            <option value="float">自由漂浮（可拖动）</option>
            <option value="window">坐视窗（跟随活动窗口）</option>
            <option value="taskbar">坐任务栏</option>
          </select>
        </div>
        <div style={S.hint}>「坐视窗」自动骑坐在当前活动窗口上沿，切换窗口平滑跟随；拖动桌宠即脱离锚定。坐视窗/坐任务栏时透明区域点击穿透，不挡标题栏。</div>
      </div>

      <div style={S.card}>
        <div style={S.section}>外观与尺寸</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 6 }}>
          <StepSetting label="大小" hint="30% ~ 250%（基准 200×300 像素）" value={Math.round((pet.scale || 1) * 100)} min={30} max={250} step={5} unit="%" onChange={v => petPatch({ scale: v / 100 })} />
          <StepSetting label="透明度" hint="20% ~ 100%" value={Math.round((pet.opacity ?? 0.9) * 100)} min={20} max={100} step={5} unit="%" onChange={v => petPatch({ opacity: v / 100 })} />
          <StepSetting label="Q版程度" hint="0% 原比例 ~ 150% 大头短躯干" value={Math.round((pet.chibi ?? 1) * 100)} min={0} max={150} step={10} unit="%" onChange={v => petPatch({ chibi: v / 100 })} />
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={S.row}><div style={S.label}>呼吸幅度</div><select style={sel} value={pet.breath || 'normal'} onChange={e => petPatch({ breath: e.target.value })}><option value="light">轻微</option><option value="normal">标准</option><option value="strong">明显</option></select></div>
          <div style={S.row}><div style={S.label}>小动作频率</div><select style={sel} value={pet.gesture || 'normal'} onChange={e => petPatch({ gesture: e.target.value })}><option value="low">少</option><option value="normal">标准</option><option value="high">多</option></select></div>
        </div>
        <div style={{ ...S.row, marginTop: 6 }}><div style={S.label}>透明度提示</div><div style={S.hint}>改动立即作用于桌宠窗口，不影响主界面</div></div>
      </div>

      <div style={S.card}>
        <div style={S.section}>性能与动画</div>
        <Toggle checked={fpsUnlimited} onChange={v => petPatch({ fps: v ? 0 : 60 })} label="不限帧率" hint="关闭后按上限渲染，降低 CPU/GPU 占用（高刷新率屏幕尤其明显）" />
        {!fpsUnlimited && (
          <StepSetting label="帧率上限" hint="30 ~ 144 FPS，默认 60" value={fpsValue} min={30} max={144} step={6} unit="fps" onChange={v => petPatch({ fps: v })} />
        )}
        <StepSetting label="动画过渡速度" hint="坐/站切换与状态动作的平滑时长，数值越小越快（默认 450ms）" value={Math.round(pet.transition ?? 450)} min={150} max={1500} step={50} unit="ms" onChange={v => petPatch({ transition: v })} />
      </div>

      <div style={S.card}>
        <div style={S.section}>行为</div>
        <Toggle checked={pet.topmost !== false} onChange={v => petPatch({ topmost: v })} label="始终置顶" hint="关闭后桌宠可被其他窗口盖住" />
        <Toggle checked={pet.bubble !== false} onChange={v => petPatch({ bubble: v })} label="气泡提醒" hint="任务状态、定时任务到点、回复的文字气泡" />
        <Toggle checked={pet.look !== false} onChange={v => petPatch({ look: v })} label="目光跟随鼠标" hint="鼠标在桌宠上时头部会看向光标" />
        <Toggle checked={pet.physics !== false} onChange={v => petPatch({ physics: v })} label="头发/衣摆物理" hint="关闭后为静态头发，节省一点性能" />
      </div>

      <div style={S.card}>
        <div style={S.section}>互动</div>
        <div style={S.hint}>单击头部：气泡台词 + 缩头小动作；单击身体：弹出聊天输入框；双击：打开主界面；右键：快捷菜单（位置/形态/动作/隐藏）。</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button style={S.btn('ghost')} onClick={() => void window.huangquan?.pet?.resetPos?.()}>重置位置</button>
        </div>
      </div>
    </div>
  )
}
