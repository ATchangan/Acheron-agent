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
const state = { form: 'normal', status: 'idle', action: 'idle', anchor: 'float', dragging: false }
// 可调参数(设置页自由调节, 默认与 v0.4.0 行为一致)
const options = { look: true, physics: true, breath: 'normal', gesture: 'normal', chibi: 1 }
const BREATH_MUL = { light: 0.55, normal: 1, strong: 1.5 }
const GESTURE_MUL = { low: 2.2, normal: 1, high: 0.55 }

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
// 微风级物理: 默认 MMD 重力为 -98(单位/秒²), 太猛; 降到 1/3 左右让头发/衣摆缓慢轻柔地飘
const BREEZE_GRAVITY = new THREE.Vector3(0, -36, 0)
// three MMDPhysics 创建刚体时没有设置阻尼(PMX 里的阻尼被忽略), 头发会无衰减高频摆动;
// 这里补上阻尼, 让摆动快速衰减、呈现"随微风轻摆"的效果
function attachPhysics(mesh, animation) {
  helper.add(mesh, animation
    ? { animation, physics: options.physics, gravity: BREEZE_GRAVITY, warmup: 120 }
    : { physics: options.physics, gravity: BREEZE_GRAVITY, warmup: 120 })
  try {
    const ph = helper.objects.get(mesh)?.physics
    if (ph && Array.isArray(ph.bodies)) {
      for (const body of ph.bodies) {
        try { body.setDamping(0.78, 0.96) } catch (_) { /* 忽略 */ }
      }
    }
  } catch (_) { /* 忽略 */ }
}

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
let pokeUntil = -1
let sitFrames = 0
let lastShapeKey = ''
let shapeFrameCount = 0

// ---------- 随机张望(头部目标导向, 而非机械摆动) ----------
const headMotion = { next: 0, t0: 0, dur: 1, hold: 1, sYaw: 0, sPitch: 0, tYaw: 0, tPitch: 0, cYaw: 0, cPitch: 0 }
function planHead(now) {
  headMotion.next = now + (4 + Math.random() * 7) / curParams.headRate
  headMotion.sYaw = headMotion.cYaw
  headMotion.sPitch = headMotion.cPitch
  headMotion.tYaw = (Math.random() - 0.5) * 0.16
  headMotion.tPitch = (Math.random() - 0.5) * 0.07 - 0.012
  headMotion.t0 = now
  headMotion.dur = 1.2 + Math.random() * 1.4
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
  { d: 1.8, bones: [['首', 0, -0.13, 0], ['頭', 0, -0.05, 0]] },
  { d: 2.3, bones: [['首', 0, 0, 0.11], ['頭', 0, 0, 0.04]] },
  { d: 2.0, bones: [['首', 0, 0.2, 0], ['頭', 0, 0.07, 0]] },
  { d: 2.0, bones: [['首', 0, -0.2, 0], ['頭', 0, -0.07, 0]] },
  { d: 2.3, bones: [['右腕', -0.5, 0, 0.05], ['右ひじ', -0.28, 0, 0], ['左腕', 0.09, 0, 0]] },
]
let gesture = null
let gestureNext = 8 + Math.random() * 10

function updateGesture(now) {
  if (!gesture && now >= gestureNext && state.action === 'idle') {
    gesture = { def: GESTURES[Math.floor(Math.random() * GESTURES.length)], t0: now }
    gestureNext = now + (13 + Math.random() * 18) * (GESTURE_MUL[options.gesture] || 1)
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
    const grow = headGrow()
    box.max.y = neckY + headH * (1 + grow)
    const halfW = (box.max.x - box.min.x) / 2
    box.max.x += halfW * grow * 0.6
    box.min.x -= halfW * grow * 0.6
    const halfD = (box.max.z - box.min.z) / 2
    box.max.z += halfD * grow * 0.25
    box.min.z -= halfD * grow * 0.25
  }
  fitCameraToBox(box)
}

