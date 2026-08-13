/* global window, document */
(function () {
  var cfg = { agent: '黄泉', bubble: true, lines: [] }
  var figure = document.getElementById('figure')
  var bubble = document.getElementById('bubble')
  var nameEl = document.getElementById('name')
  var idleTimer = null
  var bubbleTimer = null
  var dragging = false
  var dragStart = null

  function say(text) {
    if (!cfg.bubble || !text) return
    bubble.textContent = text
    bubble.classList.add('show')
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(function () { bubble.classList.remove('show') }, 4500)
  }

  function setState(state, text) {
    figure.className = 'figure ' + state
    if (state === 'idle') return
    say(text)
    if (idleTimer) clearTimeout(idleTimer)
    if (state !== 'idle') {
      idleTimer = setTimeout(function () { figure.className = 'figure idle' }, 30000)
    }
  }

  window.petIpc.on('pet:config', function (c) {
    cfg = c || cfg
    nameEl.textContent = cfg.agent || '黄泉'
    var accents = { 黄泉: '239,68,68', 姬子: '244,162,97', 三月七: '150,206,229', 银狼: '129,140,248', 艾丝妲: '251,191,36', 知更鸟: '236,72,153', 黑天鹅: '167,139,250', 螺丝咕姆: '110,231,183' }
    var rgb = accents[cfg.agent] || '239,68,68'
    document.documentElement.style.setProperty('--accent', 'rgb(' + rgb + ')')
    document.documentElement.style.setProperty('--accent-rgb', rgb)
    document.body.style.opacity = String(cfg.opacity != null ? cfg.opacity : 0.9)
  })

  window.petIpc.on('pet:event', function (e) {
    if (!e || e.event !== 'state') return
    setState(e.payload && e.payload.state, e.payload && e.payload.text)
  })

  figure.addEventListener('click', function () {
    var lines = cfg.lines && cfg.lines.length ? cfg.lines : ['主人，我在']
    say(lines[Math.floor(Math.random() * lines.length)])
  })

  figure.addEventListener('dblclick', function () { window.petIpc.invoke('pet:open-main') })

  figure.addEventListener('contextmenu', function (ev) {
    ev.preventDefault()
    window.petIpc.invoke('pet:menu')
  })

  figure.addEventListener('mousedown', function (ev) {
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
