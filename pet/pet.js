/* global window, document */
/* 式神桌宠 UI 层: 气泡/名字/拖拽/菜单/状态转发; 3D 渲染在 pet3d.js */
(function () {
  var cfg = { agent: '黄泉', bubble: true, lines: [], form: 'normal', action: 'idle', anchor: 'float' }
  var bubble = document.getElementById('bubble')
  var chatBox = document.getElementById('chat-box')
  var chatInput = document.getElementById('chat-input')
  var chatSend = document.getElementById('chat-send')
  var nameEl = document.getElementById('name')
  var stage = document.getElementById('stage')
  var fallback = document.getElementById('fallback')
  var idleTimer = null
  var bubbleTimer = null
  var dragging = false
  var pendingAnchor = null
  var moved = false
  var dragStart = null
  var status = 'idle'
  var replyTimer = null

  function say(text) {
    if (!cfg.bubble || !text) return
    bubble.textContent = text
    bubble.classList.add('show')
    if (window.pet3d) window.pet3d.setTalk()
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

  function applyAnchor(anchor) {
    if (dragging) { pendingAnchor = anchor; return }
    cfg.anchor = anchor === 'window' || anchor === 'taskbar' ? anchor : 'float'
    document.body.classList.toggle('anchor-window', cfg.anchor === 'window')
    document.body.classList.toggle('anchor-taskbar', cfg.anchor === 'taskbar')
    if (window.pet3d) window.pet3d.setAnchor(cfg.anchor)
  }

  function openChat() {
    chatBox.classList.add('on')
    window.petIpc.invoke('pet:focus').then(function () {
      try { chatInput.focus() } catch (_) { /* 忽略 */ }
    })
  }

  function closeChat() {
    chatBox.classList.remove('on')
    chatInput.blur()
    window.petIpc.invoke('pet:unfocus')
  }

  function sendChat() {
    var text = (chatInput.value || '').trim()
    if (!text) return
    chatInput.value = ''
    closeChat()
    say('…')
    window.petIpc.invoke('pet:chat', text.slice(0, 2000))
  }

  function showReply(text, streaming) {
    if (!text) return
    var shown = text.length > 220 ? text.slice(-220) : text
    bubble.textContent = shown
    bubble.classList.add('show')
    if (replyTimer) clearTimeout(replyTimer)
    if (!streaming) replyTimer = setTimeout(function () { bubble.classList.remove('show') }, 7000)
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

  function applyOptions(o) {
    if (!o) return
    if (o.opacity != null) document.body.style.opacity = String(Math.max(0.2, Math.min(1, Number(o.opacity))))
    if (window.pet3d) window.pet3d.setOptions(o)
  }

  window.petIpc.on('pet:config', function (c) {
    cfg = c || cfg
    applyAgent(cfg.agent)
    applyForm(cfg.form)
    applyAction(cfg.action)
    applyAnchor(cfg.anchor)
    document.body.style.opacity = String(cfg.opacity != null ? cfg.opacity : 0.9)
    if (window.pet3d) window.pet3d.setOptions(cfg)
    applyStatus(status)
  })

  window.petIpc.on('pet:form', function (form) {
    applyForm(form)
  })

  window.petIpc.on('pet:action', function (action) {
    applyAction(action)
  })

  window.petIpc.on('pet:anchor', function (anchor) {
    applyAnchor(anchor)
  })

  window.petIpc.on('pet:options', function (o) {
    applyOptions(o)
  })

  window.petIpc.on('pet:chat', function (d) {
    if (!d) return
    if (d.thinking) { bubble.textContent = '…'; bubble.classList.add('show'); return }
    showReply(d.text, d.streaming)
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

  document.body.addEventListener('click', function (ev) {
    if (moved) { moved = false; return }
    var hit = window.pet3d ? window.pet3d.pokeAt(ev.clientX, ev.clientY) : null
    if (hit === 'head') {
      // 戳头 = 互动反馈(气泡 + 缩头小动作), 不打开输入框
      if (window.pet3d) window.pet3d.setPoke()
      var line = cfg.lines && cfg.lines.length ? cfg.lines[Math.floor(Math.random() * cfg.lines.length)] : '嗯？'
      say(line)
    } else {
      openChat()
    }
  })

  document.body.addEventListener('dblclick', function () { window.petIpc.invoke('pet:open-main') })

  document.body.addEventListener('contextmenu', function (ev) {
    ev.preventDefault()
    window.petIpc.invoke('pet:menu')
  })

  document.body.addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return
    dragging = true
    moved = false
    dragStart = { mx: ev.screenX, my: ev.screenY }
    if (window.pet3d) window.pet3d.setDragging(true)
    window.petIpc.invoke('pet:drag-start', dragStart)
  })

  window.addEventListener('mouseup', function (ev) {
    if (!dragging || !dragStart) return
    dragging = false
    var dx = ev.screenX - dragStart.mx
    var dy = ev.screenY - dragStart.my
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true
    if (window.pet3d) window.pet3d.setDragging(false)
    window.petIpc.invoke('pet:drag-end')
    if (pendingAnchor) { var a = pendingAnchor; pendingAnchor = null; applyAnchor(a) }
  })

  chatInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); sendChat() }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeChat() }
  })
  chatSend.addEventListener('click', function (ev) {
    ev.stopPropagation()
    sendChat()
  })
  chatBox.addEventListener('mousedown', function (ev) { ev.stopPropagation() })
  window.addEventListener('blur', function () { if (chatBox.classList.contains('on')) closeChat() })
})()