function fitCameraToBox(box) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
  const distH = size.y / (2 * Math.tan(fov / 2))
  const fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect)
  const distW = size.x / (2 * Math.tan(fovH / 2))
  const dist = Math.max(distH, distW) * 1.2
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
  const c = Math.max(0, Math.min(1.5, Number(options.chibi) || 0))
  if (head) head.scale.set(1 + 0.26 * c, 1 + 0.26 * c, 1 + 0.26 * c)
  const upper = bone('上半身')
  if (upper) upper.scale.set(1, 1 - 0.12 * c, 1)
  const neck = bone('首')
  if (neck) neck.scale.set(1, 1 + 0.18 * c, 1)
}

function headGrow() {
  return 0.26 * Math.max(0, Math.min(1.5, Number(options.chibi) || 0))
}

// ---------- 坐视窗/坐任务栏(参照 MateEngine 窗口坐立) ----------
// PMX 骨骼链: 腰→(下半身→右足→右ひざ→右足首 / 左足→左ひざ→左足首)
// 待机(无 VMD 动画)时 MMDAnimationHelper 不会跑 IK, 可直接旋转腿骨摆坐姿
const SIT_FRAC = 0.42 // 臀部应落在桌宠窗口高度的 42% 处(主进程按此比例吸附视窗上沿)

function isSitting() {
  return state.anchor === 'window' || state.anchor === 'taskbar'
}

// 只往 scratch 累加坐姿偏移, 由 commitPose 统一应用
function addSitPose(now, breathe) {
  sitFrames += 1
  // 骨盆微前倾 + 背稍后靠, 呼吸带动躯干
  addRot('腰', -0.18 + breathe * 0.008, 0, 0)
  addRot('下半身', 0.05 + breathe * 0.006, 0, 0)
  addRot('上半身', -0.12 - breathe * 0.011, 0, 0)
  addRot('上半身1', -0.03, 0, 0)

  // 头: 保留张望与目光跟随, 幅度略收
  if (!gesture) updateHead(now)
  addRot('首', 0.06 + breathe * 0.004, headMotion.cYaw * 0.5 + look.yaw, 0)
  addRot('頭', headMotion.cPitch * 0.6 + look.pitch, headMotion.cYaw * 0.4, 0)

  // 大腿前伸、小腿自然垂下, 双腿交替极轻的晃动(像真的坐在边沿)
  const legSway = org(now, 0.05, 0.045, 0.03, 0.02, 0.09, 0.012)
  addRot('右足', -1.38 + legSway, 0, 0)
  addRot('左足', -1.38 - legSway, 0, 0)
  // 小腿略向前倾而不是完全垂直, 摆动幅度稍大, 避免"笔直僵硬"
  addRot('右ひざ', 1.33 - legSway * 1.1, 0, 0)
  addRot('左ひざ', 1.33 + legSway * 1.1, 0, 0)
  const ankleR = org(now, 0.06, 0.03, 0.04, 0.015, 0.11, 0.008)
  addRot('右足首', -0.12 + ankleR, 0, 0)
  addRot('左足首', -0.12 - ankleR, 0, 0)

  // 手搭在膝上/窗沿, 微微呼吸
  const handR = org(now, 0.04, 0.03, 0.03, 0.015, 0.08, 0.006)
  addRot('右腕', -0.85 + handR, 0, 0.08)
  addRot('左腕', -0.85 - handR, 0, -0.08)
  addRot('右ひじ', -0.62, 0, 0)
  addRot('左ひじ', -0.62, 0, 0)

  // 被戳到: 缩一下头
  if (clockT < pokeUntil) addRot('頭', -0.16, 0, 0)

  // 被拖动: 手臂略抬, 像被轻轻拎起(坐姿保持到松手)
  if (state.dragging) {
    addRot('右腕', -1.15, 0, 0.18)
    addRot('左腕', -1.15, 0, -0.18)
    addRot('右ひじ', -0.4, 0, 0)
    addRot('左ひじ', -0.4, 0, 0)
  }
}

