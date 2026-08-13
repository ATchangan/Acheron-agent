// 桌宠全动作回归截图脚本: 14 个状态/坐姿/表情 + FPS 测量
// 用法: node scripts/pet-action-verify.js   (要求开发版已带 CDP 运行, 端口可用 HQ_PET_CDP 覆盖)
const { chromium } = require('playwright-core')
const { join } = require('path')

const OUT = join(__dirname, '..', '..', '_pet_shots', 'verify')
const fs = require('fs')
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const cdpUrl = process.env.HQ_PET_CDP || 'http://127.0.0.1:9345'
  const browser = await chromium.connectOverCDP(cdpUrl)
  const ctx = browser.contexts()[0]
  const main = ctx.pages().find(p => p.url().includes('127.0.0.1'))
  const pet = ctx.pages().find(p => p.url().includes('pet/index.html'))
  await sleep(2000)

  const set = async (fn, arg) => main.evaluate(fn, arg)
  const petEval = (fn, arg) => pet.evaluate(fn, arg)
  const shot = async (name, wait = 1800) => {
    await sleep(wait)
    await pet.screenshot({ path: `${OUT}/${name}.png` })
    const meta = await petEval(() => JSON.stringify({
      action: window.pet3d.debug().action, form: window.pet3d.debug().loadedForm,
      anchor: window.pet3d.debug().anchor, layout: window.pet3d.layout(),
    }))
    console.log(name, meta)
  }

  // 1. 正常形态待机
  await set(() => { window.huangquan.pet.setAnchor('float'); window.huangquan.pet.setForm('normal'); window.huangquan.pet.setAction('idle') })
  await shot('01_normal_idle', 2500)

  // 2-4. 三个舞蹈(正常形态)
  for (const [k, a] of [['02_dance1', 'dance1'], ['03_dance2', 'dance2'], ['04_dance3', 'dance3']]) {
    await set((act) => window.huangquan.pet.setAction(act), a)
    await shot(k, 4500)
  }

  // 5. 大招形态待机
  await set(() => { window.huangquan.pet.setAction('idle'); window.huangquan.pet.setForm('ultimate') })
  await shot('05_ultimate_idle', 3000)

  // 6. 大招形态跳舞(第一个舞蹈)
  await set(() => window.huangquan.pet.setAction('dance1'))
  await shot('06_ultimate_dance1', 4500)

  // 7. 回到正常形态, 坐视窗
  await set(() => { window.huangquan.pet.setForm('normal'); window.huangquan.pet.setAction('idle'); window.huangquan.pet.setAnchor('window') })
  await shot('07_sit_window', 2600)

  // 8. 坐任务栏
  await set(() => window.huangquan.pet.setAnchor('taskbar'))
  await shot('08_sit_taskbar', 2600)

  // 9. 拖拽漂浮姿态(自由模式)
  await set(() => window.huangquan.pet.setAnchor('float'))
  await petEval(() => { window.pet3d.setDragging(true) })
  await shot('09_dragging', 900)
  await petEval(() => { window.pet3d.setDragging(false) })

  // 10. 戳头反应
  await petEval(() => { window.pet3d.setPoke() })
  await shot('10_head_poke', 350)

  // 11. 思考状态
  await petEval(() => { window.pet3d.setStatus('thinking') })
  await shot('11_thinking', 1200)

  // 12. 工作状态
  await petEval(() => { window.pet3d.setStatus('working') })
  await shot('12_working', 1200)

  // 13. 完成状态
  await petEval(() => { window.pet3d.setStatus('done') })
  await shot('13_done', 600)

  // 14. 出错状态
  await petEval(() => { window.pet3d.setStatus('error') })
  await shot('14_error', 400)

  // 恢复待机
  await petEval(() => { window.pet3d.setStatus('idle') })
  await set(() => { window.huangquan.pet.setAnchor('float'); window.huangquan.pet.setAction('idle'); window.huangquan.pet.setForm('normal') })

  // FPS 测量
  const fps = await petEval(() => new Promise((resolve) => {
    let n = 0
    const t0 = performance.now()
    const loop = () => {
      n += 1
      if (performance.now() - t0 < 2000) requestAnimationFrame(loop)
      else resolve({ frames: n, fps: Math.round(n / 2) })
    }
    requestAnimationFrame(loop)
  }))
  console.log('FPS', JSON.stringify(fps))
  await browser.close()
}

main().catch(e => { console.error(e); process.exit(1) })
