/* global window, document */
/* 式神桌宠 UI 层: 气泡/名字/拖拽/菜单/状态转发; 3D 渲染在 pet3d.js */
(function () {
  var cfg = { agent: '黄泉', bubble: true, lines: [], form: 'normal', action: 'idle' }
  var bubble = document.getElementById('bubble')
  var nameEl = document.getElementById('name')
  var stage = document.getElementById('stage')
  var fallback = document.getElementById('fallback')
  var idleTimer = null
  var bubbleTimer = null
  var dragging = false
  var dragStart = null
  var status = 'idle'

  function say(text) {
    if (!cfg.bubble || !text) return
    bubble.textContent = text
    bubble.classList.add('show')
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(function () { bubble.classList.remove('show') }, 4500)
  }

  function applyStatus(state, text) {
    status = state || 'idle'
    document.body.classList.remove('idle', 'thinking', 'working', 'done', 'error')
    document.body.classList.add(status)
    if (status !== 'idle') say(text)
    if (idleTimer) clearTimeout(idleTimer)
    if (status !== 'idle') {
      idleTimer = setTimeout(function () { applyStatus('idle') }, 30000)
    }
    if (window.pet3d) window.pet3d.setStatus(status)
  }

  function applyForm(form) {
    cfg.form = form === 'ultimate' ? 'ultimate' : 'normal'
    document.body.classList.toggle('form-ultimate', cfg.form === 'ultimate')
    if (window.pet3d) window.pet3d.setForm(cfg.form)
  }

  function applyAction(action) {
    cfg.action = action || 'idle'
    if (window.pet3d) window.pet3d.setAction(cfg.action)
  }

  function applyAgent(agent) {
    var is3d = agent === '黄泉'
    nameEl.textContent = agent || '黄泉'
    stage.style.display = is3d ? 'block' : 'none'
    fallback.classList.toggle('on', !is3d)
    if (!is3d) {
      var accents = { 黄泉: '239,68,68', 姬子: '244,162,97', 三月七: '150,206,229', 银狼: '129,140,248', 艾丝妲: '251,191,36', 知更鸟: '236,72,153', 黑天鹅: '167,139,250', 螺丝咕姆: '110,231,183' }
      var rgb = accents[agent] || '239,68,68'
      document.documentElement.style.setProperty('--accent', 'rgb(' + rgb + ')')
    }
  }

  window.petIpc.on('pet:config', function (c) {
    cfg = c || cfg
    applyAgent(cfg.agent)
    applyForm(cfg.form)
    applyAction(cfg.action)
    document.body.style.opacity = String(cfg.opacity != null ? cfg.opacity : 0.9)
    applyStatus(status)
  })

  window.petIpc.on('pet:form', function (form) {
    applyForm(form)
  })

  window.petIpc.on('pet:action', function (action) {
    applyAction(action)
  })

  window.petIpc.on('pet:event', function (e) {
    if (!e || e.event !== 'state') return
    applyStatus(e.payload && e.payload.state, e.payload && e.payload.text)
  })

  // 3D 模型缺失(如克隆仓库不含建模资源)时回退 SVG 剪影
  window.addEventListener('pet3d-error', function () {
    stage.style.display = 'none'
    fallback.classList.add('on')
  })

  document.body.addEventListener('click', function () {
    var lines = cfg.lines && cfg.lines.length ? cfg.lines : ['主人，我在']
    say(lines[Math.floor(Math.random() * lines.length)])
  })

  document.body.addEventListener('dblclick', function () { window.petIpc.invoke('pet:open-main') })

  document.body.addEventListener('contextmenu', function (ev) {
    ev.preventDefault()
    window.petIpc.invoke('pet:menu')
  })

  document.body.addEventListener('mousedown', function (ev) {
    dragging = true
    dragStart = { mx: ev.screenX, my: ev.screenY }
  })

  window.addEventListener('mouseup', function (ev) {
    if (!dragging || !dragStart) return
    dragging = false
    var dx = ev.screenX - dragStart.mx
    var dy = ev.screenY - dragStart.my
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) window.petIpc.invoke('pet:moved', window.screenX + dx, window.screenY + dy)
  })
})()
