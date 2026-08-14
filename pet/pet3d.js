/* global window, document, performance */
/* 式神桌宠 3D 层 — v0.4.0
 * three.js(r158, 与 sr.ycl.cool 同版本链路) + MMDLoader 加载 PMX:
 *   正常形态  models/46/index.pmx
 *   大招形态  models/46_iswhite/index.pmx
 * 待机: 程序化"自然"动画(多层噪声呼吸 / 随机张望 / 随机小动作 / 平滑眨眼) + ammo 头发物理
 * 动作: 站内公开 VMD(极乐净土/彩虹节拍/Good Time), MMDAnimationHelper 播片 + 物理共存
 */
import * as THREE from 'three'
import { MMDLoader, MMDToonMaterial } from 'three/loaders/MMDLoader.js'
import { MMDAnimationHelper } from 'three/animation/MMDAnimationHelper.js'
import { GLTFLoader } from 'three/loaders/GLTFLoader.js'

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
const VRM_FILES = { normal: 'models/vrm/index.vrm', ultimate: 'models/vrm/ultimate.vrm' }
const BASE_YAW = 0.42 // 约 24°, 3/4 侧脸
const ACTIONS = { idle: null, dance1: '1.vmd', dance2: '2.vmd', dance3: '3.vmd' }
const state = { form: 'normal', status: 'idle', action: 'idle', anchor: 'float', dragging: false }
// 可调参数(设置页自由调节, 默认与 v0.4.0 行为一致)
const options = { look: true, physics: true, breath: 'normal', gesture: 'normal', chibi: 1, fps: 60, transition: 450, modelFormat: 'vrm', vrm: {} }
const BREATH_MUL = { light: 0.55, normal: 1, strong: 1.5 }
const GESTURE_MUL = { low: 2.2, normal: 1, high: 0.55 }
// VRM 人形骨骼标准名 → 本项目 PMX 日语骨骼名; VRM 通过 VRMC_vrm.humanoid.humanBones 映射到节点
const VRM_BONE_ALIASES = {
  'センター': ['hips'],
  '腰': ['hips', 'spine'],
  '下半身': ['hips'],
  '上半身': ['spine'],
  '上半身1': ['chest', 'upperChest'],
  '首': ['neck'],
  '頭': ['head'],
  '右肩': ['rightShoulder'],
  '右腕': ['rightUpperArm'],
  '右ひじ': ['rightLowerArm'],
  '右手首': ['rightHand'],
  '左肩': ['leftShoulder'],
  '左腕': ['leftUpperArm'],
  '左ひじ': ['leftLowerArm'],
  '左手首': ['leftHand'],
  '右足': ['rightUpperLeg'],
  '右ひざ': ['rightLowerLeg'],
  '右足首': ['rightFoot'],
  '左足': ['leftUpperLeg'],
  '左ひざ': ['leftLowerLeg'],
  '左足首': ['leftFoot'],
}
const BLINK_MORPH_NAMES = ['blink', 'Blink', 'BLINK', 'まばたき', 'eyeBlink']
const MOUTH_MORPH_NAMES = ['aa', 'a', 'Aa', 'A', 'あ', 'ああ', 'mouth']
const VOWEL_MORPHS = [
  ['あ', 'aa', 'a', 'A'],
  ['い', 'ih', 'i', 'I'],
  ['う', 'ou', 'u', 'U'],
  ['え', 'ee', 'e', 'E'],
  ['お', 'oh', 'o', 'O'],
]

// 状态 → 摆动/呼吸节奏目标(逐帧平滑过渡, 避免参数跳变)
const STATUS_PARAMS = {
  idle: { sway: 0.032, swayF: 0.045, breathMul: 1, headRate: 1 },
  thinking: { sway: 0.05, swayF: 0.16, breathMul: 1.3, headRate: 2.4 },
  working: { sway: 0.022, swayF: 0.14, breathMul: 1.5, headRate: 2.4 },
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
const gltfLoader = new GLTFLoader()
const helper = new MMDAnimationHelper()
// 微风级物理: 默认 MMD 重力为 -98(单位/秒²), 太猛; 降到 1/3 左右让头发/衣摆缓慢轻柔地飘
const BREEZE_GRAVITY = new THREE.Vector3(0, -36, 0)

// MToon 渐变贴图: 暗部→亮部分 5 档, 硬切过渡出漫画感
const TOON_GRADIENT = (() => {
  const bands = [24, 22, 26, 70, 72, 86, 140, 142, 160, 225, 226, 245, 255, 255, 255, 255]
  const tex = new THREE.DataTexture(new Uint8Array(bands), 4, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
})()
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

// sr.ycl.cool 建模常见问题的渲染修正:
// 1) "X+"内衬与正面完全共面(顶点逐字节重合) → polygonOffset 把内衬压深, 消除 Z-Fighting 闪烁/条纹
// 2) 纹理含 alpha 通道但材质不透明 → alphaTest 裁掉全透明像素, 消除裙摆/袖口半透边缘的杂色与重影
// 3) 透明材质(眼影/脸叠加层)不再写深度, 避免深度空洞与前后串层
function sanitizeMaterials(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
  for (const m of mats) {
    if (!m) continue
    if (m.transparent) {
      m.depthWrite = false
      m.needsUpdate = true
      continue
    }
    if (m.map && m.map.transparent) m.alphaTest = 0.1
    if (/\+$/.test(String(m.name || ''))) {
      m.polygonOffset = true
      m.polygonOffsetFactor = 1
      m.polygonOffsetUnits = 1
    }
    m.needsUpdate = true
  }
}

// VRM/glTF 的头发/裙摆/袖子材质修正:
// 导出器把带 alpha 通道的贴图做成 BLEND 透明并关闭深度写入, 多层叠加会随排序闪烁(头发忽有忽无)。
// 改为 alphaTest 裁剪 + 写深度, 发丝/布料改为双面, 消除"秃发/透空"。
function sanitizeVrmMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      if (!m) continue
      const label = String(m.name || '') + '|' + String(o.name || '')
      const isHair = /发|髪|hair/i.test(label)
      const isCloth = isHair || /裙|袖|摆|裾|cloth/i.test(label)
      if (m.transparent && m.map) {
        m.transparent = false
        m.alphaTest = isHair ? 0.4 : 0.25
        m.depthWrite = true
        if (isCloth) m.side = THREE.DoubleSide
        m.needsUpdate = true
        continue
      }
      if (m.transparent) {
        m.depthWrite = true
        m.needsUpdate = true
      }
    }
  })
}