// 坐姿构图: 先摆好坐姿再量包围盒, 然后把臀部精确压到画布 42% 高度
function frameSit() {
  if (!bodyMesh) return
  resetPose()
  scratch.clear()
  addSitPose(0, 0)
  commitPose()
  root.rotation.y = BASE_YAW
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const neckBone = bone('首')
  const headBone = bone('頭')
  if (neckBone && headBone) {
    const neckY = neckBone.getWorldPosition(new THREE.Vector3()).y
    const headH = Math.max(box.max.y - neckY, 1)
    const grow = headGrow()
    box.max.y = neckY + headH * (1 + grow)
  }
  fitCameraToBox(box)

  const hip = bone('下半身') || bone('腰')
  if (hip) {
    hip.updateWorldMatrix(true, false)
    // Vector3.project 依赖 camera.matrixWorldInverse, 手动刷新(此时还没进渲染循环)
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    const v = hip.getWorldPosition(new THREE.Vector3())
    const ndc = v.project(camera)
    const H = Math.max(canvas.clientHeight, 1)
    const screenY = (1 - ndc.y) / 2 * H
    const desired = H * SIT_FRAC
    const fov = THREE.MathUtils.degToRad(camera.fov)
    const fpx = H / (2 * Math.max(camera.position.z, 1) * Math.tan(fov / 2))
    pivot.position.y += (screenY - desired) / fpx
  }
  resetPose()
  scratch.clear()
}

function reframe() {
  if (!bodyMesh) return
  if (isSitting()) frameSit()
  else centerAndFrame()
}

// 坐视窗/坐任务栏: 把原生窗口命中区域收缩到角色轮廓内,
// 其余透明区域鼠标点击穿透到下面的窗口(MateEngine 的窗口坐立体验关键)
function updateShape() {
  if (!isSitting() || !bodyMesh || !window.petIpc) return
  root.updateMatrixWorld(true)
  bodyMesh.updateMatrixWorld(true)
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  const box = new THREE.Box3().setFromObject(root)
  const corners = []
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
    }
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const c of corners) {
    const v = c.project(camera)
    const sx = (v.x * 0.5 + 0.5) * canvas.clientWidth
    const sy = (0.5 - v.y * 0.5) * canvas.clientHeight
    minX = Math.min(minX, sx); minY = Math.min(minY, sy)
    maxX = Math.max(maxX, sx); maxY = Math.max(maxY, sy)
  }
  const pad = 6
  // 量化到 6px 网格: 呼吸/微风引起的包围盒抖动不触发频繁 IPC
  const q = (v) => Math.round(v / 6) * 6
  const x = Math.max(0, q(minX - pad))
  const y = Math.max(0, q(minY - pad))
  const w = Math.min(canvas.clientWidth - x, q(maxX - minX + pad * 2))
  const h = Math.min(canvas.clientHeight - y, q(maxY - minY + pad * 2))
  if (w < 8 || h < 8) return
  const key = `${x},${y},${w},${h}`
  if (key === lastShapeKey) return
  lastShapeKey = key
  void window.petIpc.invoke('pet:shape', { x, y, width: w, height: h })
}

