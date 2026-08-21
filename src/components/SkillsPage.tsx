// SkillsPage.tsx —— v0.4.2 独立技能页（从设置 tab 提升为工作区页面）
import React from 'react'
import { BookOpen } from 'lucide-react'
import SkillsTab from './settings/SkillsTab'

export default function SkillsPage() {
  return (
    <div className="hq-page">
      <div className="hq-page-head">
        <h2 className="hq-page-title"><BookOpen size={16} /> 技能</h2>
        <span className="hq-page-subtitle">技能扫描、注入与隐藏管理</span>
      </div>
      <div className="hq-page-body">
        <SkillsTab />
      </div>
    </div>
  )
}
