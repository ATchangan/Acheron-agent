/* global window, document, performance */
/* 式神桌宠 3D 层 — v0.4.2
 * three.js(r158, 与 sr.ycl.cool 同版本链路) + MMDLoader 加载 PMX:
 *   正常形态  models/46/index.pmx
 *   大招形态  models/46_iswhite/index.pmx
 * 待机: 程序化骨骼动画(呼吸/手臂微摆/张望/重心转移/眨眼) + ammo 物理头发
 * 动作: 站内公开 VMD(极乐净土/彩虹节拍/Good Time), MMDAnimationHelper 播片 + 物理共存
 */
import * as THREE from 'three'
import { MMDLoader } from 'three/loaders/MMDLoader.js'
import { MMDAnimationHelper } from 'three/animation/MMDAnimationHelper.js'

// three r158 对 0 个 morphTarget 的网格会上传空数组, 触发 WebGL INVALID_VALUE 刷屏:
// 空数组上传本身无意义, 静默跳过。WebGL1/WebGL2 各有自己的原型方法, 需分别包装(仅本页生效)
{
  const patch = (proto) => {
    for (const name of ['uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv']) {
      const orig = proto[name]
      proto[name] = function (loc, v) {
        if (!v || v.length === 0) return
        return orig.call(this, loc, v)
      }
    }
  }
  patch(WebGLRenderingContext.prototype)
  if (typeof WebGL2RenderingContext !== 'undefined') patch(WebGL2RenderingContext.prototype)
}

const FOLDERS = { normal: '46', ultimate: '46_iswhite' }
const BASE_YAW = 0.42 // 约 24°, 3/4 侧脸
const ACTIONS = { idle: null, dance1: '1.vmd', dance2: '2.vmd', dance3: '3.vmd' }
const state = { form: 'normal', status: 'idle', action: 'idle' }

const canvas = document.getElementById('stage')
const glow = document.getElementById('glow')

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'low-power',
  preserveDrawingBuffer: true,
})
renderer.setClearColor(0x000000, 0)
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500)
camera.position.set(0, 11, 55)

// MMD 卡通材质对平行光敏感: 主光 + 暖色补光 + 大招红光
const key = new THREE.DirectionalLight(0xfff4ec, 1.35)
key.position.set(14, 22, 18)
const fill = new THREE.DirectionalLight(0xffe2d0, 0.55)
fill.position.set(-16, -4, 12)
const rim = new THREE.DirectionalLight(0xff3b4d, 0)
rim.position.set(0, 12, 25) // 相机侧: 大招红气场打在可见面
const ambient = new THREE.AmbientLight(0xffffff, 0.5)
scene.add(key, fill, rim, ambient)

const root = new THREE.Group() // 旋转 + 起伏 + 跳舞时居中补偿
const pivot = new THREE.Group() // 平移居中
root.add(pivot)
scene.add(root)

const loader = new MMDLoader()
const helper = new MMDAnimationHelper()

let loadedForm = null
let loadingForm = null
let bodyMesh = null
let clockT = 0
let hopUntil = 0
let shakeUntil = 0
let blinkTimer = 2 + Math.random() * 3
let blinkUntil = -1
let danceLoading = null
const clock = new THREE.Clock()

const restPose = new Map() // Bone -> {rx,ry,rz,px,py,pz}
let boneByName = new Map()

function disposeMesh(mesh) {
  if (!mesh) return
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const mat of mats) {
      if (!mat) continue
      for (const v of Object.values(mat)) {
        if (v && v.isTexture) v.dispose()
      }
      mat.dispose()
    }
  })
}

function clearModel() {
  if (bodyMesh) { try { helper.remove(bodyMesh) } catch (_) { /* 忽略 */ } disposeMesh(bodyMesh); bodyMesh = null }
  while (pivot.children.length) pivot.remove(pivot.children[0])
  pivot.position.set(0, 0, 0)
  restPose.clear()
  boneByName = new Map()
}

function centerAndFrame() {
  if (!bodyMesh) return
  root.rotation.y = 0
  root.updateMatrixWorld(true)
  const localBox = new THREE.Box3().setFromObject(root)
  const lc = localBox.getCenter(new THREE.Vector3())
  pivot.position.set(-lc.x, 0, -lc.z)

  root.rotation.y = BASE_YAW
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
  const distH = size.y / (2 * Math.tan(fov / 2))
  const fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect)
  const distW = size.x / (2 * Math.tan(fovH / 2))
  const dist = Math.max(distH, distW) * 1.07
  camera.position.set(0, center.y, dist + Math.max(size.z, 1) / 2)
  camera.lookAt(0, center.y, 0)
  camera.updateProjectionMatrix()
}