// VRM 材质 → MToon: 渐变硬切 + BlinnPhong 高光, 与 PMX 桌宠保持同一种漫画质感
function applyToonMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    const converted = mats.map((src) => {
      if (!src || src.isMMDToonMaterial) return src
      const toon = new MMDToonMaterial({
        map: src.map || null,
        color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1),
        gradientMap: TOON_GRADIENT,
        opacity: typeof src.opacity === 'number' ? src.opacity : 1,
        transparent: !!src.transparent,
        alphaTest: Number(src.alphaTest || 0),
        side: src.side,
        shininess: 8,
      })
      toon.needsUpdate = true
      return toon
    })
    if (Array.isArray(o.material)) o.material = converted
    else if (o.material) o.material = converted[0]
  })
}

let loadedForm = null
let loadingForm = null
let bodyMesh = null
let modelRoot = null
let vrmLoaded = false
let vrmSpringChains = []
let vrmSprings = []
let blinkMorphSlots = []
let vowelMorphSlots = []
let clockT = 0
let heldRot = null
let hopUntil = 0
let shakeUntil = 0
let danceLoading = null
let sitBlend = 0
let lastTickMs = performance.now()
let frameAccumMs = 0

const restPose = new Map() // Bone -> {rx,ry,rz,px,py,pz}
let boneByName = new Map()
const scratch = new Map() // 每帧骨骼偏移累加器
let talkUntil = -1
let talkText = ''
let talkStart = 0
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
  { d: 2.3, bones: [['右肩', -0.1, 0, 0], ['右腕', -0.5, 0, 0.05], ['右ひじ', -0.28, 0, 0], ['左腕', 0.09, 0, 0]] },
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
  if (modelRoot) { try { helper.remove(modelRoot) } catch (_) { /* 忽略 */ } disposeMesh(modelRoot); modelRoot = null }
  bodyMesh = null
  vrmLoaded = false
  vrmSpringChains = []
  vrmSprings = []
  blinkMorphSlots = []
  vowelMorphSlots = []
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
  const addBone = (o) => {
    if (!o || !o.isBone) return
    if (!restPose.has(o)) {
      restPose.set(o, { rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, px: o.position.x, py: o.position.y, pz: o.position.z })
    }
    if (!boneByName.has(o.name)) boneByName.set(o.name, o)
  }
  mesh.traverse((o) => {
    if (o.isBone) addBone(o)
    // VRM/glTF: 骨骼位于各 SkinnedMesh 的 skeleton.bones, 不在场景子节点里
    if (o.isSkinnedMesh && o.skeleton && Array.isArray(o.skeleton.bones)) {
      for (const b of o.skeleton.bones) addBone(b)
    }
  })
  applyNameAliases()
}

// glTF/VRM 若直接以标准人形骨名命名, 先按名字把日语别名指过去
function applyNameAliases() {
  for (const [jp, candidates] of Object.entries(VRM_BONE_ALIASES)) {
    if (boneByName.has(jp)) continue
    for (const name of candidates) {
      const b = boneByName.get(name)
      if (b) { boneByName.set(jp, b); break }
    }
  }
}

