import React, { useEffect, useState } from 'react'
import type { SystemInfo } from '../global'

export default function RightPanel() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    window.huangquan.computer.systemInfo().then(setSysInfo).catch(() => {})
  }, [])

  const formatBytes = (b: number) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'

  return (
    <aside className="sidebar-right">
      <div className="right-top-name">
        <h3>黄泉</h3>
        <span className="right-top-link">在线</span>
      </div>

      <div className="right-section">
        {sysInfo && (
          <div className="right-system-section">
            <h4>系统状态</h4>
            <div className="right-stat"><span>系统</span><span>{sysInfo.platform} · {sysInfo.arch}</span></div>
            <div className="right-stat"><span>CPU</span><span>{sysInfo.cpus} 核心</span></div>
            <div className="right-stat">
              <span>内存</span>
              <span>{formatBytes(sysInfo.freeMemory)} / {formatBytes(sysInfo.totalMemory)}</span>
            </div>
            <h4 style={{ marginTop: 14 }}>可用工具</h4>
            <div className="right-stat"><span>read</span><span>读取文件</span></div>
            <div className="right-stat"><span>write</span><span>写入文件</span></div>
            <div className="right-stat"><span>edit</span><span>编辑文件</span></div>
            <div className="right-stat"><span>exec</span><span>执行命令</span></div>
            <div className="right-stat"><span>grep</span><span>搜索内容</span></div>
            <div className="right-stat"><span>find / ls</span><span>文件管理</span></div>
            <div className="right-stat"><span>web</span><span>搜索/抓取</span></div>
            <div className="right-stat"><span>screen</span><span>截图</span></div>
            <div className="right-stat"><span>memory</span><span>记忆系统</span></div>
          </div>
        )}
      </div>
    </aside>
  )
}
