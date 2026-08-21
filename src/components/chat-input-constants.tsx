// chat-input-constants.ts —— 聊天输入框常量（从 ChatInput 拆出，行为不变）
import React from 'react'
import { Shield, Unlock, Lock, Eye } from 'lucide-react'

export type FilePerm = 'auto' | 'full' | 'ask' | 'readonly'
export type ThinkLevel = 'off' | 'quick' | 'medium' | 'deep' | 'extreme' | 'ultra'
export const PERM_ICONS: Record<FilePerm, React.ReactNode> = { auto: <Shield size={14} />, full: <Unlock size={14} />, ask: <Lock size={14} />, readonly: <Eye size={14} /> }
export const PERM_LABELS: Record<FilePerm, string> = { auto: '自动审核', full: '完整权限', ask: '操作前询问', readonly: '只读' }
export const THINK_LEVELS = ['quick', 'medium', 'deep', 'extreme', 'ultra'] as const
export const THINK_LABELS: Record<string, string> = { quick: '快速', medium: '标准', deep: '高', extreme: '极高', ultra: '最高' }