// VRM1: 从 VRMC_vrm.humanoid.humanBones 的节点索引解析骨骼对象
function applyVrmHumanoidMap(parser) {
  if (!parser || !parser.json || !parser.associations) return
  const extensions = parser.json.extensions || {}
  const vrm = extensions.VRMC_vrm
  const humanBones = vrm && vrm.humanoid && vrm.humanoid.humanBones
  const nodes = parser.json.nodes || []
  const nodeName = (idx) => (nodes[idx] && nodes[idx].name) || null
  if (humanBones) {
    for (const [jp, candidates] of Object.entries(VRM_BONE_ALIASES)) {
      if (boneByName.has(jp)) continue
      for (const type of candidates) {
        const h = humanBones[type]
        const name = h && typeof h.node === 'number' ? nodeName(h.node) : null
        const obj = name ? boneByName.get(name) : null
        if (obj) { boneByName.set(jp, obj); break }
      }
    }
  }
  // VRMC_springBone: 建立带刚度/重力/阻尼的阻尼弹簧状态(真正积分, 而非正弦噪声)
  const springBone = extensions.VRMC_springBone
  vrmSpringChains = []
  vrmSprings = []
  const inChain = new Set()
  if (springBone && Array.isArray(springBone.springs)) {
    for (const spring of springBone.springs) {
      const joints = []
      for (const joint of spring.joints || []) {
        const name = joint && typeof joint.node === 'number' ? nodeName(joint.node) : null
        const boneObj = name ? boneByName.get(name) : null
        if (!boneObj || !boneObj.isBone) continue
        inChain.add(boneObj.name)
        joints.push({
          bone: boneObj,
          rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0,
          stiffness: typeof joint.stiffness === 'number' && joint.stiffness > 0 ? joint.stiffness : 2,
          gravityPower: typeof joint.gravityPower === 'number' ? joint.gravityPower : 0.1,
          gravityDir: Array.isArray(joint.gravityDir) ? joint.gravityDir : [0, -1, 0],
          dragForce: typeof joint.dragForce === 'number' ? joint.dragForce : 0.5,
        })
      }
      if (joints.length) {
        vrmSprings.push({ joints })
        vrmSpringChains.push(joints.map(j => j.bone))
      }
    }
  }
  // 刘海/前发等没有物理链的头发骨骼补一条轻弹簧
  const hairName = /髪|发|hair|刘海|前髪|前发|側髪|侧发/i
  for (const [name, boneObj] of boneByName) {
    if (inChain.has(name) || !hairName.test(name)) continue
    inChain.add(name)
    vrmSprings.push({ joints: [{ bone: boneObj, rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0, stiffness: 2.5, gravityPower: 0, gravityDir: [0, -1, 0], dragForce: 0.75 }] })
    vrmSpringChains.push([boneObj])
  }
}

// VRM 弹簧骨求解器: 恢复力(刚度) + 重力 + 空气阻尼 + 缓变风场, 逐帧积分
function applyVrmSprings(now, dt) {
  if (!vrmLoaded || !vrmSprings.length) return
  const wx = Math.sin(now * 0.35) * 0.5 + Math.sin(now * 0.17) * 0.28
  const wz = Math.cos(now * 0.28) * 0.5 + Math.sin(now * 0.13) * 0.24
  for (let si = 0; si < vrmSprings.length; si++) {
    const spring = vrmSprings[si]
    const n = Math.max(spring.joints.length - 1, 1)
    const breeze = 0.55 + 0.25 * (si % 3)
    for (let ji = 0; ji < spring.joints.length; ji++) {
      const j = spring.joints[ji]
      const depth = ji / n
      const windAmp = (0.22 + 0.6 * depth) * breeze
      j.vx += (-j.rx * j.stiffness + wx * windAmp) * dt
      j.vy += (-j.ry * j.stiffness) * dt
      j.vz += (-j.rz * j.stiffness + wz * windAmp) * dt
      const g = j.gravityDir
      j.vx += g[0] * j.gravityPower * 2 * dt
      j.vy += g[1] * j.gravityPower * 2 * dt
      j.vz += g[2] * j.gravityPower * 2 * dt
      const damp = Math.max(0, 1 - j.dragForce * 3 * dt)
      j.vx *= damp
      j.vy *= damp
      j.vz *= damp
      j.rx += j.vx * dt
      j.ry += j.vy * dt
      j.rz += j.vz * dt
      addRot(j.bone.name, j.rx, j.ry, j.rz)
    }
  }
}

// VRM 没有 ammo 物理, 单独补一套肉眼可见但轻柔的呼吸 + 手臂摆动
function applyVrmIdleMotion(now, breathe) {
  if (!vrmLoaded) return
  addRot('上半身', breathe * 0.035, 0, 0)
  addRot('右肩', breathe * 0.012, 0, 0)
  addRot('左肩', breathe * 0.012, 0, 0)
  const armR = org(now, 0.34, 0.09, 0.19, 0.045, 0.55, 0.024)
  addRot('右腕', armR * 0.55, 0, armR * 0.22)
  addRot('左腕', -armR * 0.55, 0, -armR * 0.22)
  addPos('センター', org(now, 0.15, 0.02, 0.08, 0.01, 0.28, 0.005), 0, 0)
}

