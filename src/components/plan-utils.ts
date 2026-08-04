// v0.3.1 块 K: 计划类型/工具/模板(从 PlanningView 拆出, 行为零变化)
import React, { useState, useEffect, useCallback, useMemo } from 'react'

// ═══════════════════════════════════════════════════════════════
// 黄泉谋断阁 · Autonomous Planning View
// ═══════════════════════════════════════════════════════════════

// ─── types ─────────────────────────────────────────────────
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'
export type PlanStatus = 'active' | 'paused' | 'completed' | 'archived'
export type ViewMode = 'create' | 'edit' | 'history'

export interface PlanStep {
  id: string
  title: string
  description: string
  status: StepStatus
  dependencies: string[]
  notes: string
}

export interface Plan {
  id: string
  title: string
  goal: string
  steps: PlanStep[]
  status: PlanStatus
  createdAt: number
  updatedAt: number
}

export interface PlanTemplate {
  id: string
  title: string
  icon: string
  goal: string
  steps: Omit<PlanStep, 'id' | 'status' | 'notes'>[]
}

// ─── template library ──────────────────────────────────────
export const TEMPLATES: PlanTemplate[] = [
  {
    id: 'code-project',
    title: '代码项目创建',
    icon: '💻',
    goal: '从零搭建一个完整的代码项目',
    steps: [
      { title: '项目需求分析', description: '明确项目目标、功能需求和技术约束，编写需求文档', dependencies: [] },
      { title: '技术栈选型', description: '根据需求选择编程语言、框架、数据库和工具链', dependencies: ['step_0'] },
      { title: '项目脚手架搭建', description: '初始化项目结构、配置构建工具和依赖管理', dependencies: ['step_1'] },
      { title: '核心模块开发', description: '实现核心业务逻辑、API接口和数据结构', dependencies: ['step_2'] },
      { title: '测试与质量保障', description: '编写单元测试、集成测试，进行代码审查', dependencies: ['step_3'] },
      { title: '部署与文档', description: '配置 CI/CD、编写 README 和 API 文档，部署上线', dependencies: ['step_4'] },
    ],
  },
  {
    id: 'doc-writing',
    title: '文档撰写',
    icon: '📝',
    goal: '撰写一份高质量的技术文档或文章',
    steps: [
      { title: '选题与大纲', description: '确定文档主题、目标读者和内容大纲', dependencies: [] },
      { title: '资料收集', description: '收集相关资料、参考文档和示例代码', dependencies: ['step_0'] },
      { title: '初稿撰写', description: '按照大纲完成初稿，先求完整再求完美', dependencies: ['step_1'] },
      { title: '审阅修订', description: '检查逻辑、语法和格式，补充遗漏，优化表达', dependencies: ['step_2'] },
      { title: '发布与反馈', description: '排版发布，收集读者反馈，持续迭代', dependencies: ['step_3'] },
    ],
  },
  {
    id: 'data-analysis',
    title: '数据分析',
    icon: '📊',
    goal: '完成一个端到端的数据分析任务',
    steps: [
      { title: '问题定义', description: '明确分析目标、关键指标和预期产出', dependencies: [] },
      { title: '数据采集与清洗', description: '收集原始数据，处理缺失值、异常值和格式问题', dependencies: ['step_0'] },
      { title: '探索性分析', description: '通过可视化和统计方法发现数据特征和规律', dependencies: ['step_1'] },
      { title: '建模与验证', description: '选择合适的模型进行分析，交叉验证结果', dependencies: ['step_2'] },
      { title: '结论与报告', description: '整理分析结论，制作可视化报告和行动建议', dependencies: ['step_3'] },
    ],
  },
  {
    id: 'study-plan',
    title: '学习计划',
    icon: '📚',
    goal: '系统学习一门新技术或知识领域',
    steps: [
      { title: '学习目标设定', description: '明确学习范围、时间投入和期望达到的水平', dependencies: [] },
      { title: '资源筛选', description: '挑选优质教材、课程、文档和实践项目', dependencies: ['step_0'] },
      { title: '基础概念掌握', description: '系统学习核心概念、原理和基础技能', dependencies: ['step_1'] },
      { title: '实战练习', description: '通过项目、习题或案例分析巩固所学知识', dependencies: ['step_2'] },
      { title: '总结与输出', description: '整理学习笔记、撰写总结文章或分享演示', dependencies: ['step_3'] },
    ],
  },
]

export const STATUS_LABELS: Record<StepStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
}
export const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '✔',
  blocked: '⊘',
}
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
}

// ─── helpers ──────────────────────────────────────────────
let _idCounter = 0
export function uid(): string {
  _idCounter++
  return `step_${Date.now()}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`
}

export function planUid(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function tsLabel(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}

export function progressPct(steps: PlanStep[]): number {
  if (steps.length === 0) return 0
  const done = steps.filter(s => s.status === 'completed').length
  return Math.round((done / steps.length) * 100)
}

export const PLAN_PREFIX = '[plan]'