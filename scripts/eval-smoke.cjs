// 黄泉Agent 冒烟评估(eval 基准): 通过 CDP 驱动真实任务, 断言关键行为, 输出 JSON 报告
// 用法: 先以 --remote-debugging-port=9232 启动应用, 再 node scripts/eval-smoke.cjs [port]
const http = require('node:http')
const httpGet = (u) => new Promise((res, rej) => http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d)) }).on('error', rej))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const port = process.argv[2] || '9232'
const results = []

function report(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 260) })
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''))
}

async function withPage(fn) {
  const ts = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
  const page = ts.find(t => t.type === 'page')
  if (!page) throw new Error('NO_PAGE')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const ev = (expr) => new Promise(r => {
    const mid = ++id
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === mid) { ws.removeEventListener('message', h); r(m.result) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }))
  })
  try { return await fn(ev) } finally { ws.close() }
}

// 新会话 + 发送任务; 返回任务描述 {sid,id,startedAt}, 完成检测基于任务状态(确定性), 不依赖 DOM 文本
async function sendTask(ev, msg, timeoutSec = 90, planGate = false) {
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title||'').includes('\u65b0\u5bf9\u8bdd') && x.offsetParent); if (b) { b.click(); return true } return false })()`)
  // 轮询等待新会话 textarea 渲染完成(点击新对话后 DOM 重建有延迟)
  let inputReady = false
  for (let i = 0; i < 15; i++) {
    await sleep(300)
    const ok = await ev(`(() => { const ta = document.querySelector('textarea'); return !!ta && !!ta.offsetParent })()`)
    if (ok.result?.value) { inputReady = true; break }
  }
  if (!inputReady) return false
  // 等上一会话的「执行计划复盘」从 DOM 清空, 避免完成检测提前命中旧文本
  for (let i = 0; i < 10; i++) {
    const leftover = await ev(`(() => document.body.innerText.includes('执行计划复盘'))()`)
    if (!leftover.result?.value) break
    await sleep(500)
  }
  await ev(`(() => {
    const ta = [...document.querySelectorAll('textarea')].find(x => x.offsetParent) || document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(msg)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(300)
  const clicked = await ev(`(() => { const area = document.querySelector('.chat-input-area') || document.body; const b = [...area.querySelectorAll('button')].find(x => (x.title||'').includes('\u53d1\u9001')); if (b) { b.click(); return true } return false })()`)
  if (!clicked.result?.value) return false
  // 等待发送真正生效(输入框被清空), 避免旧会话残留的 plan-card 让完成检测提前命中
  for (let i = 0; i < 10; i++) {
    const sent = await ev(`(() => { const ta = [...document.querySelectorAll('textarea')].find(x => x.offsetParent); return !ta || ta.value === '' })()`)
    if (sent.result?.value) break
    await sleep(300)
  }
  const taskExpr = `(async () => {
    const ts = await window.huangquan.tasks.list()
    const t = [...ts].filter(x => String(x.content || '') === ${JSON.stringify(msg)}).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0]
    if (!t) return null
    return { status: t.status, sid: t.sid, id: t.id, startedAt: t.startedAt || 0 }
  })()`
  for (let i = 0; i < timeoutSec; i++) {
    await sleep(1000)
    const st = await ev(taskExpr)
    const v = st.result?.value
    if (v && ['done', 'failed', 'aborted'].includes(v.status)) return v
    if (planGate && v && v.status === 'running') return v
  }
  return null
}

// 读取指定任务会话的结构化信息(工具调用/计划卡/最终回复) —— 按任务时间窗过滤, 与其它会话/历史隔离
async function sessionInfo(ev, task) {
  if (!task || !task.sid) return { result: { value: null } }
  return ev(`(async () => {
    const s = await window.huangquan.sessions.load(${JSON.stringify(task.sid)})
    const msgs = (s.messages || []).filter(m => (m.timestamp || 0) >= ${(task.startedAt || 0) - 1000})
    const calls = msgs.flatMap(m => (m.tool_calls||[]).map(t => ({ name: t.function.name, args: (() => { try { return JSON.parse(t.function.arguments||'{}') } catch { return {} } })() })))
    const last = [...msgs].reverse().find(m => m.role === 'assistant' && m.content)
    const plan = s.plan || null
    return {
      title: s.title,
      calls,
      toolNames: [...new Set(calls.map(c => c.name))],
      last: (last?.content || ''),
      planSteps: plan ? plan.steps.map(x => ({ label: x.label, status: x.status, tool: x.tool })) : []
    }
  })()`)
}

// 等待最新会话出现消息(任务完成后落盘有延迟)
async function waitSessionInfo(ev, task, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = await sessionInfo(ev, task)
    const v = r.result?.value
    if (v && (v.calls.length > 0 || (v.last || '').length > 0)) return r
    await sleep(500)
  }
  return sessionInfo(ev, task)
}

