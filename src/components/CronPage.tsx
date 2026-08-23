// CronPage.tsx —— v0.4.2 独立定时任务页（从设置 tab 提升）
import { HourglassMark } from './themed-icons'
import CronView from './CronView'

export default function CronPage() {
  return (
    <div className="hq-page">
      <div className="hq-page-head">
        <h2 className="hq-page-title"><HourglassMark /> 定时任务</h2>
        <span className="hq-page-subtitle">计划任务编排、执行记录与模板</span>
      </div>
      <div className="hq-page-body">
        <CronView />
      </div>
    </div>
  )
}
