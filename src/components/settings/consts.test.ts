import { describe, it, expect } from 'vitest'
import { detectCaps } from './consts'

describe('detectCaps 模型能力识别', () => {
  it('纯文字模型归为文字', () => {
    expect(detectCaps(['deepseek-v4-flash'])).toEqual(['文字'])
    expect(detectCaps(['kimi-k2.7-code'])).toEqual(['文字'])
  })

  it('多模态视觉模型归为多模态', () => {
    expect(detectCaps(['gpt-4o'])).toContain('多模态')
    expect(detectCaps(['qwen3-vl-plus'])).toContain('多模态')
    expect(detectCaps(['glm-4v-plus'])).toContain('多模态')
    expect(detectCaps(['glm-4.5v'])).toContain('多模态')
    expect(detectCaps(['glm-4.6v-flash'])).toContain('多模态')
  })

  it('图片生成模型归为图片', () => {
    expect(detectCaps(['qwen-image-3.0-pro'])).toContain('图片')
    expect(detectCaps(['flux-1.1-pro'])).toContain('图片')
    expect(detectCaps(['seedream-4.0'])).toContain('图片')
  })

  it('视频生成模型归为视频', () => {
    expect(detectCaps(['kling-v1-6'])).toContain('视频')
    expect(detectCaps(['qwen-video-max'])).toContain('视频')
    expect(detectCaps(['doubao-seedance-1-0'])).toContain('视频')
  })

  it('语音模型归为语音', () => {
    expect(detectCaps(['qwen-audio-asr-flash'])).toContain('语音')
    expect(detectCaps(['gpt-4o-transcribe'])).toContain('语音')
    expect(detectCaps(['chattts'])).toContain('语音')
  })

  it('OCR 模型归多模态而不是语音', () => {
    const caps = detectCaps(['qwen3-ocr'])
    expect(caps).toContain('多模态')
    expect(caps).not.toContain('语音')
  })
})