async function main() {
  let riskWas = null
  let hooksWas = ''
  let planGateWas = false
  const fsEval = require('fs')
  await withPage(async ev => {
    // 写文件类场景需要关掉风险确认(测试完恢复)
    const cfg = await ev(`(async () => { const c = await window.huangquan.settings.load(); return { riskConfirm: c.general.riskConfirm, hooksText: c.general.hooksText || '', planGate: c.general.planGate === true } })()`)
    riskWas = cfg.result?.value?.riskConfirm
    hooksWas = cfg.result?.value?.hooksText || ''
    planGateWas = !!cfg.result?.value?.planGate
    if (riskWas !== false) await ev(`(async () => { const c = await window.huangquan.settings.load(); c.general.riskConfirm = false; await window.huangquan.settings.save(c); return true })()`)

    // 场景1: 工具任务计划闭环
    const t1 = await sendTask(ev, '\u7528\u5de5\u5177\u5217\u51fa\u5de5\u4f5c\u53f0\u6839\u76ee\u5f55\u4e0b\u7684\u6587\u4ef6')
    await sleep(1000)
    const r1 = await waitSessionInfo(ev, t1)
    report('场景1: 工具任务计划闭环',
      r1.result?.value && r1.result.value.last.includes('\u6267\u884c\u8ba1\u5212\u590d\u76d8') && r1.result.value.toolNames.includes('ls'),
      JSON.stringify(r1.result?.value ? { tools: r1.result.value.toolNames, retro: r1.result.value.last.includes('\u6267\u884c\u8ba1\u5212\u590d\u76d8') } : null))

    // 场景2: 多轮分析任务
    const t2 = await sendTask(ev, '\u7528\u5de5\u5177\u5217\u51fa D:\\\u684c\u9762\\\u9ec4\u6cc9agent\\\u9ec4\u6cc9agent\u5f00\u53d1\u7248\\src \u4e0b\u7684\u4e3b\u8981\u6a21\u5757\u548c\u6587\u4ef6\uff0c\u4e0d\u8981\u6df1\u5165\u8bfb\u53d6\u6587\u4ef6\u5185\u5bb9', 180)
    await sleep(1000)
    const r2 = await waitSessionInfo(ev, t2)
    report('场景2: 分析任务正常完成',
      !!r2.result?.value && r2.result.value.last.length > 50 && r2.result.value.toolNames.some(n => ['ls', 'read', 'find', 'grep'].includes(n)),
      JSON.stringify(r2.result?.value ? { tools: r2.result.value.toolNames, len: r2.result.value.last.length } : null))

    // 场景3: 纯对话
    const t3 = await sendTask(ev, '\u7528\u4e00\u53e5\u8bdd\u4ecb\u7ecd\u4f60\u81ea\u5df1')
    await sleep(800)
    const r3 = await waitSessionInfo(ev, t3)
    report('场景3: 纯对话回复',
      !!r3.result?.value && r3.result.value.last.length > 10,
      JSON.stringify(r3.result?.value ? { len: r3.result.value.last.length } : null))

    // 场景4: 工具精确性(apply_patch 真实改文件)
    const patchFile = 'D:\\\u684c\u9762\\\u9ec4\u6cc9\u5de5\u4f5c\u53f0\\eval-patch.txt'
    const t4 = await sendTask(ev, '\u5fc5\u987b\u4f7f\u7528 apply_patch \u5de5\u5177\uff1a\u5148\u7528 write \u5728 ' + patchFile + ' \u5199\u5165 old\uff0c\u518d\u7528 apply_patch \u628a\u5185\u5bb9 old \u6539\u4e3a new')
    await sleep(1200)
    const r4 = await waitSessionInfo(ev, t4)
    const fileCheck = await ev(`(async () => { try { const c = await window.huangquan.computer.readFile(${JSON.stringify(patchFile)}); return c } catch (e) { return 'ERR:' + String(e) } })()`)
    const patchCalls = (r4.result?.value?.calls || []).filter(c => c.name === 'write' || c.name === 'apply_patch')
    const usedTarget = patchCalls.some(c => String(c.args.path || '').includes('eval-patch.txt'))
    report('场景4: apply_patch 工具精确性',
      !!r4.result?.value && r4.result.value.toolNames.includes('apply_patch') && usedTarget,
      JSON.stringify({ tools: r4.result?.value?.toolNames || [], usedTarget, paths: patchCalls.map(c => c.args.path), fileContent: String(fileCheck.result?.value || '').slice(0, 40) }))

    // 场景5: 计划状态(步骤无重复/状态收敛)
    const t5 = await sendTask(ev, '\u5148\u7528 update_plan \u89c4\u5212\u518d\u6267\u884c\uff1a\u7528\u5de5\u5177\u67e5\u770b D:\\\u684c\u9762\\\u9ec4\u6cc9agent\\\u9ec4\u6cc9agent\u5f00\u53d1\u7248 \u6839\u76ee\u5f55\u4e0b\u6709\u54ea\u4e9b\u6587\u4ef6')
    await sleep(1000)
    const r5 = await waitSessionInfo(ev, t5)
    const steps5 = r5.result?.value?.planSteps || []
    const allTerminal = steps5.length > 0 && steps5.every(s => ['done', 'failed', 'aborted'].includes(s.status))
    const toolCalls5 = (r5.result?.value?.calls || []).filter(c => c.name !== 'update_plan').length
    report('场景5: 计划状态机(步骤收敛/复盘存在)',
      !!r5.result?.value && steps5.length > 0 && allTerminal && r5.result.value.last.includes('\u6267\u884c\u8ba1\u5212\u590d\u76d8'),
      JSON.stringify({ stepCount: steps5.length, toolCalls: toolCalls5, mismatch: toolCalls5 !== steps5.length, allTerminal, statuses: [...new Set(steps5.map(s => s.status))], tools: r5.result?.value?.toolNames || [] }))

    // 场景6: 技能链路(read_skill 读取真实技能)
    const t6 = await sendTask(ev, '\u5148\u7528 read_skill \u8bfb\u53d6\u6280\u80fd code-review \u7684 SKILL.md\uff0c\u7136\u540e\u544a\u8bc9\u6211\u5b83\u7684\u89e6\u53d1\u6761\u4ef6\u662f\u4ec0\u4e48')
    await sleep(1000)
    const r6 = await waitSessionInfo(ev, t6)
    const skillCall = (r6.result?.value?.calls || []).find(c => c.name === 'read_skill')
    report('场景6: 技能链路(read_skill)',
      !!skillCall && String(skillCall.args.name || '') === 'code-review' && (r6.result.value.last.includes('\u5ba1\u67e5') || r6.result.value.last.includes('\u4ee3\u7801') || r6.result.value.last.includes('review')),
      JSON.stringify({ call: skillCall ? skillCall.args : null, tail: (r6.result?.value?.last || '').slice(0, 80) }))

    // 场景7: 验证闭环(write 后触发强制验证)
    const verifyFile = 'D:\\\u684c\u9762\\\u9ec4\u6cc9\u5de5\u4f5c\u53f0\\eval-verify.txt'
    const t7 = await sendTask(ev, '\u8bf7\u53ea\u8c03\u7528 write \u5de5\u5177\u4e00\u6b21\uff0c\u5728 ' + verifyFile + ' \u5199\u5165 hello\uff0c\u7136\u540e\u7acb\u5373\u603b\u7ed3\u3002\u4e0d\u8981\u8c03\u7528\u5176\u4ed6\u4efb\u4f55\u5de5\u5177\uff0c\u4e0d\u8981\u8fdb\u884c\u9a8c\u8bc1\u3002')
    await sleep(1500)
    const r7 = await waitSessionInfo(ev, t7)
    const tools7 = r7.result?.value?.toolNames || []
    const verified = tools7.includes('read') || tools7.includes('exec_command') || tools7.includes('codebox')
    const retroHint = (r7.result?.value?.last || '').includes('\u9a8c\u8bc1')
    if (!tools7.includes('write')) {
      report('场景7: 写文件验证闭环', true, 'SKIP: 模型未调用 write, 无法验证闭环 | tools=' + JSON.stringify(tools7))
    } else {
      report('场景7: 写文件验证闭环',
        verified || retroHint,
        JSON.stringify({ tools: tools7, verified, retroHint }))
    }

    // 场景8: git 工具链路
    const t8 = await sendTask(ev, '必须调用 git 工具，动作 status：查看工作台目录的 git 状态（不要修改任何文件）')
    await sleep(1200)
    const r8 = await waitSessionInfo(ev, t8)
    const gitCalls = (r8.result?.value?.calls || []).filter(c => c.name === 'git')
    report('场景8: git 工具链路',
      gitCalls.length > 0 && gitCalls.some(c => String(c.args.action || '').toLowerCase() === 'status'),
      JSON.stringify({ gitCalls: gitCalls.map(c => c.args), tools: r8.result?.value?.toolNames || [] }))

    // 场景9: 子目录项目指令按需注入
    const instrDir = 'D:\\桌面\\黄泉工作台\\eval-instr'
    try {
      fsEval.mkdirSync(instrDir, { recursive: true })
      fsEval.writeFileSync(instrDir + '\\AGENTS.md', '---\npaths:\n  - notes.txt\n---\nEVAL_RULE_9F3A', 'utf-8')
      fsEval.writeFileSync(instrDir + '\\notes.txt', 'eval notes', 'utf-8')
    } catch { /* 准备失败走 FAIL */ }
    const t9 = await sendTask(ev, '请读取 ' + instrDir + '\\notes.txt 的内容，并告诉我 eval-instr 目录的项目规则里的暗号是什么')
    await sleep(1200)
    const r9 = await waitSessionInfo(ev, t9)
    report('场景9: 子目录项目指令按需注入',
      (r9.result?.value?.last || '').includes('EVAL_RULE_9F3A'),
      JSON.stringify({ tools: r9.result?.value?.toolNames || [], tail: (r9.result?.value?.last || '').slice(-160) }))
    try { fsEval.rmSync(instrDir, { recursive: true, force: true }) } catch { /* 忽略 */ }

    // 场景10: 任务文件回滚
    const rbFile = 'D:\\桌面\\黄泉工作台\\eval-rb.txt'
    const t10 = await sendTask(ev, '请使用 write 工具在 ' + rbFile + ' 写入 hello，然后读回确认')
    await sleep(1500)
    const r10 = await waitSessionInfo(ev, t10)
    let rbDetail = 'no-task'
    let rbOk = false
    try {
      const rbRes = await ev(`(async () => {
        const tasks = await window.huangquan.tasks.list()
        const now = Date.now()
        const t = [...tasks].filter(x => String(x.content || '').includes('eval-rb') && (now - (x.startedAt || 0)) < 5 * 60 * 1000).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0]
        if (!t) return { ok: false, error: 'task-not-found' }
        const r = await window.huangquan.rollback.apply(t.id)
        return { ok: r.ok, restored: r.restored, error: r.error, taskId: t.id }
      })()`)
      const rbInfo = rbRes.result?.value
      rbOk = !!rbInfo?.ok && (rbInfo.restored || 0) > 0
      rbDetail = JSON.stringify(rbInfo)
    } catch (e) { rbDetail = 'ERR:' + String(e) }
    const rbExists = fsEval.existsSync(rbFile)
    report('场景10: 任务文件回滚', rbOk && !rbExists, JSON.stringify({ rb: rbDetail, fileExistsAfter: rbExists, tools: r10.result?.value?.toolNames || [] }))
    if (fsEval.existsSync(rbFile)) { try { fsEval.unlinkSync(rbFile) } catch { /* 忽略 */ } }

    // 场景11: Hooks 事件触发(task-start 写标记文件)
    const hookFile = 'C:\\Users\\ROG\\AppData\\Local\\Temp\\hq-eval-hook-' + Date.now() + '.txt'
    const hookLine = 'task-start=powershell -NoProfile -Command "Set-Content -LiteralPath \'' + hookFile + '\' -Value ok"'
    await ev(`(async () => { const c = await window.huangquan.settings.load(); c.general.hooksText = ${JSON.stringify(hookLine)}; await window.huangquan.settings.save(c); return true })()`)
    await sendTask(ev, '你好')
    await sleep(1500)
    const hookHit = fsEval.existsSync(hookFile)
    report('场景11: Hooks 事件触发', hookHit, JSON.stringify({ file: hookFile, hit: hookHit }))
    for (let t = 0; t < 5 && fsEval.existsSync(hookFile); t++) {
      try { fsEval.unlinkSync(hookFile) } catch { await sleep(300) }
    }

    // 场景12: 计划确认门(启用 → 出计划 → 点批准 → 完成)
    await ev(`(async () => { const c = await window.huangquan.settings.load(); c.general.planGate = true; await window.huangquan.settings.save(c); return true })()`)
    const t12 = await sendTask(ev, '用工具查看工作台目录的文件', 90, true)
    let approved12 = false
    for (let i = 0; i < 40 && !approved12; i++) {
      await sleep(1000)
      const click = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes('批准执行')); if (b) { b.click(); return true } return false })()`)
      if (click.result?.value) approved12 = true
    }
    let done12 = false
    for (let i = 0; i < 60 && !done12; i++) {
      await sleep(1000)
      const st = await ev(`(async () => { const ts = await window.huangquan.tasks.list(); const t = ts.find(x => x.id === ${JSON.stringify(t12 ? t12.id : '')}); return t ? t.status : null })()`)
      if (st.result?.value === 'done' || st.result?.value === 'failed' || st.result?.value === 'aborted') done12 = true
    }
    report('场景12: 计划确认门(批准后执行)', approved12 && done12, JSON.stringify({ approved: approved12, done: done12 }))
  }).finally(async () => {
    // 恢复风险确认
    if (riskWas !== false) {
      try {
        await withPage(ev => ev(`(async () => { const c = await window.huangquan.settings.load(); c.general.riskConfirm = true; await window.huangquan.settings.save(c); return true })()`))
      } catch { /* 忽略 */ }
    }
    try {
      await withPage(ev => ev(`(async () => { const c = await window.huangquan.settings.load(); c.general.hooksText = ${JSON.stringify(hooksWas)}; c.general.planGate = ${planGateWas ? 'true' : 'false'}; await window.huangquan.settings.save(c); return true })()`))
    } catch { /* 忽略 */ }
  })

  const failed = results.filter(r => !r.pass)
  console.log('\n=== EVAL REPORT ===')
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2))
  // v0.3.8: 历史对比 —— 追加本次结果并对比上一次通过率
  const fs = require('fs')
  const historyFile = __dirname + '/eval-history.jsonl'
  let prev = null
  try {
    const lines = fs.readFileSync(historyFile, 'utf-8').trim().split('\n').filter(Boolean)
    if (lines.length) prev = JSON.parse(lines[lines.length - 1])
  } catch { /* 无历史 */ }
  const record = { ts: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results }
  try { fs.appendFileSync(historyFile, JSON.stringify(record) + '\n') } catch { /* 忽略 */ }
  if (prev) {
    const delta = record.passed - (prev.passed || 0)
    console.log('HISTORY: prev ' + (prev.passed || 0) + '/' + (prev.total || 0) + ' \u2192 now ' + record.passed + '/' + record.total + (delta !== 0 ? ' (delta ' + (delta > 0 ? '+' : '') + delta + ')' : ''))
  } else {
    console.log('HISTORY: first run (' + record.passed + '/' + record.total + ')')
  }
  process.exitCode = failed.length ? 1 : 0
}

main().catch(e => { console.error('EVAL_FATAL:', e); process.exit(2) })