// 点击射线: 命中头部(颈以上)返回 'head', 命中身体返回 'body'
const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
function pokeAt(clientX, clientY) {
  if (!bodyMesh) return null
  const w = canvas.clientWidth || 1
  const h = canvas.clientHeight || 1
  pointerNdc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1)
  raycaster.setFromCamera(pointerNdc, camera)
  bodyMesh.updateMatrixWorld(true)
  const hits = raycaster.intersectObject(bodyMesh, true)
  if (!hits.length) return null
  const neck = bone('首') || bone('上半身2')
  if (neck) {
    neck.updateWorldMatrix(true, false)
    const neckY = neck.getWorldPosition(new THREE.Vector3()).y
    return hits[0].point.y >= neckY - 0.25 ? 'head' : 'body'
  }
  return 'body'
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
  const tm = now * curParams.breathMul * (BREATH_MUL[options.breath] || 1)

  // 呼吸: 主频 + 两层微扰, 躯干带动肩与头
  const breathe = org(tm, 0.24, 0.62, 0.09, 0.24, 0.37, 0.14)
  lastBreathe = breathe

  if (isSitting()) {
    // 坐视窗/坐任务栏: 独立坐姿, 不用站立手臂摆动/重心游走
    addSitPose(now, breathe)
    commitPose()
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
    if (shadowEl) shadowEl.style.opacity = '0'
    return
  }

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

  // 被拖动: 双臂张开像被拎起, 身体随主进程移动漂浮
  if (state.dragging) {
    addRot('右腕', -0.9, 0, 0.28)
    addRot('左腕', -0.9, 0, -0.28)
    addRot('右ひじ', -0.34, 0, 0)
    addRot('左ひじ', -0.34, 0, 0)
  }

  // 重心: 慢速随机游走(多层低频噪声)
  addPos('センター', org(now, 0.07, 0.6, 0.03, 0.26, 0.13, 0.14) * 0.07, org(now, 0.12, 0.45, 0.05, 0.22, 0.21, 0.1) * 0.006, 0)
  addPos('腰', org(now, 0.07, 0.6, 0.03, 0.26, 0.13, 0.14) * 0.04, org(now, 0.12, 0.45, 0.05, 0.22, 0.21, 0.1) * 0.004, 0)

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
  if (options.physics && window.__ammoReady) {
    try { attachPhysics(bodyMesh) } catch (_) { /* 无物理骨架也照常渲染 */ }
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
      try { attachPhysics(bodyMesh, clip) } catch (_) { /* 忽略 */ }
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
      reframe()
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
    if (options.look) updateLook()
    // 站姿微摆: 慢速有机噪声, 而非固定正弦
    root.rotation.y = BASE_YAW + org(clockT, curParams.swayF, curParams.sway, curParams.swayF * 0.61, curParams.sway * 0.45, curParams.swayF * 1.7, curParams.sway * 0.22)
    root.position.y = state.dragging ? Math.sin(clockT * 5.2) * 0.42 : 0
    root.rotation.z = state.dragging ? Math.sin(clockT * 3.1) * 0.035 : 0
  } else {
    root.rotation.y = BASE_YAW
    root.position.y = 0
    root.rotation.z = 0
    if (shadowEl) { shadowEl.style.opacity = isSitting() ? '0' : '0.3'; shadowEl.style.transform = 'translateX(-50%) scale(1)' }
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
  root.rotation.z = zrot !== 0 ? zrot : (state.dragging ? Math.sin(clockT * 3.1) * 0.035 : 0)

  const rimTarget = state.form === 'ultimate' ? (status === 'working' ? 1.1 : 0.62) : 0
  rim.intensity += (rimTarget - rim.intensity) * 0.08
  glow.style.opacity = state.form === 'ultimate' ? String(Math.min(0.62, 0.3 + Math.abs(Math.sin(clockT * 1.8)) * 0.32)) : '0'

  renderer.render(scene, camera)
  if (isSitting()) {
    shapeFrameCount += 1
    if (shapeFrameCount % 30 === 0) updateShape()
  }
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

function setAnchor(anchor) {
  const next = anchor === 'window' || anchor === 'taskbar' ? anchor : 'float'
  if (next === state.anchor) return
  state.anchor = next
  document.body.classList.toggle('anchor-window', next === 'window')
  document.body.classList.toggle('anchor-taskbar', next === 'taskbar')
  resetPose()
  reframe()
  lastShapeKey = ''
  updateShape()
}

function setDragging(v) {
  state.dragging = v === true
  if (!state.dragging && state.action === 'idle') resetPose()
}

function setPoke() {
  pokeUntil = clockT + 1.15
}

function setOptions(o) {
  if (!o) return
  let reframeNeeded = false
  let physicsChanged = false
  if (typeof o.look === 'boolean') options.look = o.look
  if (typeof o.physics === 'boolean' && o.physics !== options.physics) { options.physics = o.physics; physicsChanged = true }
  if (o.breath === 'light' || o.breath === 'normal' || o.breath === 'strong') options.breath = o.breath
  if (o.gesture === 'low' || o.gesture === 'normal' || o.gesture === 'high') options.gesture = o.gesture
  if (typeof o.chibi === 'number') {
    options.chibi = Math.max(0, Math.min(1.5, Number(o.chibi)))
    reframeNeeded = true
  }
  if (reframeNeeded && bodyMesh) {
    resetPose()
    applyChibi()
    reframe()
    lastShapeKey = ''
  }
  if (physicsChanged && bodyMesh && state.action === 'idle') helperPhysicsOnly()
}

function resize() {
  const w = Math.max(window.innerWidth, 1)
  const h = Math.max(window.innerHeight, 1)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  reframe()
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
  setStatus, setForm, setAction, setTalk, setAnchor, setDragging, setPoke, setOptions, pokeAt, resize,
  debug: () => {
    const g = bodyMesh && bodyMesh.geometry
    let nan = 0
    if (g && g.attributes.position) {
      const a = g.attributes.position.array
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nan++
    }
    return { bodyMesh: !!bodyMesh, loadedForm, loadingForm, pivotChildren: pivot.children.length, posNaN: nan, camZ: camera.position.z, anchor: state.anchor, action: state.action, sitFrames, pivotY: pivot.position.y }
  },
  // 数值构图探针(无需看图像即可验证坐姿是否压在窗口上沿)
  layout: () => {
    if (!bodyMesh) return null
    root.updateMatrixWorld(true)
    bodyMesh.updateMatrixWorld(true)
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    const project = (world) => {
      const v = world.clone().project(camera)
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (0.5 - v.y * 0.5) * canvas.clientHeight }
    }
    const box = new THREE.Box3().setFromObject(root)
    const top = project(new THREE.Vector3(0, box.max.y, 0))
    const bottom = project(new THREE.Vector3(0, box.min.y, 0))
    const hipB = bone('下半身')
    const hip = hipB ? project(hipB.getWorldPosition(new THREE.Vector3())) : null
    return {
      canvasW: canvas.clientWidth, canvasH: canvas.clientHeight,
      topY: Math.round(top.y), hipY: hip ? Math.round(hip.y) : null, bottomY: Math.round(bottom.y),
      boxYmin: Number(box.min.y.toFixed(2)), boxYmax: Number(box.max.y.toFixed(2)),
      pivotY: Number(pivot.position.y.toFixed(2)), camY: Number(camera.position.y.toFixed(2)), camZ: Number(camera.position.z.toFixed(2)),
    }
  },
  skeleton: () => {
    if (!bodyMesh) return null
    root.updateMatrixWorld(true)
    bodyMesh.updateMatrixWorld(true)
    const out = {}
    for (const name of ['腰', '下半身', '上半身', '首', '頭', '右足', '右ひざ', '右足首', '左足', '左ひざ', '左足首', '右腕', '右手首']) {
      const b = bone(name)
      if (!b) { out[name] = null; continue }
      const p = b.getWorldPosition(new THREE.Vector3())
      out[name] = { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)), z: Number(p.z.toFixed(2)), rx: Number(b.rotation.x.toFixed(2)) }
    }
    return out
  },
  testPose: () => {
    if (!bodyMesh) return null
    resetPose()
    scratch.clear()
    addSitPose(0, 0)
    commitPose()
    root.rotation.y = BASE_YAW
    root.updateMatrixWorld(true)
    const knee = bone('右ひざ')
    const thigh = bone('右足')
    const out = { thighRx: thigh ? thigh.rotation.x : null, restRx: thigh ? restPose.get(thigh).rx : null }
    if (knee) {
      const p = knee.getWorldPosition(new THREE.Vector3())
      out.knee = { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)), z: Number(p.z.toFixed(2)) }
    }
    resetPose()
    scratch.clear()
    return out
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
