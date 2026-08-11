// KnowledgeImportBar.tsx —— 藏书阁导入栏（从 KnowledgeView 拆出，行为不变）
import React from 'react'
import { SUPPORTED_FORMATS } from './knowledge-utils'
import { S } from './knowledge-styles'
import { UploadMark } from './themed-icons'

export const KnowledgeImportBar: React.FC<{
  importing: boolean
  importMsg: string
  onImport: () => void
}> = ({ importing, importMsg, onImport }) => (
  <div style={S.section}>
    <div style={S.sectionTitle}>
      <span style={S.sectionIcon}><UploadMark size={13} /></span>卷宗录入
    </div>
    <div style={S.importRow}>
      <button
        className="btn-primary"
        onClick={onImport}
        disabled={importing}
        style={{ opacity: importing ? 0.6 : 1 }}
      >
        {importing ? '录入中…' : '选择文件'}
      </button>
      <span style={S.formatHint}>
        支持格式：{SUPPORTED_FORMATS.join('、')}
      </span>
    </div>
    {importMsg && (
      <div
        style={{
          ...S.importMsg,
    color: importMsg.startsWith('[OK]')
    ? 'var(--accent-green)'
    : importMsg.startsWith('[X]') || importMsg.startsWith('△')
    ? 'var(--danger)'
            : 'var(--accent)',
        }}
      >
        {importing && <span style={S.spinner} />} {importMsg}
      </div>
    )}
  </div>
)