function captureRestPose(mesh) {
  restPose.clear()
  boneByName = new Map()
  mesh.traverse((o) => {
    if (!o.isBone) return
    restPose.set(o, { rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, px: o.position.x, py: o.position.y, pz: o.position.z })
    boneByName.set(o.name, o)
  })
}

function resetPose() {
  if (!bodyMesh) return
  for (const [bone, rest] of restPose) {
    bone.rotation.set(rest.rx, rest.ry, rest.rz)
    bone.position.set(rest.px, rest.py, rest.pz)
  }
  if (bodyMesh.morphTargetInfluences) bodyMesh.morphTargetInfluences.fill(0)
}

function bone(name) {
  return boneByName.get(name) || null
}

// 待机: 在 rest 姿态上叠加小幅正弦, 呼吸/手臂/张望/重心
function applyIdlePose(t) {
  const breathe = Math.sin(t * Math.PI * 2 * 0.24)
  const arms = Math.sin(t * Math.PI * 2 * 0.11)
  const head = Math.sin(t * Math.PI * 2 * 0.09 + 1.2)
  const look = Math.sin(t * Math.PI * 2 * 0.045)
  const shift = Math.sin(t * Math.PI * 2 * 0.07)

  const rot = (name, rx, ry, rz) => {
    const b = bone(name)
    if (!b || !restPose.has(b)) return
    const r = restPose.get(b)
    b.rotation.set(r.rx + rx, r.ry + ry, r.rz + rz)
  }
  const pos = (name, px, py, pz) => {
    const b = bone(name)
    if (!b || !restPose.has(b)) return
    const r = restPose.get(b)
    b.position.set(r.px + px, r.py + py, r.pz + pz)
  }

  rot('上半身', 0.018 * breathe, 0.012 * look, 0.004 * shift)
  rot('首', 0.03 * head + 0.012 * breathe, 0.07 * look, 0.01 * shift)
  rot('頭', 0.015 * breathe + 0.012 * head, 0.02 * look, 0)
  rot('右腕', 0.05 * arms + 0.025, 0.012 * shift, 0.02 * arms)
  rot('左腕', -0.05 * arms + 0.025, -0.012 * shift, -0.02 * arms)
  rot('右ひじ', -0.09 - 0.03 * arms, 0, 0)
  rot('左ひじ', -0.09 + 0.03 * arms, 0, 0)
  pos('センター', 0.18 * shift, 0.02 * breathe, 0)
  pos('腰', 0.1 * shift, 0.012 * breathe, 0)
}

// 待机眨眼(随机 2~6 秒一次), 仅待机时驱动 morph, 跳舞时表情交给 VMD
function updateBlink(dt) {
  if (state.action !== 'idle' || !bodyMesh) return
  blinkTimer -= dt
  if (blinkTimer <= 0) {
    blinkTimer = 2.2 + Math.random() * 3.6
    blinkUntil = clockT + 0.13
  }
  const dict = bodyMesh.morphTargetDictionary
  if (!dict) return
  const idx = dict['まばたき']
  if (idx === undefined || !bodyMesh.morphTargetInfluences) return
  bodyMesh.morphTargetInfluences[idx] = clockT < blinkUntil ? 1 : 0
}

function helperPhysicsOnly() {
  if (!bodyMesh) return
  try { helper.remove(bodyMesh) } catch (_) { /* 忽略 */ }
  if (window.__ammoReady) {
    try { helper.add(bodyMesh, { physics: true }) } catch (_) { /* 无物理骨架也照常渲染 */ }
  }
}

function playDance(name, force = false) {
  const next = ACTIONS[name] !== undefined ? name : 'idle'
  if (next === state.action && !force) return
  state.action = next
  resetPose()
  danceLoading = null
  if (next === 'idle') { helperPhysicsOnly(); return }

  danceLoading = next
  loader.loadAnimation(
    `actions/${ACTIONS[next]}`,
    bodyMesh,
    (clip) => {
      if (state.action !== next) return
      danceLoading = null
      try { helper.remove(bodyMesh) } catch (_) { /* 忽略 */ }
      try { helper.add(bodyMesh, { animation: clip, physics: true }) } catch (_) { /* 忽略 */ }
    },
    undefined,
    (err) => {
      danceLoading = null
      console.warn('动作加载失败:', next, err)
      if (state.action === next) playDance('idle')
    },
  )
}

function setAction(name) {
  if (!bodyMesh) { state.action = ACTIONS[name] !== undefined ? name : 'idle'; return }
  playDance(name)
}

