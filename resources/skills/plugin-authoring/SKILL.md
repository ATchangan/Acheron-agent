---
description: 给自己写并安装插件——用 install_plugin 生成 manifest+index.js, 校验通过即热加载, 无需重启
triggers: 写插件|装插件|插件开发|给自己加工具|install_plugin|plugin
---

# 自写插件规范

用户要你扩展自身能力时, 用 `install_plugin(name, description, code, overwrite?)` 一步完成; 改已有插件先 `read_plugin(name)` 再覆盖安装。

## index.js 协议
```js
module.exports = {
  tools: [{
    name: '工具名',               // 1-64 位字母数字_-，禁止 __
    description: '做什么、何时用', // ≤200 字
    params: { path: 'string', n: 'number' },
    run(args, ctx) {
      // 用 ctx.tools.run('read'|'write'|'exec_command', args) 读写文件/执行命令
      // 日志用 ctx.log('...')，用户配置项读 ctx.settings.<key>，返回字符串作为结果
      return 'ok'
    },
  }],
}
```

需要用户可配置项时, install_plugin 额外传 settings=[{key,label,type,default?,options?,hint?}]，
type 取 string/number/boolean/select；插件页会自动渲染设置卡片，值以 ctx.settings 注入 run。

## 沙箱红线
- 顶层禁止 require(仅 path)、fs、网络与 process；文件/命令只能经 ctx.tools.run 桥接(限工作目录 + 危险命令拦截)
- 禁止 eval/Function/WebAssembly；run 同步或 async 均可，10 秒超时，返回截断 4KB
- 文件名首字母小写、不越权；一个插件只做一件事，工具保持幂等

## 验证
安装后 `list_plugins` 查看，直接调 `plugin_<name>__<tool>(args)` 试跑；失败读报错修 code 后 overwrite=true 重装(版本自动 +1)。
