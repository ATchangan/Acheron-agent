"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const sessions_1 = require("./ipc/sessions");
const settings_1 = require("./ipc/settings");
const plugins_1 = require("./ipc/plugins");
const model_stats_1 = require("./ipc/model-stats");
const mcp_1 = require("./ipc/mcp");
const backup_1 = require("./ipc/backup");
const rollback_1 = require("./ipc/rollback");
const diagnostics_1 = require("./ipc/diagnostics");
const agents_1 = require("./engine/agents");
const window_1 = require("./ipc/window");
const web_1 = require("./ipc/web");
const cache_1 = require("./ipc/cache");
const misc_1 = require("./ipc/misc");
const hotkey_1 = require("./ipc/hotkey");
const models_1 = require("./ipc/models");
const update_1 = require("./ipc/update");
const browser_1 = require("./ipc/browser");
const computer_1 = require("./ipc/computer");
const llm_1 = require("./ipc/llm");
const tasks_1 = require("./ipc/tasks");
const trace_1 = require("./ipc/trace");
const engine_1 = require("./ipc/engine");
const risk_confirm_1 = require("./ipc/risk-confirm");
const browser_session_1 = require("./browser-session");
const main_utils_1 = require("./main-utils");
const path_1 = require("path");
const app_shell_1 = require("./app-shell");
const db_1 = require("./db");
const migrate_legacy_1 = require("./memory/migrate-legacy");
const session_index_1 = require("./memory/session-index");
const decay_1 = require("./memory/decay");
const vision_1 = require("./llm/vision");
const fs = __importStar(require("fs"));
// 固定 userData 路径 —— app.setName 会改变 Electron 默认 userData 目录(huangquan-agent → Acheron-Agent),
// 不显式指回原目录会丢失全部配置/会话
// 自省整改: 支持 HQ_USER_DATA 环境变量做测试隔离(测试数据不污染真实用户数据)
electron_1.app.setPath('userData', process.env.HQ_USER_DATA ? process.env.HQ_USER_DATA : (0, path_1.join)(electron_1.app.getPath('appData'), 'huangquan-agent'));
// 任务栏/系统托盘显示应用名与 AppUserModelID —— 不设置时 Windows 任务栏右键显示 "Electron"
electron_1.app.setName('Acheron-Agent');
if (process.platform === 'win32') {
    electron_1.app.setAppUserModelId('com.huangquan.agent');
}
// v0.3.6 修复: stdout/stderr 被关闭时 console 写入会抛 EPIPE, 被下方既有兜底处理器记录成 FATAL 噪音。
// 日志统一走安全包装; 未捕获异常仅对 EPIPE 静默, 其余交给既有兜底处理器(记录 crash.log)。
function safeLog(...args) { try {
    console.log(...args);
}
catch { /* 管道已关闭 */ } }
function safeError(...args) { try {
    console.error(...args);
}
catch { /* 管道已关闭 */ } }
// 退出前把缓冲中的诊断轨迹写盘(否则最后 ~500ms 的轨迹可能丢失)
electron_1.app.on('will-quit', () => { try {
    (0, trace_1.flushTrace)();
}
catch (e) { /* 忽略 */
    console.debug('[swallow]', e);
} try {
    (0, db_1.closeDb)();
}
catch (e) { /* 忽略 */
    console.debug('[swallow]', e);
} try {
    (0, hotkey_1.unregisterGlobalHotkey)();
}
catch (e) { /* 忽略 */
    console.debug('[swallow]', e);
} });
// 使用 Electron net.fetch（Chromium 网络栈，自动跟随 Windows 系统代理）——
// Node 全局 fetch(undici) 不读系统代理，导致浏览器能访问的 API 在应用内超时
const netFetch = ((...args) => electron_1.net.fetch(args[0], args[1]));
// 全局崩溃捕获
// v0.3.8: crash.log 超过 5MB 自动轮转为 crash.log.old(覆盖旧档), 防止无限增长
const CRASH_LOG_MAX = 5 * 1024 * 1024;
function rotateCrashLogIfNeeded() {
    try {
        const p = (0, path_1.join)(electron_1.app.getPath('userData'), 'crash.log');
        if (!fs.existsSync(p) || fs.statSync(p).size < CRASH_LOG_MAX)
            return;
        const old = p + '.old';
        try {
            fs.rmSync(old, { force: true });
        }
        catch { /* 忽略 */ }
        try {
            fs.renameSync(p, old);
        }
        catch { /* 忽略 */ }
    }
    catch { /* 忽略 */ }
}
function appendCrashLog(line) { try {
    rotateCrashLogIfNeeded();
    fs.appendFileSync((0, path_1.join)(electron_1.app.getPath('userData'), 'crash.log'), line);
}
catch (e) { /* 忽略 */
    console.debug('[swallow]', e);
} }
// v0.4.2: 子进程(GPU/utility/zygote 等)崩溃也落盘, 便于区分"渲染进程自身崩溃"与"合成器/GPU 进程连带崩溃"
electron_1.app.on('child-process-gone', (_e, details) => {
    try {
        appendCrashLog(new Date().toISOString() + ' child process gone: type=' + String(details.type || '?') + ' reason=' + details.reason + ' exit=' + details.exitCode + (details.serviceName ? ' service=' + details.serviceName : '') + '\n');
    }
    catch { /* 忽略 */ }
});
process.on('uncaughtException', (err) => {
    // stdout/stderr 被关闭导致的 EPIPE 不记 FATAL(避免刷 crash.log 噪音), 其余真实错误照常记录
    if (err?.code === 'EPIPE')
        return;
    console.error('[FATAL] uncaughtException:', err);
    appendCrashLog(new Date().toISOString() + ' uncaughtException: ' + err?.stack + '\n');
});
process.on('unhandledRejection', (reason) => { console.error('[FATAL] unhandledRejection:', reason); appendCrashLog(new Date().toISOString() + ' unhandledRejection: ' + reason + '\n'); });
// v0.3.0 M5: LLM 调用参数结构
// v0.3.0 M5: 本地设置数据结构(electron 不依赖渲染层类型)
let rendererMode = 'auto';
try {
    const raw0 = fs.readFileSync((0, path_1.join)(electron_1.app.getPath('userData'), 'settings.json'), 'utf-8');
    rendererMode = JSON.parse(raw0)?.general?.rendererMode || 'auto';
}
catch (e) { /* 首次运行无设置文件 */
    console.debug('[swallow]', e);
}
if (rendererMode === 'cpu') {
    // 兼容模式: 关闭 GPU, 全 CPU 软件渲染
    electron_1.app.disableHardwareAcceleration();
    electron_1.app.commandLine.appendSwitch('disable-gpu');
}
else {
    // GPU 模式(auto/gpu) —— 完全自动识别。
    // 不强制指定/不无视黑名单(移除 ignore-gpu-blocklist), 由 Chromium 自动探测 GPU 并决定是否硬件加速:
    // 检测到可用 GPU → 自动启用硬件加速; 无 GPU / 驱动有问题的 GPU → 自动降级软件渲染。
    electron_1.app.commandLine.appendSwitch('enable-gpu-rasterization'); // 尽力而为: GPU 可用时栅格化走 GPU
    electron_1.app.commandLine.appendSwitch('enable-zero-copy'); // 尽力而为: 零拷贝合成
    electron_1.app.commandLine.appendSwitch('enable-accelerated-2d-canvas'); // Canvas 2D 加速(可用时)
    electron_1.app.commandLine.appendSwitch('enable-accelerated-video-decode'); // 视频硬解(可用时)
}
let isQuitting = false;
let serverPort = 0;
// ─── 单实例锁 —— 防止多实例并行导致悬浮窗/窗口互相干扰 ──
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    // 直接退出, 不再 throw(避免触发 uncaughtException 写 crash.log 噪音)
    electron_1.app.quit();
    process.exit(0);
}
electron_1.app.on('second-instance', () => { const w = appShell.getWindow(); if (w) {
    w.show();
    w.focus();
} });
// ─── 路径 ───────────────────────────────────────────
const ROOT = (0, path_1.join)(__dirname, '..');
const resourcesDir = (0, path_1.join)(ROOT, 'resources');
const distDir = (0, path_1.join)(ROOT, 'dist');
const userDataPath = electron_1.app.getPath('userData');
const sessionsDir = (0, path_1.join)(userDataPath, 'sessions');
const settingsPath = (0, path_1.join)(userDataPath, 'settings.json');
const tasksPath = (0, path_1.join)(userDataPath, 'tasks.json');
const tracePath = (0, path_1.join)(userDataPath, 'agent-trace.jsonl');
// v0.3.7: 崩溃防护 —— 渲染模式设为 cpu 时禁用 GPU 硬件加速(Electron 渲染进程崩溃的常见来源)
try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (String(s?.general?.rendererMode || '') === 'cpu')
        electron_1.app.disableHardwareAcceleration();
}
catch { /* 设置不可读时保持默认 */ }
const appShell = new app_shell_1.AppShell({
    settingsPath,
    resourcesDir,
    tracePath,
    userDataPath,
    rendererMode,
    serverPort: () => serverPort,
    isQuitting: () => isQuitting,
    setQuitting: (v) => { isQuitting = v; },
    appendCrashLog,
    initBrowserViews: browser_session_1.initBrowserViews,
    getBrowserWin: () => (0, browser_session_1.getBrowserSession)(),
    // v0.4.2: 崩溃后窗口重建需重新挂载浏览器面板视图(内嵌浏览器/离屏截图引擎)
    onWindowRecreated: (win) => (0, browser_session_1.initBrowserViews)(win, { live: rendererMode !== 'cpu' }),
});
(0, settings_1.registerSettingsIpc)({ settingsPath, userDataPath, decProviders: main_utils_1.decProviders, encProviders: main_utils_1.encProviders });
(0, tasks_1.registerTaskIpc)({
    tasksPath,
    // v0.4.2: 桌面通知开关 —— 设置→引擎→桌面通知(notifyEnabled), 默认开
    getNotifyEnabled: () => {
        try {
            const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            return s?.general?.notifyEnabled !== false;
        }
        catch {
            return true;
        }
    },
});
(0, trace_1.registerTraceIpc)({ tracePath });
const memoryPath = (0, path_1.join)(userDataPath, 'memory.json');
// v0.4.0 M1: SQLite 存储基座(记忆/审计/会话索引/工具输出), 启动即初始化 + 旧 JSON 一次性迁移
const dbInit = (0, db_1.initDb)((0, path_1.join)(userDataPath, 'agent.db'));
if (dbInit.ok) {
    if (dbInit.inMemory) {
        safeLog('[db] 内存模式: 跳过旧记忆迁移, 旧 JSON 文件保留待下次可用时再迁移');
    }
    else {
        try {
            const imported = (0, migrate_legacy_1.importLegacyMemory)({ vectorPath: (0, path_1.join)(userDataPath, 'memory-vector.json'), jsonPath: memoryPath });
            if (imported.imported > 0)
                safeLog('[db] 旧记忆已迁移 ' + imported.imported + ' 条');
        }
        catch (e) {
            console.debug('[swallow]', e);
        }
    }
}
// v0.4.4 精简: 记忆/技能/定时/监视等用户界面已收敛, 对应 IPC 不再注册(引擎内部记忆基座保留)
const workspaceDir = (0, path_1.join)(userDataPath, 'workspace');
// v0.3.8: 自定义子代理目录(用户放 *.json 即注册自定义角色)
(0, agents_1.setCustomAgentsDir)((0, path_1.join)(userDataPath, 'agents'));
// skillsDir 保留: resources/skills 只读目录探测 + misc:openSkillsDir 兼容
const skillsDir = (0, path_1.join)(userDataPath, 'skills');
// mkdir 循环全部 try-catch —— resources/skills 在 asar 内只读, 失败不能崩溃
for (const d of [sessionsDir, workspaceDir, skillsDir, (0, path_1.join)(resourcesDir, 'skills')]) {
    try {
        if (!fs.existsSync(d))
            fs.mkdirSync(d, { recursive: true });
    }
    catch (e) { /* 只读目录(asar 内)或权限受限: 跳过 */
        console.debug('[swallow]', e);
    }
}
// v0.4.4 精简: 定时任务调度已移除(不再常驻轮询)
// 多角色体系已统一为前端实现(chat.ts AGENTS), 主进程 agent 模块已移除
// v0.2: 启动时加载MCP SSE
Promise.resolve().then(() => __importStar(require('./mcp/sse-transport'))).catch(() => { });
Promise.resolve().then(() => __importStar(require('./cache/tool-cache'))).catch(() => { });
// ─── 设置/会话 ─────────────────────────────────────
const sessionMeta = new Map();
(0, sessions_1.registerSessionIpc)({ sessionsDir, userDataPath, sessionMeta, buildSessionMeta });
function buildSessionMeta() {
    sessionMeta.clear();
    if (!fs.existsSync(sessionsDir))
        return;
    for (const f of fs.readdirSync(sessionsDir)) {
        if (!f.endsWith('.json'))
            continue;
        try {
            const d = JSON.parse(fs.readFileSync((0, path_1.join)(sessionsDir, f), 'utf-8'));
            sessionMeta.set(f.replace('.json', ''), { title: d.title || f, messageCount: d.messages?.length || 0, updatedAt: d.updatedAt || '', mode: d.mode || 'work', pinned: d.pinned === true, archived: d.archived === true });
        }
        catch (e) { /* 损坏文件跳过 */
            console.debug('[swallow]', e);
        }
    }
}
// ─── Skills 系统 ───────────────────────────────────
// ─── 记忆系统 ──────────────────────────────────────
// ─── 电脑控制 ──────────────────────────────────────
// 危险命令拦截统一走 security/permission.ts 风险分级(L4 拒绝), 消除双份列表漂移
const { assessRisk } = require('./security/permission');
(0, computer_1.registerComputerIpc)({ assertInsideWorkDir, assessRisk, getEffectiveWorkDir, getWorkDirOverride: () => workDirOverride, setWorkDirOverride: (d) => { workDirOverride = d; }, netFetch, workspaceDir, userDataPath });
(0, llm_1.registerLlmIpc)({ netFetch });
(0, engine_1.registerEngineIpc)({
    settingsPath,
    userDataPath,
    memoryPath,
    tracePath,
    resourcesDir,
    netFetch,
    decProviders: main_utils_1.decProviders,
    getSender: () => appShell.getWindow()?.webContents || null,
});
(0, plugins_1.registerPluginsIpc)({ userDataPath, settingsPath, assessRisk, getEffectiveWorkDir });
(0, model_stats_1.registerModelStatsIpc)();
(0, mcp_1.registerMcpIpc)({ settingsPath });
(0, cache_1.registerCacheIpc)();
(0, misc_1.registerMiscIpc)({ settingsPath, userDataPath, resourcesDir, skillsDir, workspaceDir, dirSize: main_utils_1.dirSize, fmtSize: main_utils_1.fmtSize });
(0, hotkey_1.registerHotkeyIpc)({ getWindow: () => appShell.getWindow() });
(0, models_1.registerModelsIpc)({ netFetch });
(0, update_1.registerUpdateIpc)({ netFetch });
(0, web_1.registerWebIpc)({ settingsPath, netFetch, decKey: main_utils_1.decKey });
(0, window_1.registerWindowIpc)({ getMainWindow: () => appShell.getWindow(), trayEnabled: () => appShell.trayEnabled(), setQuitting: (v) => { isQuitting = v; } });
(0, risk_confirm_1.registerRiskConfirm)({ getMainWindow: () => appShell.getWindow(), settingsPath });
(0, backup_1.registerBackupIpc)({
    userDataPath,
    getWorkDir: () => getEffectiveWorkDir() || userDataPath,
    getWindow: () => appShell.getWindow(),
});
(0, rollback_1.registerRollbackIpc)({ userDataPath });
(0, diagnostics_1.registerDiagnosticsIpc)({
    settingsPath,
    userDataPath,
    getWorkDir: () => getEffectiveWorkDir() || userDataPath,
    netFetch,
    getServerPort: () => serverPort,
});
// ─── 文件浏览器操作(写操作限定工作目录内, 防误删) ──
// set_workdir 只改内存(不持久化污染用户设置), 重启/应用重载后恢复用户设置的工作目录
let workDirOverride = null;
// v0.3.0: 有效工作目录 = 会话覆盖(如有) || 用户设置(可自定义, 设置→引擎→工作目录)
function getEffectiveWorkDir() {
    try {
        if (workDirOverride)
            return workDirOverride;
        const wd = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general?.workDir;
        return wd ? String(wd) : undefined;
    }
    catch {
        return undefined;
    }
}
function assertInsideWorkDir(p) {
    try {
        const wd = getEffectiveWorkDir();
        if (!wd)
            return false;
        const rp = require('path').resolve(p);
        const rw = require('path').resolve(wd);
        return rp === rw || rp.startsWith(rw + require('path').sep);
    }
    catch {
        return false;
    }
}
// ─── 浏览器自动化 ───────────────────────────────
// v0.3.4: agent 浏览器会话为 WebContentsView —— 同一 webContents 可内嵌主窗口实时显示, 零额外体积
const getBrowserWin = (key) => (0, browser_session_1.getBrowserSession)(key);
const getBrowserWinIfExists = (key) => (0, browser_session_1.getBrowserSessionIfExists)(key);
const waitLoad = (wc, ms = 15000) => new Promise(resolve => {
    const to = setTimeout(() => { cleanup(); resolve(); }, ms);
    const cleanup = () => { clearTimeout(to); wc.removeListener('did-finish-load', onLoad); wc.removeListener('did-fail-load', onFail); };
    const onLoad = () => { cleanup(); resolve(); };
    const onFail = () => { cleanup(); resolve(); };
    wc.once('did-finish-load', onLoad);
    wc.once('did-fail-load', onFail);
});
(0, browser_1.registerBrowserIpc)({ getBrowserWin, getBrowserWinIfExists, closeBrowserSession: browser_session_1.closeBrowserSession, waitLoad, getCurUrl: () => appShell.getBrowserCurUrl(), setCurUrl: (u) => { appShell.setBrowserCurUrl(u); }, showBrowserPanel: () => appShell.showBrowserPanel(), showBrowserFloat: () => appShell.showBrowserFloat(), hideBrowserFloat: () => appShell.hideBrowserFloat(), layoutLiveView: browser_session_1.layoutLiveView, showLiveView: browser_session_1.showLiveView, hideLiveView: browser_session_1.hideLiveView, isEmbeddedOpen: browser_session_1.isEmbeddedOpen });
// v0.3.1 C3: abort 双语义 —— 参数为 requestId 时中止该请求; 为 sid 时中止该会话全部请求; 空则全部
// ─── 启动 ──────────────────────────────────────────
// v0.3.8: 计划文档治理 —— 保留 30 天, 防止无限堆积
function cleanOldPlanDocs() {
    try {
        const dir = (0, path_1.join)(userDataPath, 'plans');
        if (!fs.existsSync(dir))
            return;
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.md'))
                continue;
            try {
                const p = (0, path_1.join)(dir, f);
                if (fs.statSync(p).mtimeMs < cutoff)
                    fs.unlinkSync(p);
            }
            catch { /* 单个文件失败不影响其余 */ }
        }
    }
    catch { /* 忽略 */ }
}
electron_1.app.whenReady().then(async () => {
    // GPU 状态检测(仅日志/状态查询, 不做运行时禁用)。
    // auto 模式下 GPU 不可用时 Chromium 原生自动降级为软件渲染, 无需手动调用
    // disableHardwareAcceleration(该 API 只能在 app ready 之前调用)。
    try {
        // 延迟 3s 等 GPU 进程完成初始化后再读取(立即读取会得到 disabled_off 等不准确初始值)
        setTimeout(() => {
            try {
                const gst = electron_1.app.getGPUFeatureStatus();
                safeLog('[RENDER] mode=' + rendererMode + ' gpuAcceleration=' + (gst?.gpuAcceleration || 'unknown') + ' webgl=' + gst?.webgl);
            }
            catch (e2) {
                safeError('[RENDER] gpu detect error:', e2 instanceof Error ? e2.message : String(e2));
            }
        }, 3000);
    }
    catch (e) {
        safeError('[RENDER] gpu detect error:', e instanceof Error ? e.message : String(e));
    }
    // v0.4.3: 开发热更新时(HQ_DEV_URL)主窗口走 Vite dev server, 不再起内部静态服务器(避免 dist 未构建时误服/报错)
    if (!process.env.HQ_DEV_URL) {
        serverPort = await (0, main_utils_1.startServer)(distDir);
    }
    appShell.createMenu();
    cleanOldPlanDocs();
    // v0.3.3: Chromium 缓存自动清理(设置→高级→缓存管理可关/改阈值, 默认开启)
    try {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const g = s?.general || {};
        if (g.autoCleanCache !== false) {
            const r = (0, misc_1.cleanChromiumCaches)(userDataPath, Number(g.autoCleanCacheSize) || 200);
            if (r.freedMb > 0)
                safeLog('[cache] 启动自动清理 Chromium 缓存: 释放 ' + r.freedMb + 'MB');
        }
    }
    catch (e) { /* 设置缺失/损坏时跳过清理 */
        console.debug('[swallow]', e);
    }
    // v0.4.3 Windows 任务栏/分组图标: 绑定 AppUserModelID(与打包 appId 一致), 让窗口图标生效
    try {
        electron_1.app.setAppUserModelId('com.huangquan.agent');
    }
    catch (e) {
        console.debug('[swallow]', e);
    }
    appShell.createWindow();
    const win0 = appShell.getWindow();
    if (win0)
        (0, browser_session_1.initBrowserViews)(win0, { live: rendererMode !== 'cpu' });
    appShell.createTray();
    // v0.4.3 系统级"随叫随到"热键(设置→快捷键 可改)
    try {
        const s0 = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const hk = String(s0?.general?.globalHotkey || '');
        if (hk)
            (0, hotkey_1.registerGlobalHotkey)(() => appShell.getWindow(), hk);
    }
    catch (e) { /* 设置缺失时用默认禁用手动触发 */
        console.debug('[swallow]', e);
    }
    // v0.4.x: 设置文件热重载韧性——
    // 外部有效修改即时传导渲染层; 无效修改保留最后可用配置并记录, 绝不拖垮/重启应用
    try {
        let settingsWatchContent = '';
        let settingsWatchTimer = null;
        try {
            settingsWatchContent = fs.readFileSync(settingsPath, 'utf-8');
        }
        catch { /* 首次无文件 */ }
        fs.watch(settingsPath, () => {
            if (settingsWatchTimer)
                clearTimeout(settingsWatchTimer);
            settingsWatchTimer = setTimeout(() => {
                try {
                    const cur = fs.readFileSync(settingsPath, 'utf-8');
                    if (cur === settingsWatchContent)
                        return;
                    JSON.parse(cur); // 语法校验; 内容未变或非法 JSON 都不传导
                    settingsWatchContent = cur;
                    appShell.getWindow()?.webContents.send('settings:changed');
                    safeLog('[settings] 检测到外部修改, 已热重载');
                }
                catch (e) {
                    safeLog('[settings] 外部修改无效, 保留最后可用配置: ' + (e instanceof Error ? e.message : String(e)));
                }
            }, 250);
        });
    }
    catch (e) {
        safeLog('[settings] 监听启动失败: ' + (e instanceof Error ? e.message : String(e)));
    }
    // v0.4.1: MCP 配置持久化后, 启动时按开关自动连接已保存的服务器(失败不阻塞启动)
    Promise.resolve().then(() => __importStar(require('./mcp/auto'))).then(m => m.autoConnectMcp(settingsPath)).catch(() => { });
    // v0.4.0 定稿: 会话索引与每日记忆维护延后到窗口显示后执行, 避免大记忆库阻塞首屏
    if (dbInit.ok) {
        setTimeout(() => {
            try {
                (0, session_index_1.refreshSessionIndex)(sessionsDir, true);
            }
            catch (e) {
                console.debug('[swallow]', e);
            }
            try {
                (0, decay_1.maybeRunDailyDecay)();
            }
            catch (e) {
                console.debug('[swallow]', e);
            }
        }, 800);
        setInterval(() => { try {
            (0, decay_1.maybeRunDailyDecay)();
        }
        catch { /* 忽略 */ } }, 3600 * 1000);
    }
    electron_1.app.on('activate', () => appShell.getWindow()?.show());
});
electron_1.app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isQuitting) {
    isQuitting = true;
    electron_1.app.quit();
} });
electron_1.app.on('before-quit', () => { isQuitting = true; (0, vision_1.stopLocalVisionProcesses)(); });
