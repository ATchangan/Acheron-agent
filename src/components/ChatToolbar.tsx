// ChatToolbar.tsx —— v0.6.0 composer 左侧「+」菜单（上传/上下文/指令）
// 权限档已上移为输入框独立盾牌下拉(hq-perm-picker), 不再收在 + 菜单里
// 保持原 props 接口不变, ChatInput 无需感知菜单结构
import React from 'react'
import { FileUp, Plus, Command, Image as ImageIcon, Paperclip, ShieldCheck } from 'lucide-react'
import { PERM_ICONS, PERM_LABELS, type FilePerm } from './chat-input-constants'
import { useSettingsStore } from '../store/settings'


export const ChatToolbar: React.FC<{
  extraOpen: boolean
  cmdOpen: boolean
  permOpen: boolean
  perm: string
  supportsVision: boolean
  visionAssist: boolean
  fileRef: React.RefObject<HTMLInputElement | null>
  attFileRef: React.RefObject<HTMLInputElement | null>
  onToggleExtra: () => void
  onToggleCmd: () => void
  onTogglePerm: () => void
  onPerm: (v: string) => void
  onSetText: (v: string) => void
  onSend: () => void
  onImagePick: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFilePick: (e: React.ChangeEvent<HTMLInputElement>) => void
  moreOpen: boolean
  onToggleMore: () => void
}> = ({ extraOpen, perm, supportsVision, visionAssist, fileRef, attFileRef, onToggleExtra, onPerm, onImagePick, onFilePick, moreOpen, onToggleMore }) => {
  const imgTitle = supportsVision ? '上传图片' : (visionAssist ? '上传图片（自动用视觉辅助模型分析）' : '上传图片')

  return (
    <div className="composer-plus-wrap" style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        className={'composer-plus' + (moreOpen ? ' open' : '')}
        title="添加图片 / 文件 / 上下文"
        aria-label="添加"
        onClick={onToggleMore}
      >
        <Plus size={17} />
      </button>
      {moreOpen && (
        <div className="composer-plus-menu">
          <label className="composer-plus-item" title={imgTitle} onClick={() => onToggleMore()}>
            <input ref={fileRef} type="file" multiple hidden accept="image/*" onChange={onImagePick} />
            <ImageIcon size={15} />上传图片…
          </label>
          <label className="composer-plus-item" title="上传文件（视频/音频/文档）" onClick={() => onToggleMore()}>
            <input ref={attFileRef} type="file" multiple hidden onChange={onFilePick} />
            <Paperclip size={15} />上传文件…
          </label>
          <button type="button" className={'composer-plus-item' + (extraOpen ? ' active' : '')} onClick={() => { onToggleExtra(); onToggleMore() }}>
            <FileUp size={15} />补充上下文<span className="ppi-sub">{extraOpen ? '收起' : ''}</span>
          </button>
          <button type="button" className="composer-plus-item" onClick={() => onToggleMore()}>
            <Command size={15} />快捷指令<span className="ppi-sub">输入 / 查看</span>
          </button>
          <div style={{ borderTop: '1px solid var(--border-soft)', margin: '4px 6px' }} />
          {(Object.keys(PERM_ICONS) as FilePerm[]).map(k => (
            <button
              key={k}
              type="button"
              className={'composer-plus-item' + (perm === k ? ' active' : '')}
              title="文件权限档（仅影响当前会话，默认档在 设置→安全）"
              onClick={() => { onPerm(k); useSettingsStore.getState().updateGeneral({ filePermission: k }) }}
            >
              <ShieldCheck size={15} />{PERM_LABELS[k]}
              {perm === k && <span className="ppi-sub">当前</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