// 跳舞时把重心(センター)锁定在画面中心, 避免滑步/位移把角色带出窗口
function centerDance() {
  if (state.action === 'idle' || !bodyMesh) return
  const c = bone('センター')
  if (!c) return
  c.updateWorldMatrix(true, false)
  const w = c.getWorldPosition(new THREE.Vector3())
  root.position.x -= w.x
  root.position.z -= w.z
}

function loadForm(form) {
  if (loadingForm === form || loadedForm === form) return
  loadingForm = form
  clearModel()
  const folder = FOLDERS[form] || FOLDERS.normal

  loader.load(
    `models/${folder}/index.pmx`,
    (mesh) => {
      if (state.form !== form) { disposeMesh(mesh); return }
      bodyMesh = mesh
      pivot.add(mesh)
      captureRestPose(mesh)
      loadedForm = form
      loadingForm = null
      centerAndFrame()
      if (state.action === 'idle') helperPhysicsOnly()
      else playDance(state.action, true)
    },
    undefined,
    (err) => {
      loadingForm = null
      console.warn('式神模型加载失败:', err)
      document.dispatchEvent(new CustomEvent('pet3d-error'))
    },
  )
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.1)
  clockT += dt
  helper.update(dt)

  const status = state.status
  if (state.action === 'idle') {
    applyIdlePose(clockT)
    updateBlink(dt)
    let swayFreq = 0.45
    let swayAmp = 0.11
    let bob = 0.14
    if (status === 'thinking') { swayFreq = 1.05; swayAmp = 0.16; bob = 0.24 }
    else if (status === 'working') { swayFreq = 1.75; swayAmp = 0.2; bob = 0.38 }
    else if (status === 'error') { swayFreq = 0.2; swayAmp = 0.04; bob = 0.1 }
    root.rotation.y = BASE_YAW + Math.sin(clockT * swayFreq * Math.PI * 2) * swayAmp
    root.position.y = Math.sin(clockT * 0.8 * Math.PI * 2) * bob
  } else {
    root.rotation.y = BASE_YAW
    root.position.y = 0
    centerDance()
  }

  const now = performance.now()
  if (now < hopUntil) {
    const p = (hopUntil - now) / 900
    root.position.y += Math.abs(Math.sin((1 - p) * Math.PI * 2)) * 1.6 * p
  }
  let zrot = 0
  if (now < shakeUntil) {
    const p = (shakeUntil - now) / 700
    zrot = Math.sin(now * 0.09) * 0.08 * p
  }
  root.rotation.z = zrot

  const rimTarget = state.form === 'ultimate' ? (status === 'working' ? 1.1 : 0.62) : 0
  rim.intensity += (rimTarget - rim.intensity) * 0.08
  glow.style.opacity = state.form === 'ultimate' ? String(Math.min(0.62, 0.3 + Math.abs(Math.sin(clockT * 1.8)) * 0.32)) : '0'

  renderer.render(scene, camera)
}

function setStatus(status) {
  state.status = status || 'idle'
  if (status === 'done') hopUntil = performance.now() + 900
  if (status === 'error') shakeUntil = performance.now() + 700
}

function setForm(form) {
  const next = form === 'ultimate' ? 'ultimate' : 'normal'
  if (next === state.form) return
  state.form = next
  loadForm(next)
}

function resize() {
  const w = Math.max(window.innerWidth, 1)
  const h = Math.max(window.innerHeight, 1)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  centerAndFrame()
}

async function initAmmo() {
  try {
    // 该 ammo 构建在 file:// 下拒绝 fetch wasm 且主线程无同步回退:
    // 先自行取 wasm 二进制, 以 wasmBinary 注入后动态加载脚本
    const wasmResp = await fetch('vendor/libs/ammo.wasm.wasm')
    if (!wasmResp.ok) throw new Error('wasm fetch ' + wasmResp.status)
    const bin = await wasmResp.arrayBuffer()
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'vendor/libs/ammo.wasm.js'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('ammo script load failed'))
      document.head.appendChild(s)
    })
    const factory = window.Ammo
    if (typeof factory !== 'function') throw new Error('ammo factory missing')
    // 工厂函数: 以 { wasmBinary } 注入内存态 wasm, 返回 b.ready 并把 window.Ammo 置为模块
    const ready = factory({ wasmBinary: bin })
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 8000))
    await Promise.race([ready, timeout])
    window.__ammoReady = !!window.Ammo && !!window.Ammo.btVector3
  } catch (e) {
    console.warn('式神物理引擎初始化失败(降级为静态头发):', e && e.message ? e.message : e)
    window.__ammoReady = false
  }
}

async function boot() {
  await initAmmo()
  loadForm(state.form)
  animate()
}

window.addEventListener('resize', resize)
window.pet3d = { setStatus, setForm, setAction, resize }

resize()
void boot()
