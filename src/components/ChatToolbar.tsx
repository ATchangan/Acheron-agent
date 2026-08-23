// ChatToolbar.tsx —— 聊天输入框左侧工具栏（从 ChatInput 拆出，行为不变）
import React from 'react'
import { Camera, Command, Bookmark, Paperclip, Plus, MoreHorizontal } from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { PERM_ICONS, PERM_LABELS, type FilePerm } from './chat-input-constants'
import { U } from './ui-styles'


const IconBtn: React.FC<{ title: string; onClick?: () => void; children: React.ReactNode; style?: React.CSSProperties; disabled?: boolean }> =
  ({ title, onClick, children, style, disabled }) => (
    <button title={title} onClick={onClick} disabled={disabled} className="hq-toolbar-btn" style={{
      fontSize: 'calc(var(--ui-font-size) + 3px)', lineHeight: 1, opacity: disabled ? 0.3 : 1, padding: 0, ...style,
    }}>
      {children}
    </button>
  )

export const ChatToolbar: React.FC<{
  extraOpen: boolean
  cmdOpen: boolean
  memOpen: boolean
  permOpen: boolean
  memText: string
  perm: string
  supportsVision: boolean
  visionAssist: boolean
  fileRef: React.RefObject<HTMLInputElement | null>
  attFileRef: React.RefObject<HTMLInputElement | null>
  onToggleExtra: () => void
  onToggleCmd: () => void
  onToggleMem: () => void
  onTogglePerm: () => void
  onMemText: (v: string) => void
  onSaveMemory: () => void
  onPerm: (v: string) => void
  onSetText: (v: string) => void
  onSend: () => void
  onImagePick: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFilePick: (e: React.ChangeEvent<HTMLInputElement>) => void
  moreOpen: boolean
  onToggleMore: () => void
}> = ({ extraOpen, cmdOpen, memOpen, permOpen, memText, perm, supportsVision, visionAssist, fileRef, attFileRef, onToggleExtra, onToggleCmd, onToggleMem, onTogglePerm, onMemText, onSaveMemory, onPerm, onSetText, onSend, onImagePick, onFilePick, moreOpen, onToggleMore }) => {
  const upload = (kind: 'img' | 'file') => (
    <label title={kind === 'img' ? (supportsVision ? '上传图片' : (visionAssist ? '上传图片（自动用视觉辅助模型分析）' : '上传图片')) : '上传文件（视频/音频/文档）'} style={{
      width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', borderRadius: 6, position: 'relative', overflow: 'hidden', transition: 'all .12s',
    }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <input ref={kind === 'img' ? fileRef : attFileRef} type="file" multiple hidden onChange={kind === 'img' ? onImagePick : onFilePick} />
      {kind === 'img' ? <Camera size={16} color="var(--text-secondary)" style={U.shrink0} /> : <Paperclip size={16} color="var(--text-secondary)" style={U.shrink0} />}
    </label>
  )
  return (
    <div className="input-left-icons">
      <IconBtn title={moreOpen ? '收起更多工具' : '更多工具'} onClick={onToggleMore}><MoreHorizontal size={16} /></IconBtn>
      {upload('img')}
      {upload('file')}
      {moreOpen && (<>
        {/* 补充更多上下文 */}
        <IconBtn title={extraOpen ? '收起补充上下文' : '补充更多上下文'} onClick={onToggleExtra}><Plus size={16} /></IconBtn>
        {/* 快捷指令 */}
        <div className="dropdown-wrap">
          <IconBtn title="快捷指令" onClick={onToggleCmd}><Command size={16} /></IconBtn>
          {cmdOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-item" onClick={() => { onSetText('/diary'); onSend() }}>/diary 生成日记</div>
              <div className="dropdown-item" onClick={() => { onSetText('/xing'); onSend() }}>/xing 提取流程</div>
              <div className="dropdown-item" onClick={() => { onSetText('/compact'); onSend() }}>/compact 压缩历史</div>
            </div>
          )}
        </div>
        {/* 记忆 */}
        <div className="dropdown-wrap">
          <IconBtn title="记忆管理" onClick={onToggleMem}><Bookmark size={16} /></IconBtn>
          {memOpen && (
            <div className="dropdown-menu dropdown-wide">
              <input className="dropdown-input" placeholder="保存到记忆..." value={memText}
                onChange={e => onMemText(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSaveMemory()} />
              <button className="btn-small" onClick={onSaveMemory} style={{ width: '100%' }}>保存</button>
            </div>
          )}
        </div>
        {/* 文件权限 */}
        <div className="dropdown-wrap">
          <IconBtn title={`文件权限: ${PERM_LABELS[perm as FilePerm] || perm}`} onClick={onTogglePerm}>{PERM_ICONS[perm as FilePerm] || '?'}</IconBtn>
          {permOpen && (
            <div className="dropdown-menu">
              {(Object.keys(PERM_ICONS) as FilePerm[]).map(k => (
                <div key={k} className={`dropdown-item ${perm === k ? 'active' : ''}`} onClick={() => { onPerm(k); useSettingsStore.getState().updateGeneral({ filePermission: k }) }}>
                  {PERM_ICONS[k]} {PERM_LABELS[k]}
                </div>
              ))}
            </div>
          )}
        </div>
      </>)}
    </div>
  )
}
