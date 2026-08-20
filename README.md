# PowerShell++

<div align="center">

**Windows 桌面端 AI 编程工作台：Codex 风格的聊天界面 + 以会话为核心的 PowerShell 终端管理器**

![Version](https://img.shields.io/badge/version-0.3.1-blue)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Stack](https://img.shields.io/badge/Electron-React%2019-47848F)
![Runtime](https://img.shields.io/badge/PowerShell-ConPTY-5391FE)

</div>

## 简介

PowerShell++ 是一个 Windows 桌面应用，把「AI 编程助手」和「终端管理器」合成一个工作台：

- **AI 聊天（Layer 2）**：Codex 风格的对话界面，后台驱动本机的 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code)，支持项目分组、会话置顶、消息排队、附件图片、Markdown 渲染
- **终端管理（Layer 0/1）**：统一管理多个 PowerShell / Kimi / Codex 终端会话，**所见即保存，下次自动恢复**——终端数量、类型、名称、顺序、工作目录、当前选中项全部自动持久化

关闭应用前在跑 Kimi，重启后 Kimi 自动回来（`--continue` 续上聊天记录）；聊天会话还可以一键「在终端中继续」，切换到交互式 CLI 获得完整能力。

## 功能特性

### AI 聊天

- 对话按项目分组，侧边栏平铺展开，支持置顶、重命名、删除
- 流式输出：工具调用以可折叠块展示（命令 + 输出），执行中脉冲提示
- 消息排队：AI 回答期间可继续输入排队，自动按序发送；点停止即「打断并引导」
- Markdown 渲染：标题 / 列表 / 表格 / 代码块（语言标签 + 一键复制）/ 外链默认走系统浏览器
- 附件：粘贴截图、拖拽文件、多选文件对话框，图片缩略图 + 点击放大
- 模型与思考强度点选（自动读取本机 Kimi CLI 配置），可按会话切换
- 深色 / 浅色主题

### 终端会话

- 项目会话自动命名（按你向 CLI 提出的首个问题），模型 / 权限 / 思考强度点选
- Shell Integration：`cd` 后工作目录自动同步；后台会话输出流动 / 未读指示
- 窗口未聚焦且任务输出停止 3 秒，弹系统通知，点击直达对应会话
- 状态语义：◌ 启动中（黄）/ ● 运行中（绿）/ ○ 已退出（灰）/ ! 错误（红）

## 下载

前往 [Releases](https://github.com/landepend/PowerShell-/releases) 下载最新版本：

- `PowerShell++-Setup-x.y.z.exe` —— NSIS 安装包
- `PowerShell++-x.y.z.exe` —— 免安装便携版

> 前置要求：AI 聊天功能依赖本机已安装并登录 [Kimi Code CLI](https://www.kimi.com/code/docs/en/)。

## 开发

```bash
npm install        # node-pty 自带 N-API 预编译二进制，无需 node-gyp
npm run dev        # 开发模式（HMR）
npm run build      # 构建到 out/
npm run typecheck  # TS 类型检查
npm run dist       # 打包到 release/（portable 单文件 + NSIS 安装包）
```

打包下载依赖被代理拦截时，先设镜像：

```bash
export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```

## 架构

三层分离，能力自下而上暴露：

```text
Layer 0   原生 PowerShell / Kimi CLI（不改动）
Layer 1   Electron 主进程 + preload：PTY、工作区持久化、聊天进程管理，
          通过 window.pss（src/shared/types/api.ts + src/shared/ipc.ts）向上暴露
Layer 2   src/renderer/src/chat-ui/：聊天界面，只依赖 api.ts 契约
```

```text
src/
├─ main/                 # Electron 主进程
│  ├─ chat/              # ChatManager / ChatRunner（kimi headless 进程）
│  ├─ ipc/               # IPC 通道注册
│  ├─ terminal/          # PtyManager / SessionManager / ShellIntegration
│  └─ workspace/         # WorkspaceManager（防抖 + 原子保存 + 备份）
├─ preload/index.ts      # contextBridge -> window.pss
├─ renderer/src/
│  ├─ chat-ui/           # Codex 风格聊天 UI（Layer 2）
│  └─ components/        # 终端管理 UI
└─ shared/               # 主/渲染进程共享类型与 IPC 通道
```

聊天后端：以 `kimi -p <prompt> --output-format stream-json`（+`--session` 续聊）逐轮驱动，
stdout 的 JSONL 事件流经 IPC 推给渲染进程；思考强度通过 `KIMI_MODEL_THINKING_EFFORT`
环境变量按会话注入。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl+Shift+N / P | 新建 PowerShell 会话 |
| Ctrl+W | 关闭当前会话 |
| Ctrl+Tab / Ctrl+Shift+Tab | 下一个 / 上一个会话 |
| Ctrl+C / Ctrl+V | 有选区时复制 / 粘贴 |
| Ctrl+Enter / Shift+Enter | 终端内换行（等同 kimi 的 Ctrl+J，不触发发送） |
| 终端内鼠标右键 | 粘贴剪贴板内容 |

## 数据与日志

开发模式下位于项目根目录（打包后位于 userData），均不进入版本库：

```text
data/workspace.json         # 会话元数据（唯一事实来源）
data/chats/<chatId>.jsonl   # 聊天记录
data/attachments/           # 聊天附件
logs/app.log                # 应用事件日志（不记录终端输入输出）
```

保存策略：500ms 防抖 + 原子写入（`.tmp` → rename），损坏时自动回退到备份文件。

## 技术栈

Electron · TypeScript · React 19 · zustand · xterm.js · node-pty（Windows ConPTY）· marked + DOMPurify

## License

尚未确定，保留所有权利。如计划开源发布，请先选择许可证（建议 MIT）。