function applyHeldRot() {
  if (!heldRot) return
  addRot(heldRot.name, heldRot.rx, heldRot.ry, heldRot.rz)
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

// 只往 scratch 累加坐姿偏移, 由 commitPose 统一应用; k 用于坐/站平滑过渡缩放
function addSitPose(now, breathe, k = 1) {
  sitFrames += 1
  const add = (name, rx, ry, rz) => addRot(name, rx * k, ry * k, rz * k)
  // 骨盆微前倾 + 背稍后靠, 呼吸带动躯干
  add('腰', -0.18 + breathe * 0.008, 0, 0)
  add('下半身', 0.05 + breathe * 0.006, 0, 0)
  add('上半身', -0.12 - breathe * 0.011, 0, 0)
  add('上半身1', -0.03, 0, 0)

  // 头: 保留张望与目光跟随, 幅度略收
  if (!gesture) updateHead(now)
  add('首', 0.06 + breathe * 0.004, headMotion.cYaw * 0.5 + look.yaw, 0)
  add('頭', headMotion.cPitch * 0.6 + look.pitch, headMotion.cYaw * 0.4, 0)

  // 大腿前伸、小腿自然垂下, 双腿交替极轻的晃动(像真的坐在边沿)
  const legSway = org(now, 0.05, 0.045, 0.03, 0.02, 0.09, 0.012)
  add('右足', -1.38 + legSway, 0, 0)
  add('左足', -1.38 - legSway, 0, 0)
  // 小腿略向前倾而不是完全垂直, 摆动幅度稍大, 避免"笔直僵硬"
  add('右ひざ', 1.33 - legSway * 1.1, 0, 0)
  add('左ひざ', 1.33 + legSway * 1.1, 0, 0)
  const ankleR = org(now, 0.06, 0.03, 0.04, 0.015, 0.11, 0.008)
  add('右足首', -0.12 + ankleR, 0, 0)
  add('左足首', -0.12 - ankleR, 0, 0)

  // 手搭在膝上/窗沿, 微微呼吸
  const handR = org(now, 0.04, 0.03, 0.03, 0.015, 0.08, 0.006)
  add('右腕', -0.85 + handR, 0, 0.08)
  add('左腕', -0.85 - handR, 0, -0.08)
  add('右ひじ', -0.62, 0, 0)
  add('左ひじ', -0.62, 0, 0)

  // 被戳到: 缩一下头
  if (clockT < pokeUntil) add('頭', -0.16, 0, 0)

  // 被拖动: 手臂略抬, 像被轻轻拎起(坐姿保持到松手)
  if (state.dragging) {
    add('右腕', -1.15, 0, 0.18)
    add('左腕', -1.15, 0, -0.18)
    add('右ひじ', -0.4, 0, 0)
    add('左ひじ', -0.4, 0, 0)
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
  // 状态参数平滑过渡; transition 是名义时长(ms), 默认 450 与既有手感一致, 数值越大越慢
  const transition = Number.isFinite(Number(options.transition)) ? Math.max(100, Math.min(3000, Number(options.transition))) : 450
  const transMul = 450 / transition
  const target = STATUS_PARAMS[state.status] || STATUS_PARAMS.idle
  for (const k of Object.keys(curParams)) curParams[k] = lerp(curParams[k], target[k], Math.min(1, dt * 2.2 * transMul))
  const tm = now * curParams.breathMul * (BREATH_MUL[options.breath] || 1)

  // 呼吸: 主频 + 两层微扰, 躯干带动肩与头
  const breathe = org(tm, 0.24, 0.62, 0.09, 0.24, 0.37, 0.14)
  lastBreathe = breathe

  // 坐/站平滑过渡(约 0.3s): 切换锚点时腿部/手臂逐渐折叠, 不再瞬间弹到坐姿
  const sitTarget = isSitting() ? 1 : 0
  sitBlend = lerp(sitBlend, sitTarget, Math.min(1, dt * 3.4 * transMul))
  if (Math.abs(sitBlend - sitTarget) < 0.01) sitBlend = sitTarget
  if (sitBlend > 0.001) addSitPose(now, breathe, sitBlend)
  if (sitTarget === 1) gesture = null

  if (sitBlend < 0.999) {
    addRot('上半身', breathe * 0.017, org(tm, 0.05, 0.009, 0.03, 0.004, 0.11, 0.003), org(tm, 0.07, 0.003, 0.04, 0.002, 0.15, 0.002))
    addRot('首', breathe * 0.008, 0, 0)
    addRot('頭', breathe * 0.005, 0, 0)

    // 手臂: 反相低频微摆 + 各自噪声, 不齐步才自然
    const armBase = org(now, 0.105, 0.5, 0.046, 0.26, 0.18, 0.14)
    const armR = armBase + org(now, 0.03, 0.18, 0.02, 0.12, 0.05, 0.08)
    const armL = -armBase + org(now, 0.033, 0.18, 0.021, 0.12, 0.047, 0.08)
    // 肩部跟着手臂小幅联动, 让腋下/肩关节的动作由肩+肘+腕分摊, 连接处不再僵硬
    addRot('右肩', breathe * 0.0045 + armR * 0.05, 0, 0)
    addRot('左肩', breathe * 0.0045 - armR * 0.05, 0, 0)
    addRot('右腕', 0.028 + armR * 0.036, org(now, 0.04, 0.012, 0.02, 0.006, 0.07, 0.004), org(now, 0.05, 0.018, 0.025, 0.009, 0.08, 0.005))
    addRot('左腕', 0.028 + armL * 0.036, -org(now, 0.04, 0.012, 0.02, 0.006, 0.07, 0.004), -org(now, 0.05, 0.018, 0.025, 0.009, 0.08, 0.005))
    addRot('右ひじ', -0.085 - armR * 0.02, 0, 0)
    addRot('左ひじ', -0.085 - armL * 0.02, 0, 0)

    // 被拖动: 双臂张开像被拎起, 身体随主进程移动漂浮
    if (state.dragging) {
      addRot('右腕', -0.58, 0, 0.18)
      addRot('左腕', -0.58, 0, -0.18)
      addRot('右ひじ', -0.18, 0, 0)
      addRot('左ひじ', -0.18, 0, 0)
      addRot('首', 0.05, 0, 0)
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

    // 被戳头: 短促缩脖 + 轻微低头(站立待机也要有反馈, 与坐姿一致)
    if (clockT < pokeUntil) {
      const p = 1 - clamp01((pokeUntil - clockT) / 1.15)
      const dip = Math.sin(p * Math.PI) * 0.2
      addRot('首', -dip * 0.2, 0, 0)
      addRot('頭', dip, 0, 0)
    }

    // 出错: 身体短促后仰 + 抬头缩肩, 配合窗口级抖动
    const nowMs = performance.now()
    if (nowMs < shakeUntil) {
      const p = (shakeUntil - nowMs) / 700
      addRot('上半身', -p * 0.12, 0, 0)
      addRot('首', p * 0.12, 0, 0)
    }
  }

  applyVrmSprings(now, dt)
  applyVrmIdleMotion(now, breathe)
  applyHeldRot()

  commitPose()

  // 眨眼 + 说话嘴型(morph)
  updateBlink(dt)
  // 眨眼 + 按文字驱动的多元音口型(morph 可能分布在多个网格上)
  const setMorph = (slot, value) => {
    if (!slot || !slot.mesh || !slot.mesh.morphTargetInfluences) return
    const morphLen = slot.mesh.morphTargetInfluences.length
    if (slot.idx >= 0 && slot.idx < morphLen) slot.mesh.morphTargetInfluences[slot.idx] = value
  }
  const setSlots = (slots, value) => {
    for (const slot of slots || []) setMorph(slot, value)
  }
  setSlots(blinkMorphSlots, blinkWeight)
  for (const slots of vowelMorphSlots) setSlots(slots, 0)
  if (now < talkUntil) {
    let target = 0
    if (talkText) {
      const t = now - talkStart
      const seg = Math.max(0, Math.min(Math.floor(t / 0.11), talkText.length - 1))
      target = talkText.charCodeAt(seg) % 5
    }
    const open = 0.3 + 0.45 * Math.abs(Math.sin(now * 13))
    setSlots(vowelMorphSlots[target] && vowelMorphSlots[target].length ? vowelMorphSlots[target] : vowelMorphSlots[0], open)
  }

  // 坐姿没有脚下阴影; 站立阴影随呼吸微缩
  if (shadowEl) {
    if (isSitting()) {
      shadowEl.style.opacity = '0'
    } else {
      const s = 1 + breathe * 0.018
      shadowEl.style.opacity = String(0.3 - breathe * 0.015)
      shadowEl.style.transform = `translateX(-50%) scale(${s.toFixed(3)})`
    }
  }
}

// 目光跟随: 鼠标在桌宠窗口上时头部微微朝向光标, 移开后缓慢回正
function updateLook() {
  look.yaw = lerp(look.yaw, look.targetYaw, 0.12)
  look.pitch = lerp(look.pitch, look.targetPitch, 0.12)
}

function helperPhysicsOnly() {
  if (!bodyMesh || vrmLoaded) return
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
  if (next === 'idle') { if (!vrmLoaded) helperPhysicsOnly(); return }

  danceLoading = next
  loader.loadAnimation(
    `actions/${ACTIONS[next]}`,
    bodyMesh,
    (clip) => {
      if (state.action !== next) return
      danceLoading = null
      try { helper.remove(bodyMesh) } catch (_) { /* 忽略 */ }
      // VRM 与 PMX 骨架同名, 可直接复用 VMD; VRM 没有 ammo 刚体, 跳舞时关闭物理
      try {
        if (vrmLoaded) helper.add(bodyMesh, { animation: clip, ik: false, grant: false, physics: false })
        else attachPhysics(bodyMesh, clip)
      } catch (e) { console.warn('动作接入失败:', e) }
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
  setTalkText('')
}

function setTalkText(text) {
  talkText = String(text || '').replace(/\s+/g, '')
  talkStart = clockT
  talkUntil = clockT + (talkText ? Math.min(7, 0.8 + talkText.length * 0.11) : 1.2)
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

function resolveMorphSlots() {
  blinkMorphSlots = []
  vowelMorphSlots = Array.from({ length: 5 }, () => [])
  const findIdx = (names, mesh) => {
    const dict = mesh && mesh.morphTargetDictionary
    if (!dict) return -1
    for (const n of names) {
      if (dict[n] !== undefined) return dict[n]
    }
    return -1
  }
  const visit = (mesh) => {
    const blinkIdx = findIdx(BLINK_MORPH_NAMES, mesh)
    if (blinkIdx >= 0) blinkMorphSlots.push({ mesh, idx: blinkIdx })
    for (let i = 0; i < 5; i++) {
      const idx = findIdx(VOWEL_MORPHS[i], mesh)
      if (idx >= 0) {
        vowelMorphSlots[i].push({ mesh, idx })
      } else if (i === 0) {
        const fallback = findIdx(MOUTH_MORPH_NAMES, mesh)
        if (fallback >= 0) vowelMorphSlots[0].push({ mesh, idx: fallback })
      }
    }
  }
  if (vrmLoaded && modelRoot) {
    modelRoot.traverse((o) => { if (o.isSkinnedMesh) visit(o) })
  } else {
    visit(bodyMesh)
  }
  // 缺元音口型时回退到第一个口型(PMX 通常只有 あ)
  for (let i = 0; i < 5; i++) {
    if (!vowelMorphSlots[i].length) vowelMorphSlots[i] = vowelMorphSlots[0]
  }
}

function findSkinnedMesh(root) {
  let found = null
  root.traverse((o) => { if (!found && o.isSkinnedMesh) found = o })
  return found
}

function finishPmxLoad(form, mesh) {
  if (state.form !== form) { disposeMesh(mesh); return }
  bodyMesh = mesh
  modelRoot = mesh
  vrmLoaded = false
  pivot.add(mesh)
  captureRestPose(mesh)
  sanitizeMaterials(mesh)
  applyChibi()
  resolveMorphSlots()
  loadedForm = form
  loadingForm = null
  reframe()
  // MMDLoader 的网格回调早于纹理解码; 等所有贴图 complete 后再跑一遍, 才能读到 map.transparent 并补上 alphaTest
  let sanitizeTries = 0
  const sanitizeWhenReady = () => {
    sanitizeMaterials(mesh)
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    const pending = mats.some(m => {
      if (!m.map) return false
      const img = m.map.image
      if (!img) return true
      return typeof img.complete === 'boolean' && !img.complete
    })
    if (pending && sanitizeTries++ < 100 && bodyMesh === mesh) setTimeout(sanitizeWhenReady, 50)
  }
  sanitizeWhenReady()
  if (state.action === 'idle') helperPhysicsOnly()
  else playDance(state.action, true)
}

function loadPmxForm(form) {
  const folder = FOLDERS[form] || FOLDERS.normal
  loader.load(
    `models/${folder}/index.pmx`,
    (mesh) => finishPmxLoad(form, mesh),
    undefined,
    (err) => {
      loadingForm = null
      console.warn('式神模型加载失败:', err)
      document.dispatchEvent(new CustomEvent('pet3d-error'))
    },
  )
}

function loadVrmForm(form) {
  gltfLoader.load(
    VRM_FILES[form] || VRM_FILES.normal,
    (gltf) => {
      if (state.form !== form) { disposeMesh(gltf.scene); return }
      const scene = gltf.scene
      const mesh = findSkinnedMesh(scene)
      if (!mesh) {
        disposeMesh(scene)
        console.warn('VRM 缺少 SkinnedMesh, 回退 PMX')
        loadPmxForm(form)
        return
      }
      bodyMesh = mesh
      modelRoot = scene
      vrmLoaded = true
      pivot.add(scene)
      captureRestPose(scene)
      applyVrmHumanoidMap(gltfLoader.parser)
      sanitizeVrmMaterials(scene)
      applyToonMaterials(scene)
      applyChibi()
      resolveMorphSlots()
      loadedForm = form
      loadingForm = null
      if (state.action !== 'idle') state.action = 'idle'
      reframe()
      lastShapeKey = ''
    },
    undefined,
    (err) => {
      console.warn('VRM 加载失败, 回退 PMX:', err)
      if (state.form === form) loadPmxForm(form)
    },
  )
}

function loadForm(form) {
  if (loadingForm === form || loadedForm === form) return
  loadingForm = form
  clearModel()
  const useVrm = options.modelFormat !== 'pmx' && !!(options.vrm && options.vrm[form])
  if (useVrm) loadVrmForm(form)
  else loadPmxForm(form)
}

function animate() {
  requestAnimationFrame(animate)
  // 限帧: 高刷新率屏幕(120/144Hz)下 rAF 会白跑大量帧, 这里按 options.fps 节流整个模拟+渲染循环。
  // 时间片余量保留到下一帧, 既保证平均帧率精确, 又不会在后台卡顿恢复后连补十几帧。
  const nowMs = performance.now()
  let elapsed = nowMs - lastTickMs
  lastTickMs = nowMs
  if (elapsed > 250) elapsed = 250
  const fps = Number.isFinite(Number(options.fps)) ? Math.max(0, Math.min(240, Number(options.fps))) : 60
  const intervalMs = fps > 0 ? 1000 / fps : 0
  frameAccumMs += elapsed
  if (intervalMs > 0 && frameAccumMs < intervalMs) return
  const dt = Math.min(intervalMs > 0 ? intervalMs / 1000 : elapsed / 1000, 0.1)
  frameAccumMs = intervalMs > 0 ? frameAccumMs % intervalMs : 0
  clockT += dt
  helper.update(dt)

  const status = state.status
  if (state.action === 'idle') {
    applyIdlePose(clockT, dt)
    if (options.look) updateLook()
    // 站姿微摆: 慢速有机噪声, 而非固定正弦
    root.rotation.y = BASE_YAW + org(clockT, curParams.swayF, curParams.sway, curParams.swayF * 0.61, curParams.sway * 0.45, curParams.swayF * 1.7, curParams.sway * 0.22)
    root.position.y = state.dragging ? Math.sin(clockT * 4.4) * 0.3 : 0
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
  if (Number.isFinite(Number(o.fps))) options.fps = Math.max(0, Math.min(240, Number(o.fps)))
  if (Number.isFinite(Number(o.transition))) options.transition = Math.max(100, Math.min(3000, Number(o.transition)))
  if (o.vrm && typeof o.vrm === 'object') options.vrm = { ...options.vrm, ...o.vrm }
  if ((o.modelFormat === 'vrm' || o.modelFormat === 'pmx') && o.modelFormat !== options.modelFormat) {
    options.modelFormat = o.modelFormat
    if (bodyMesh) {
      clearModel()
      loadedForm = null
      loadingForm = null
      loadForm(state.form)
    }
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
  setStatus, setForm, setAction, setTalk, setTalkText, setAnchor, setDragging, setPoke, setOptions, pokeAt, resize,
  holdRot: (name, rx = 0, ry = 0, rz = 0) => { heldRot = { name, rx, ry, rz } },
  clearHold: () => { heldRot = null },
  twistMeshBone: (meshName, boneName, rx = 0, ry = 0, rz = 0) => {
    if (!modelRoot) return null
    let m = null
    modelRoot.traverse((o) => { if (o.isSkinnedMesh && o.name === meshName) m = o })
    if (!m || !m.skeleton) return null
    const b = m.skeleton.bones.find(x => x && x.name === boneName)
    if (!b) return null
    b.rotation.x += rx
    b.rotation.y += ry
    b.rotation.z += rz
    return { mesh: meshName, bone: b.name, sameAsMap: b === bone(boneName) }
  },
  hideMesh: (meshName) => {
    if (!modelRoot) return false
    let done = false
    modelRoot.traverse((o) => { if (o.isMesh && o.name === meshName) { o.visible = false; done = true } })
    return done
  },
  debug: () => {
    const g = bodyMesh && bodyMesh.geometry
    let nan = 0
    if (g && g.attributes.position) {
      const a = g.attributes.position.array
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nan++
    }
    const swayBone = vrmSpringChains[0] && vrmSpringChains[0][vrmSpringChains[0].length - 1]
    const hairChain = vrmSpringChains.find(c => c.some(b => /发|髪|hair/i.test(String(b.name || ''))))
    const hairSwayBone = hairChain ? hairChain[hairChain.length - 1] : null
    const meshMats = []
    const morphInfo = []
    if (modelRoot) {
      modelRoot.traverse((o) => {
        if (!o.isMesh) return
        if (o.morphTargetDictionary) {
          const names = Object.keys(o.morphTargetDictionary)
          if (names.length) morphInfo.push({ mesh: o.name, n: names.length, sample: names.slice(0, 30) })
        }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        for (const m of mats) {
          if (!m) continue
          let mapName = ''
          if (m.map) mapName = m.map.name || (m.map.image && m.map.image.src ? String(m.map.image.src).split('/').pop() : '')
          if (/发|髪|hair|裙|袖|摆/i.test(String(o.name || '')) || /发|髪|hair|裙|袖|摆/i.test(mapName)) {
            meshMats.push({ mesh: o.name, mat: m.name, transparent: !!m.transparent, alphaTest: Number(m.alphaTest || 0), depthWrite: !!m.depthWrite, side: m.side, map: mapName })
          }
        }
      })
    }
    const hairBones = [...boneByName.keys()].filter(n => /发|髪|hair|刘海/i.test(String(n)))
    const headInfo = {}
    const headBoneObj = bone('頭')
    headInfo.head = headBoneObj ? { name: headBoneObj.name, parent: headBoneObj.parent ? headBoneObj.parent.name : null, children: headBoneObj.children.map(c => c.name) } : null
    if (modelRoot) {
      modelRoot.traverse((o) => {
        if (!o.isSkinnedMesh) return
        const matName = Array.isArray(o.material) ? (o.material[0] && o.material[0].name || '') : (o.material && o.material.name || '')
        if (/发|頭|头|颜|顔|face/i.test(String(o.name || '') + '|' + String(matName || ''))) {
          const names = o.skeleton && Array.isArray(o.skeleton.bones) ? o.skeleton.bones.map(x => x.name) : []
          headInfo[o.name] = { parent: o.parent ? o.parent.name : null, parentType: o.parent ? o.parent.type : null, bones: names.filter(n => /頭|头|首|髪|发|刘海|顔|颜/i.test(n)).slice(0, 24) }
        }
      })
    }
    return { bodyMesh: !!bodyMesh, vrmLoaded, bones: boneByName.size, vrmExt: gltfLoader.parser && gltfLoader.parser.json ? Object.keys(gltfLoader.parser.json.extensions || {}) : null, springChains: vrmSpringChains.length, springFirst: vrmSpringChains.slice(0, 24).map(c => c[0] ? c[0].name : null), hairBones: hairBones.slice(0, 80), headInfo, morphInfo, meshMats: meshMats.slice(0, 60), loadedForm, loadingForm, pivotChildren: pivot.children.length, posNaN: nan, camZ: camera.position.z, anchor: state.anchor, action: state.action, sitFrames, pivotY: pivot.position.y, renderFrames: renderer.info.render.frame, options: { fps: options.fps, transition: options.transition, vrm: options.vrm }, sway: swayBone ? { name: swayBone.name, rx: Number(swayBone.rotation.x.toFixed(4)), ry: Number(swayBone.rotation.y.toFixed(4)) } : null, hairSway: hairSwayBone ? { name: hairSwayBone.name, rx: Number(hairSwayBone.rotation.x.toFixed(4)), ry: Number(hairSwayBone.rotation.y.toFixed(4)) } : null }
  },
  materials: () => {
    if (!bodyMesh || !bodyMesh.geometry) return null
    const mats = Array.isArray(bodyMesh.material) ? bodyMesh.material : [bodyMesh.material]
    const geo = bodyMesh.geometry
    return mats.map((m, i) => {
      const groups = (geo.groups || []).filter(x => x.materialIndex === i)
      const tris = groups.reduce((s, x) => s + (x.count / 3), 0)
      let mapName = ''
      if (m.map) {
        mapName = m.map.name || ''
        if (!mapName && m.map.image && typeof m.map.image.src === 'string') mapName = m.map.image.src.split('/').pop()
      }
      return {
        i,
        name: m.name || '',
        transparent: !!m.transparent,
        opacity: Number(m.opacity),
        side: m.side,
        depthWrite: !!m.depthWrite,
        depthTest: !!m.depthTest,
        alphaTest: Number(m.alphaTest || 0),
        blending: m.blending,
        map: mapName,
        mapTransparent: !!m.map && !!m.map.transparent,
        polygonOffset: !!m.polygonOffset,
        verts: geo.attributes.position ? geo.attributes.position.count : 0,
        tris: Math.round(tris),
      }
    })
  },
  groups: () => {
    if (!bodyMesh || !bodyMesh.geometry) return null
    const geo = bodyMesh.geometry
    const pos = geo.attributes.position
    const idx = geo.index
    if (!pos || !idx) return null
    const out = []
    for (const g of geo.groups || []) {
      let min = [Infinity, Infinity, Infinity]
      let max = [-Infinity, -Infinity, -Infinity]
      for (let j = g.start; j < g.start + g.count; j++) {
        const vi = idx.getX(j)
        for (let k = 0; k < 3; k++) {
          const v = pos.getComponent(vi, k)
          if (v < min[k]) min[k] = v
          if (v > max[k]) max[k] = v
        }
      }
      out.push({
        group: g.materialIndex,
        min: min.map(v => Number(v.toFixed(4))),
        max: max.map(v => Number(v.toFixed(4))),
        center: min.map((v, k) => Number(((v + max[k]) / 2).toFixed(4))),
      })
    }
    return out
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
  skinWeights: (meshName) => {
    if (!modelRoot) return null
    let target = null
    modelRoot.traverse((o) => { if (o.isSkinnedMesh && o.name === meshName) target = o })
    if (!target || !target.geometry) return null
    const g = target.geometry
    const skinIndex = g.attributes.skinIndex
    const skinWeight = g.attributes.skinWeight
    if (!skinIndex || !skinWeight || !target.skeleton) return { mesh: meshName, noSkin: true }
    const counts = new Map()
    for (let i = 0; i < skinIndex.count; i++) {
      for (let k = 0; k < 4; k++) {
        const j = skinIndex.getX(i * 4 + k)
        const w = skinWeight.getComponent(i * 4 + k, 0)
        if (w > 0.001) counts.set(j, (counts.get(j) || 0) + w)
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([j, w]) => ({ bone: target.skeleton.bones[j] ? target.skeleton.bones[j].name : `joint${j}`, weight: Number(w.toFixed(1)) }))
    return { mesh: meshName, verts: skinIndex.count, top }
  },
  meshes: () => {
    if (!modelRoot) return []
    const out = []
    modelRoot.traverse((o) => {
      if (!o.isMesh) return
      const matName = Array.isArray(o.material) ? (o.material[0] && o.material[0].name || '') : (o.material && o.material.name || '')
      out.push({ name: o.name, verts: o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0, mat: matName, visible: o.visible })
    })
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
