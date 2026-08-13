/* global window, document, performance */
/* 式神桌宠 3D 层 — v0.4.0
 * three.js(r158, 与 sr.ycl.cool 同版本链路) + MMDLoader 加载 PMX:
 *   正常形态  models/46/index.pmx
 *   大招形态  models/46_iswhite/index.pmx
 * 待机: 程序化"自然"动画(多层噪声呼吸 / 随机张望 / 随机小动作 / 平滑眨眼) + ammo 头发物理
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

// ---------- 小工具 ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (t) => t * t * (3 - 2 * t)
// 多层互质频率正弦叠加 → 近似有机噪声, 避免单频机械感(相位随机, 每次启动都不同)
const makeOrganic = () => {
  const p = [0, 0, 0].map(() => Math.random() * Math.PI * 2)
  return (t, f1, a1, f2, a2, f3, a3) =>
    a1 * Math.sin(t * f1 * Math.PI * 2 + p[0]) +
    a2 * Math.sin(t * f2 * Math.PI * 2 + p[1]) +
    a3 * Math.sin(t * f3 * Math.PI * 2 + p[2])
}
const org = makeOrganic()

const FOLDERS = { normal: '46', ultimate: '46_iswhite' }
const BASE_YAW = 0.42 // 约 24°, 3/4 侧脸
const ACTIONS = { idle: null, dance1: '1.vmd', dance2: '2.vmd', dance3: '3.vmd' }
const state = { form: 'normal', status: 'idle', action: 'idle' }

// 状态 → 摆动/呼吸节奏目标(逐帧平滑过渡, 避免参数跳变)
const STATUS_PARAMS = {
  idle: { sway: 0.032, swayF: 0.045, breathMul: 1, headRate: 1 },
  thinking: { sway: 0.05, swayF: 0.16, breathMul: 1.3, headRate: 2.4 },
  working: { sway: 0.025, swayF: 0.22, breathMul: 1.5, headRate: 3.2 },
  done: { sway: 0.032, swayF: 0.045, breathMul: 1, headRate: 1 },
  error: { sway: 0.018, swayF: 0.03, breathMul: 0.9, headRate: 1 },
}
const curParams = { ...STATUS_PARAMS.idle }

const canvas = document.getElementById('stage')
const glow = document.getElementById('glow')
const shadowEl = document.getElementById('shadow')

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

const root = new THREE.Group() // 站姿微摆 + 完成弹跳 + 出错抖动 + 跳舞居中补偿
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
let danceLoading = null
const clock = new THREE.Clock()

const restPose = new Map() // Bone -> {rx,ry,rz,px,py,pz}
let boneByName = new Map()
const scratch = new Map() // 每帧骨骼偏移累加器
let talkUntil = -1
const look = { targetYaw: 0, targetPitch: 0, yaw: 0, pitch: 0 }

// ---------- 随机张望(头部目标导向, 而非机械摆动) ----------
const headMotion = { next: 0, t0: 0, dur: 1, hold: 1, sYaw: 0, sPitch: 0, tYaw: 0, tPitch: 0, cYaw: 0, cPitch: 0 }
function planHead(now) {
  headMotion.next = now + (4 + Math.random() * 7) / curParams.headRate
  headMotion.sYaw = headMotion.cYaw
  headMotion.sPitch = headMotion.cPitch
  headMotion.tYaw = (Math.random() - 0.5) * 0.26
  headMotion.tPitch = (Math.random() - 0.5) * 0.1 - 0.015
  headMotion.t0 = now
  headMotion.dur = 0.9 + Math.random() * 1.3
  headMotion.hold = 1.4 + Math.random() * 3.2
}
function updateHead(now) {
  if (now >= headMotion.next) planHead(now)
  const move = clamp01((now - headMotion.t0) / headMotion.dur)
  const eased = move >= 1 ? 1 : smoothstep(move)
  headMotion.cYaw = lerp(headMotion.sYaw, headMotion.tYaw, eased)
  headMotion.cPitch = lerp(headMotion.sPitch, headMotion.tPitch, eased)
}

// ---------- 随机小动作(抬头/歪头/左右看/理袖子) ----------
const GESTURES = [
  { d: 1.6, bones: [['首', 0, -0.17, 0], ['頭', 0, -0.07, 0]] },
  { d: 2.1, bones: [['首', 0, 0, 0.15], ['頭', 0, 0, 0.06]] },
  { d: 1.8, bones: [['首', 0, 0.36, 0], ['頭', 0, 0.12, 0]] },
  { d: 1.8, bones: [['首', 0, -0.36, 0], ['頭', 0, -0.12, 0]] },
  { d: 2.3, bones: [['右腕', -0.5, 0, 0.05], ['右ひじ', -0.28, 0, 0], ['左腕', 0.09, 0, 0]] },
]
let gesture = null
let gestureNext = 8 + Math.random() * 10

function updateGesture(now) {
  if (!gesture && now >= gestureNext && state.action === 'idle') {
    gesture = { def: GESTURES[Math.floor(Math.random() * GESTURES.length)], t0: now }
    gestureNext = now + 13 + Math.random() * 18
  }
  if (!gesture) return
  const p = (now - gesture.t0) / gesture.def.d
  if (p >= 1) { gesture = null; return }
  // 缓入-保持-缓出包络
  const env = p < 0.3 ? smoothstep(p / 0.3) : p < 0.68 ? 1 : 1 - smoothstep((p - 0.68) / 0.32)
  for (const [name, rx, ry, rz] of gesture.def.bones) addRot(name, rx * env, ry * env, rz * env)
}

// ---------- 平滑眨眼(闭合~40% 时长, 睁开更慢; 偶尔连续双眨) ----------
let blinkTimer = 1.8 + Math.random() * 3
let blinkPattern = [0.24]
let blinkIdx = -1
let blinkT0 = 0
let blinkWeight = 0
function updateBlink(dt) {
  blinkTimer -= dt
  if (blinkIdx < 0 && blinkTimer <= 0) {
    blinkIdx = 0
    blinkPattern = Math.random() < 0.16 ? [0.24, 0.3, 0.26] : [0.24]
    blinkT0 = clockT
    blinkTimer = 2.1 + Math.random() * 4.6 + (state.status === 'thinking' ? 0.8 : 0)
  }
  if (blinkIdx < 0) { blinkWeight = 0; return }
  const p = (clockT - blinkT0) / blinkPattern[blinkIdx]
  blinkWeight = p < 0.4 ? smoothstep(p / 0.4) : 1 - smoothstep(clamp01((p - 0.4) / 0.6))
  if (p >= 1) {
    blinkIdx += 1
    blinkT0 = clockT
    if (blinkIdx >= blinkPattern.length) blinkIdx = -1
  }
}

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
  // Q版化(骨骼缩放)后几何包围盒不含放大, 用骨骼位置做近似补偿:
  // 头顶向上抬 + 头宽/深向外扩, 保证放大的头部不裁出画面
  const box = new THREE.Box3().setFromObject(root)
  const neckBone = bone('首')
  const headBone = bone('頭')
  if (neckBone && headBone) {
    const neckY = neckBone.getWorldPosition(new THREE.Vector3()).y
    const headH = Math.max(box.max.y - neckY, 1)
    const grow = 0.26
    box.max.y = neckY + headH * (1 + grow)
    const halfW = (box.max.x - box.min.x) / 2
    box.max.x += halfW * grow * 0.45
    box.min.x -= halfW * grow * 0.45
    const halfD = (box.max.z - box.min.z) / 2
    box.max.z += halfD * grow * 0.25
    box.min.z -= halfD * grow * 0.25
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
  const distH = size.y / (2 * Math.tan(fov / 2))
  const fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect)
  const distW = size.x / (2 * Math.tan(fovH / 2))
  const dist = Math.max(distH, distW) * 1.14
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

// Q 版化: 头(含全部头发/发饰/眼睛, 均挂在「頭」下)整体放大, 躯干缩短(不动腿部 IK 链), 脖子稍加长衔接
function applyChibi() {
  const head = bone('頭')
  if (head) head.scale.set(1.26, 1.26, 1.26)
  const upper = bone('上半身')
  if (upper) upper.scale.set(1, 0.88, 1)
  const neck = bone('首')
  if (neck) neck.scale.set(1, 1.18, 1)
}

function addRot(name, rx, ry, rz) {
  const b = bone(name)
  if (!b || !restPose.has(b)) return
  const o = scratch.get(b) || { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 }
  o.rx += rx; o.ry += ry; o.rz += rz
  scratch.set(b, o)
}

function addPos(name, px, py, pz) {
  const b = bone(name)
  if (!b || !restPose.has(b)) return
  const o = scratch.get(b) || { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 }
  o.px += px; o.py += py; o.pz += pz
  scratch.set(b, o)
}

function commitPose() {
  for (const [b, o] of scratch) {
    const r = restPose.get(b)
    b.rotation.set(r.rx + o.rx, r.ry + o.ry, r.rz + o.rz)
    b.position.set(r.px + o.px, r.py + o.py, r.pz + o.pz)
  }
  scratch.clear()
}

// 待机主姿态: 呼吸(躯干/肩/头联动) + 手臂微摆 + 重心随机游走 + 张望 + 小动作 + 眨眼
let lastBreathe = 0
function applyIdlePose(now, dt) {
  if (!bodyMesh) return
  // 状态参数平滑过渡
  const target = STATUS_PARAMS[state.status] || STATUS_PARAMS.idle
  for (const k of Object.keys(curParams)) curParams[k] = lerp(curParams[k], target[k], Math.min(1, dt * 2.2))
  const tm = now * curParams.breathMul

  // 呼吸: 主频 + 两层微扰, 躯干带动肩与头
  const breathe = org(tm, 0.24, 0.62, 0.09, 0.24, 0.37, 0.14)
  lastBreathe = breathe
  addRot('上半身', breathe * 0.017, org(tm, 0.05, 0.009, 0.03, 0.004, 0.11, 0.003), org(tm, 0.07, 0.003, 0.04, 0.002, 0.15, 0.002))
  addRot('首', breathe * 0.008, 0, 0)
  addRot('頭', breathe * 0.005, 0, 0)
  addRot('右肩', breathe * 0.0045, 0, 0)
  addRot('左肩', breathe * 0.0045, 0, 0)

  // 手臂: 反相低频微摆 + 各自噪声, 不齐步才自然
  const armBase = org(now, 0.105, 0.5, 0.046, 0.26, 0.18, 0.14)
  const armR = armBase + org(now, 0.03, 0.18, 0.02, 0.12, 0.05, 0.08)
  const armL = -armBase + org(now, 0.033, 0.18, 0.021, 0.12, 0.047, 0.08)
  addRot('右腕', 0.028 + armR * 0.036, org(now, 0.04, 0.012, 0.02, 0.006, 0.07, 0.004), org(now, 0.05, 0.018, 0.025, 0.009, 0.08, 0.005))
  addRot('左腕', 0.028 + armL * 0.036, -org(now, 0.04, 0.012, 0.02, 0.006, 0.07, 0.004), -org(now, 0.05, 0.018, 0.025, 0.009, 0.08, 0.005))
  addRot('右ひじ', -0.085 - armR * 0.02, 0, 0)
  addRot('左ひじ', -0.085 - armL * 0.02, 0, 0)

  // 重心: 慢速随机游走(多层低频噪声)
  addPos('センター', org(now, 0.07, 0.6, 0.03, 0.26, 0.13, 0.14) * 0.15, org(now, 0.12, 0.45, 0.05, 0.22, 0.21, 0.1) * 0.012, 0)
  addPos('腰', org(now, 0.07, 0.6, 0.03, 0.26, 0.13, 0.14) * 0.09, org(now, 0.12, 0.45, 0.05, 0.22, 0.21, 0.1) * 0.008, 0)

  // 随机张望 + 随机小动作(手势期间暂停张望, 避免打架)
  if (!gesture) {
    updateHead(now)
    addRot('首', 0, headMotion.cYaw + look.yaw, 0)
    addRot('頭', headMotion.cPitch * 0.6 + look.pitch, headMotion.cYaw * 0.4, 0)
  }
  updateGesture(now)

  commitPose()

  // 眨眼 + 说话嘴型(morph)
  updateBlink(dt)
  const dict = bodyMesh.morphTargetDictionary
  if (dict && bodyMesh.morphTargetInfluences) {
    const blinkIdx = dict['まばたき']
    if (blinkIdx !== undefined) bodyMesh.morphTargetInfluences[blinkIdx] = blinkWeight
    const mouthIdx = dict['あ']
    if (mouthIdx !== undefined) {
      const talk = now < talkUntil ? Math.abs(Math.sin(now * 14)) * 0.42 : 0
      bodyMesh.morphTargetInfluences[mouthIdx] = talk
    }
  }

  // 脚下阴影随呼吸微缩
  if (shadowEl) {
    const s = 1 + breathe * 0.018
    shadowEl.style.opacity = String(0.3 - breathe * 0.015)
    shadowEl.style.transform = `translateX(-50%) scale(${s.toFixed(3)})`
  }
}

// 目光跟随: 鼠标在桌宠窗口上时头部微微朝向光标, 移开后缓慢回正
function updateLook() {
  look.yaw = lerp(look.yaw, look.targetYaw, 0.12)
  look.pitch = lerp(look.pitch, look.targetPitch, 0.12)
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

function setTalk() {
  talkUntil = clockT + 1.4
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
      applyChibi()
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
    applyIdlePose(clockT, dt)
    updateLook()
    // 站姿微摆: 慢速有机噪声, 而非固定正弦
    root.rotation.y = BASE_YAW + org(clockT, curParams.swayF, curParams.sway, curParams.swayF * 0.61, curParams.sway * 0.45, curParams.swayF * 1.7, curParams.sway * 0.22)
    root.position.y = 0
  } else {
    root.rotation.y = BASE_YAW
    root.position.y = 0
    if (shadowEl) { shadowEl.style.opacity = '0.3'; shadowEl.style.transform = 'translateX(-50%) scale(1)' }
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
    const ok = await Promise.race([ready.then(() => true), timeout])
    // asm 是 wasm 实例导出挂载点: 只有真正编译成功才会存在(btVector3 之类的 JS stub 不算)
    window.__ammoReady = ok === true && !!window.Ammo && !!window.Ammo.asm
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
window.pet3d = {
  setStatus, setForm, setAction, setTalk, resize,
  debug: () => {
    const g = bodyMesh && bodyMesh.geometry
    let nan = 0
    if (g && g.attributes.position) {
      const a = g.attributes.position.array
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nan++
    }
    return { bodyMesh: !!bodyMesh, loadedForm, loadingForm, pivotChildren: pivot.children.length, posNaN: nan, camZ: camera.position.z }
  },
}

// 目光跟随鼠标(仅待机时生效)
canvas.addEventListener('mousemove', (ev) => {
  const w = canvas.clientWidth || 1
  const h = canvas.clientHeight || 1
  look.targetYaw = (ev.clientX / w - 0.5) * 2 * 0.1
  look.targetPitch = -(ev.clientY / h - 0.5) * 2 * 0.07
})
canvas.addEventListener('mouseleave', () => { look.targetYaw = 0; look.targetPitch = 0 })

resize()
void boot()
