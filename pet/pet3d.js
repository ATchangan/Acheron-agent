/* global window, document, performance */
/* 式神桌宠 3D 层 — v0.4.1
 * three.js(r158, 与 sr.ycl.cool 同版本链路) + MMDLoader 加载 PMX:
 *   正常形态  models/46/index.pmx          + 佩刀 models/46/1.pmx
 *   大招形态  models/46_iswhite/index.pmx  + 佩刀 models/46_iswhite/1.pmx
 * 展示: 固定 3/4 视角 + 呼吸起伏 + 轻微摆动(避免背上长刀随 360° 旋转横扫出框);
 *       物理(头发/衣摆)由 ammo 驱动, 加载失败自动降级为静态。
 */
import * as THREE from 'three'
import { MMDLoader } from 'three/loaders/MMDLoader.js'
import { MMDAnimationHelper } from 'three/animation/MMDAnimationHelper.js'

// three r158 对 0 个 morphTarget 的网格(佩刀)会上传空数组, 触发 WebGL INVALID_VALUE 刷屏:
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
const state = { form: 'normal', status: 'idle' }

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

const root = new THREE.Group() // 旋转 + 起伏
const pivot = new THREE.Group() // 平移居中
root.add(pivot)
scene.add(root)

const loader = new MMDLoader()
const helper = new MMDAnimationHelper()

let loadedForm = null
let loadingForm = null
let bodyMesh = null
let weaponMesh = null
let clockT = 0
let hopUntil = 0
let shakeUntil = 0
const clock = new THREE.Clock()

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
  if (weaponMesh) { disposeMesh(weaponMesh); weaponMesh = null }
  while (pivot.children.length) pivot.remove(pivot.children[0])
  pivot.position.set(0, 0, 0)
}

function centerAndFrame() {
  if (!bodyMesh) return
  // 1) 以未旋转的局部包围盒居中(刀与身体共用同一模型坐标, 无需额外偏移)
  root.rotation.y = 0
  root.updateMatrixWorld(true)
  const localBox = new THREE.Box3().setFromObject(root)
  const lc = localBox.getCenter(new THREE.Vector3())
  pivot.position.set(-lc.x, 0, -lc.z)

  // 2) 按展示角度取景
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
      if (window.__ammoReady) {
        try { helper.add(mesh, { physics: true }) } catch (_) { /* 无物理骨架也照常渲染 */ }
      }
      loadedForm = form
      loadingForm = null
      centerAndFrame()
    },
    undefined,
    (err) => {
      loadingForm = null
      console.warn('式神模型加载失败:', err)
      document.dispatchEvent(new CustomEvent('pet3d-error'))
    },
  )

  // 佩刀: 与身体共用坐标系, 挂到原点即自动出现在背上
  loader.load(
    `models/${folder}/1.pmx`,
    (weapon) => {
      if (state.form !== form) { disposeMesh(weapon); return }
      weaponMesh = weapon
      pivot.add(weapon)
      centerAndFrame()
    },
    undefined,
    () => { /* 武器可选, 失败不阻塞 */ },
  )
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.1)
  clockT += dt
  helper.update(dt)

  const status = state.status
  let swayFreq = 0.45
  let swayAmp = 0.11
  let bob = 0.14
  if (status === 'thinking') { swayFreq = 1.05; swayAmp = 0.16; bob = 0.24 }
  else if (status === 'working') { swayFreq = 1.75; swayAmp = 0.2; bob = 0.38 }
  else if (status === 'error') { swayFreq = 0.2; swayAmp = 0.04; bob = 0.1 }

  root.rotation.y = BASE_YAW + Math.sin(clockT * swayFreq * Math.PI * 2) * swayAmp

  let y = Math.sin(clockT * 0.8 * Math.PI * 2) * bob
  const now = performance.now()
  if (now < hopUntil) {
    const p = (hopUntil - now) / 900
    y += Math.abs(Math.sin((1 - p) * Math.PI * 2)) * 1.6 * p
  }
  root.position.y = y

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
window.pet3d = { setStatus, setForm, resize }

resize()
void boot()
