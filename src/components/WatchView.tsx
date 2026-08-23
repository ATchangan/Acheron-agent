// WatchView.tsx —— v0.4.2 任务监视窗（watch windows）：独立小窗实时查看会话
import ReadonlyThread from './ReadonlyThread'

export default function WatchView({ sid }: { sid: string }) {
  return (
    <div className="hq-watch">
      <div className="hq-watch-head">
        <span className="hq-watch-live"><span className="hq-status-pulse" />实时</span>
        <span className="hq-watch-title">任务监视</span>
        <button type="button" className="hq-icon-btn" title="关闭" aria-label="关闭" onClick={() => window.close()}>×</button>
      </div>
      <div className="hq-watch-body"><ReadonlyThread sessionId={sid} pollMs={2000} /></div>
    </div>
  )
}
