import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settings'
import { v4 as uuidv4 } from 'uuid'

type Tab = 'general' | 'providers' | 'tools' | 'memory' | 'skills' | 'workspace'

const ALL_TOOLS = ['read','write','edit','exec_command','mkdir','grep','find','ls','system_info','web_search','web_fetch','screenshot','save_memory']
const TOOL_LABELS: Record<string,string> = {
  read:'读文件',write:'写文件',edit:'编辑文件',exec_command:'执行命令',mkdir:'创建文件夹',
  grep:'搜索内容',find:'查找文件',ls:'列出目录',system_info:'系统信息',
  web_search:'网页搜索',web_fetch:'网页抓取',screenshot:'截图',save_memory:'记忆'
}

export default function SettingsView() {
  const providers = useSettingsStore(s => s.providers)
  const general = useSettingsStore(s => s.general)
  const addProvider = useSettingsStore(s => s.addProvider)
  const removeProvider = useSettingsStore(s => s.removeProvider)
  const setTheme = useSettingsStore(s => s.setTheme)

  const [tab, setTab] = useState<Tab>('general')
  const [showNew, setShowNew] = useState(false)
  const [pType, setPType] = useState('deepseek'); const [pKey, setPKey] = useState('')
  const [pUrl, setPUrl] = useState('https://api.deepseek.com')
  const [pModels, setPModels] = useState<string[]>(['deepseek-v4-pro','deepseek-v4-flash','deepseek-chat','deepseek-reasoner'])
  const [pModel, setPModel] = useState('deepseek-v4-pro'); const [detecting, setDetecting] = useState(false)
  const [disabled, setDisabled] = useState<Set<string>>(new Set)
  const [memFacts, setMemFacts] = useState<string[]>([]); const [memNew, setMemNew] = useState('')
  const [skills, setSkills] = useState<{name:string;description:string}[]>([])
  const [sys, setSys] = useState<any>(null)
  const [autoStart, setAutoStart] = useState(false)
  const [workDir, setWorkDir] = useState('')

  useEffect(() => {
    if (tab === 'memory') window.huangquan.memory.load().then(m => setMemFacts(m.facts || []))
    if (tab === 'skills') window.huangquan.skills.list().then(setSkills)
    if (tab === 'workspace') window.huangquan.computer.systemInfo().then(s => { setSys(s); setWorkDir(s.workspaceDir) })
  }, [tab])

  const handleDetect = async () => { if(!pKey)return; setDetecting(true); try{const l=await window.huangquan.models.detect(pUrl,pKey);if(l.length){setPModels(l);setPModel(l[0])}}catch{};setDetecting(false) }
  const saveProv = () => { if(!pKey||!pModel)return; addProvider({id:uuidv4(),name:pType==='deepseek'?'DeepSeek':pType==='openai'?'OpenAI':'Custom',type:pType,apiKey:pKey,baseUrl:pUrl,models:pModels,selectedModel:pModel}); setPKey('');setShowNew(false) }
  const saveMem = async () => { if(!memNew.trim())return; const m=await window.huangquan.memory.load();m.facts.push(memNew.trim());await window.huangquan.memory.save(m);setMemFacts(m.facts);setMemNew('') }
  const clearMem = async () => { await window.huangquan.memory.save({facts:[],summaries:[]});setMemFacts([]) }
  const fmt = (b:number)=>b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'K':(b/1048576).toFixed(1)+'M'

  return (
    <div className="settings-view">
      <h2>设置</h2>
      <div className="settings-tabs">
        {(['general','providers','tools','memory','skills','workspace'] as Tab[]).map(k=>(
          <button key={k} className={`tab-btn ${tab===k?'active':''}`} onClick={()=>setTab(k)}>
            {k==='general'?'通用':k==='providers'?'模型':k==='tools'?'工具':k==='memory'?'记忆':k==='skills'?'技能':'工作台'}
          </button>
        ))}
      </div>
      <div className="settings-content">

        {/* 通用 */}
        {tab==='general'&&<section className="settings-section">
          <h3>外观</h3>
          <div className="setting-row"><label>主题</label><select value={general.theme} onChange={e=>setTheme(e.target.value)}>
            <option value="dark">暗色科技</option><option value="light">浅色温润</option><option value="black">深黑极简</option>
          </select></div>
          <h3 style={{marginTop:16}}>启动</h3>
          <div className="setting-row" onClick={()=>setAutoStart(!autoStart)}><label>开机自启</label><span className={`toggle ${autoStart?'on':''}`}/></div>
          <div className="setting-row"><label>最小化到托盘</label><span className="toggle on"/></div>
          <h3 style={{marginTop:16}}>工作目录</h3>
          <div className="setting-row">
            <label>路径</label>
            <input value={workDir} onChange={e=>setWorkDir(e.target.value)} style={{width:280,fontSize:11}}/>
          </div>
        </section>}

        {/* 模型 */}
        {tab==='providers'&&<section className="settings-section">
          <h3>API Provider</h3>
          {providers.map(p=>(
            <div key={p.id} className="provider-card">
              <div className="provider-info"><strong>{p.name}</strong><span className="provider-type">{p.type} · {p.selectedModel||p.models[0]}</span></div>
              <div className="provider-actions"><button className="btn-icon btn-danger" onClick={()=>removeProvider(p.id)}>删除</button></div>
            </div>
          ))}
          {!showNew?<button className="btn-primary" onClick={()=>setShowNew(true)}>+ 添加</button>:(
            <div className="provider-form">
              <div className="form-row"><label>类型</label><select value={pType} onChange={e=>{setPType(e.target.value);setPUrl(e.target.value==='deepseek'?'https://api.deepseek.com':e.target.value==='openai'?'https://api.openai.com':pUrl);setPModels(['deepseek-v4-pro','deepseek-v4-flash','deepseek-chat','deepseek-reasoner']);setPModel('deepseek-v4-pro')}}><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义</option></select></div>
              <div className="form-row"><label>API Key</label><input type="password" value={pKey} onChange={e=>setPKey(e.target.value)} placeholder="sk-..."/></div>
              <div className="form-row"><label>Base URL</label><input value={pUrl} onChange={e=>setPUrl(e.target.value)}/></div>
              <div className="form-row"><label>模型</label>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <select style={{flex:1}} value={pModel} onChange={e=>setPModel(e.target.value)}>{pModels.map(m=><option key={m} value={m}>{m}</option>)}</select>
                  <button className="btn-small" onClick={handleDetect} disabled={detecting||!pKey}>{detecting?'…':'检测'}</button>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}><button className="btn-primary" onClick={saveProv}>保存</button><button className="btn-small" onClick={()=>{setShowNew(false);setPKey('')}}>取消</button></div>
            </div>
          )}
        </section>}

        {/* 工具 */}
        {tab==='tools'&&<section className="settings-section">
          <h3>工具开关</h3>
          {ALL_TOOLS.map(t=>(
            <div key={t} className="setting-row" onClick={()=>{const n=new Set(disabled);n.has(t)?n.delete(t):n.add(t);setDisabled(n)}}>
              <label>{TOOL_LABELS[t]||t}</label>
              <span className={`toggle ${!disabled.has(t)?'on':''}`}/>
            </div>
          ))}
        </section>}

        {/* 记忆 */}
        {tab==='memory'&&<section className="settings-section">
          <h3>长期记忆</h3>
          <div className="provider-form">
            <input className="dropdown-input" placeholder="添加记忆..." value={memNew} onChange={e=>setMemNew(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveMem()}/>
            <div style={{display:'flex',gap:8}}><button className="btn-primary" onClick={saveMem}>保存</button><button className="btn-small btn-danger" onClick={clearMem}>清空</button></div>
          </div>
          {memFacts.map((f,i)=>(<div key={i} className="provider-card"><span style={{fontSize:12}}>{f}</span><button className="btn-icon btn-danger" onClick={async()=>{const m=await window.huangquan.memory.load();m.facts.splice(i,1);await window.huangquan.memory.save(m);setMemFacts(m.facts)}}>×</button></div>))}
        </section>}

        {/* 技能 */}
        {tab==='skills'&&<section className="settings-section">
          <h3>已安装技能</h3>
          {skills.map(s=>(<div key={s.name} className="provider-card"><div className="provider-info"><strong>{s.name}</strong><span className="provider-type">{s.description}</span></div><span className="toggle on"/></div>))}
          {skills.length===0&&<p className="empty-hint">无技能。将 SKILL.md 放入 resources/skills/ 目录</p>}
        </section>}

        {/* 工作台 */}
        {tab==='workspace'&&sys&&<section className="settings-section">
          <h3>系统信息</h3>
          <div className="setting-row"><label>平台</label><span>{sys.platform} · {sys.arch}</span></div>
          <div className="setting-row"><label>主机</label><span>{sys.hostname}</span></div>
          <div className="setting-row"><label>CPU</label><span>{sys.cpus}核</span></div>
          <div className="setting-row"><label>内存</label><span>{fmt(sys.freeMemory)} / {fmt(sys.totalMemory)}</span></div>
          <div className="setting-row"><label>运行</label><span>{Math.floor(sys.uptime/3600)}h</span></div>
        </section>}
      </div>
    </div>
  )
}
