// InlinePlanApproval.tsx —— v0.4.2 行内计划审批：渲染在回合内，替代原顶部计划卡
import { ClipboardList, Check, X } from 'lucide-react'
import { useChatStore } from '../store/chat'

export default function InlinePlanApproval() {
  const cid = useChatStore(s => s.cid)
  const plan = useChatStore(s => cid ? s.plans[cid] : null)
  if (!plan?.pending || !cid) return null

  const reject = async () => {
    await window.huangquan.engine.reject(cid).catch(() => {})
    useChatStore.setState(s => { const pp = { ...s.plans }; delete pp[cid]; return { plans: pp } })
  }
  const approve = async () => {
    useChatStore.setState(s => ({ plans: { ...s.plans, [cid]: { ...s.plans[cid], pending: false } } }))
    await window.huangquan.engine.approve(cid).catch(() => {})
  }

  return (
    <div className="hq-plan-approval">
      <div className="hq-plan-approval-head">
        <ClipboardList size={13} />
        <span>执行计划待批准</span>
        {plan.summary && <span className="hq-plan-approval-summary" title={plan.summary}>{plan.summary}</span>}
      </div>
      {plan.steps.length > 0 && (
        <div className="hq-plan-approval-steps">
          {plan.steps.map((s, i) => (
            <div key={s.id} className="hq-plan-step">
              <span className="hq-plan-step-idx">{i + 1}</span>
              <span className="hq-plan-step-label">{s.label}</span>
              {s.tool && <span className="hq-plan-step-tool">{s.tool}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="hq-plan-approval-actions">
        <button type="button" className="hq-btn" onClick={() => void reject()}><X size={12} /> 拒绝</button>
        <button type="button" className="hq-btn hq-btn-accent" onClick={() => void approve()}><Check size={12} /> 批准执行</button>
      </div>
    </div>
  )
}
