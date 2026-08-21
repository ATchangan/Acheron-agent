; 自定义 NSIS 脚本: 安装/卸载时默认展开详情面板, 进度条旁边能看到正在做什么
!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend
