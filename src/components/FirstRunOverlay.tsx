// FirstRunOverlay.tsx —— v0.4.2 首次引导（onboarding）：三步引导，完成即不再显示
import { useState } from 'react'
import { KeyRound, Folder, Check, ArrowRight, X } from 'lucide-react'

export default function FirstRunOverlay({ onDone, onOpenSettings }: {
  onDone: () => void
  onOpenSettings: (tab?: string) => void
}) {
  const STEP_KEY = 'hq_onboard_step'
  const [step, setStepState] = useState(() => {
    try { return Math.min(3, Math.max(0, Number(localStorage.getItem(STEP_KEY)) || 0)) } catch { return 0 }
  })
  const setStep = (s: number) => { setStepState(s); localStorage.setItem(STEP_KEY, String(s)) }
  const steps = [
    { icon: <KeyRound size={18} />, title: '欢迎使用 Acheron-Agent', desc: '本地优先的桌面 AI 助手：会话流式回复、工具调用与插件生态全部在本地运行。', action: '下一步', run: () => setStep(1) },
    { icon: <KeyRound size={18} />, title: '配置模型服务商', desc: '先在「供应商」中添加一个模型服务并填入 API Key，才能开始对话。配置完成即视为完成引导，之后不再出现。', action: '去配置服务商', run: () => { onOpenSettings('models'); onDone() } },
    { icon: <Folder size={18} />, title: '设置工作目录', desc: '配置工作目录后，文件与项目树都会以它为根。配置完成即视为完成引导，之后不再出现。', action: '去设置工作目录', run: () => { onOpenSettings('advanced'); onDone() } },
    { icon: <Check size={18} />, title: '开始使用', desc: '一切就绪。试试在对话中让助手处理你的第一个任务，或按 Ctrl+K 打开命令面板。', action: '完成', run: () => { localStorage.removeItem(STEP_KEY); onDone() } },
  ]
  const s = steps[step]
  return (
    <div className="hq-onboard">
      <div className="hq-onboard-card">
        <div className="hq-onboard-icon">{s.icon}</div>
        <div className="hq-onboard-title">{s.title}</div>
        <div className="hq-onboard-desc">{s.desc}</div>
        <div className="hq-onboard-dots">
          {steps.map((_, i) => <span key={i} className={'hq-onboard-dot' + (i === step ? ' active' : '')} />)}
        </div>
        <div className="hq-onboard-actions">
          {step > 0 && <button type="button" className="hq-btn" onClick={() => setStep(step - 1)}>上一步</button>}
          <button type="button" className="hq-btn hq-btn-accent" onClick={() => s.run()}>{s.action} {step === 0 ? <ArrowRight size={13} /> : null}</button>
        </div>
        <button type="button" className="hq-onboard-skip" onClick={onDone}>
          <X size={12} /> 跳过引导，不再显示
        </button>
      </div>
    </div>
  )
}
