// electron/security/permission.ts — 安全权限系统
// 权限分级机制

type RiskLevel = 'L0'|'L1'|'L2'|'L3'|'L4'
type Operation = 'read'|'write'|'delete'|'execute'

const DANGEROUS_COMMANDS = ['rm -rf','format c:','format /','format c','del /f','del /s','rmdir /s','rd /s','shutdown','restart','mkfs','dd if=','reg delete','reg add','chmod 777','curl | bash','wget | sh','> /dev/sda','remove-item -recurse','remove-item -force','diskpart','format-volume','takeown','icacls','cipher /w','bcdedit','bootrec','mbr2gpt']
const SYSTEM_PATHS = ['C:\\Windows','C:\\Program Files','C:\\Program Files (x86)','/System','/usr','/etc','/boot','/var/log']
const READONLY_CMDS = ['dir','ls','cat','type','echo','get','find','grep','where','whoami','hostname','ipconfig','ping','nslookup','netstat','systeminfo','date','time','ver']

function isDangerousCmd(cmd:string):boolean{ return DANGEROUS_COMMANDS.some(d=>cmd.toLowerCase().includes(d)) }
function isSystemPath(p:string):boolean{ return SYSTEM_PATHS.some(s=>p.replace(/\\/g,'/').startsWith(s.replace(/\\/g,'/'))) }
function isReadonlyCmd(cmd:string):boolean{ return READONLY_CMDS.some(r=>cmd.toLowerCase().startsWith(r)) || cmd.startsWith('echo ') || cmd.startsWith('dir ') || cmd.startsWith('ls ') }

// 命令是否会改变系统状态(L2 分级细化): 只读查询不再打扰用户, 写/删除/发布类才需确认
export function isMutatingCommand(cmd: string): boolean {
  const c = String(cmd || '')
  return /(\bdel\b|\brm\b|\bremove\b|delete|erase|move|ren\b|copy|mkdir|mci\b|install|uninstall|publish|\bpush\b|\bcommit\b|\bmerge\b|\breset\b|drop\b|truncate|update|insert|\bkill\b|taskkill|stop-|restart-|set-|new-|remove-|clear-|format|mount|unmount|shutdown|reboot|chmod|chown|attrib|takeown|icacls|reg\s+(add|delete)|npm\s+(install|uninstall)|pip\s+(install|uninstall)|git\s+(push|commit|merge|reset|clean|checkout\s+-)|docker\s+(rm|stop|kill|build|push)|Start-Process|Invoke-WebRequest|>|>>)/i.test(c)
}

export function assessRisk(action:{type:'filesystem'|'terminal'|'screenshot',operation?:Operation,path?:string,command?:string}):RiskLevel{
  if(action.type==='filesystem'){
    if(action.operation==='read')return'L0'
    if(action.operation==='write'){
      if(action.path&&isSystemPath(action.path))return'L3'
      return'L1'
    }
    if(action.operation==='delete')return isSystemPath(action.path||'')?'L4':'L3'
  }
  if(action.type==='terminal'){
    if(isDangerousCmd(action.command||''))return'L4'
    if(!isReadonlyCmd(action.command||''))return'L2'
    return'L1'
  }
  return'L1'
}

export function formatRiskWarning(level: RiskLevel, tool: string, args: Record<string, unknown>): string | null {
  if(level==='L0'||level==='L1')return null
  const a=JSON.stringify(args).slice(0,80)
    if(level==='L3'||level==='L4')return`[高风险] ${tool}(${a}) — 可能造成不可逆影响，需确认后执行`
    return`[注意] ${tool}(${a}) — 将在沙箱外执行`
}
