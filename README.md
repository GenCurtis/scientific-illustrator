# Scientific Illustrator

[中文说明](#中文说明) · [English guide](#english-guide) · [MIT License](LICENSE)

一个让 Codex 在 **Microsoft PowerPoint、WPS 演示或 draw.io 桌面端**逐步绘制、复刻、审查并修正科研插图的插件。目标不是把参考图整张贴进画布，而是尽可能还原为可编辑的文字、形状、连接线、表格、图表和原子图像素材。

> **项目关系：本项目是上一研究项目 [`icebird1998/drawio-scientific-illustrator`](https://github.com/icebird1998/drawio-scientific-illustrator) 的集成升级优化版本。**前代项目聚焦 draw.io；本项目在保留并升级 draw.io 能力的同时，加入 PowerPoint 原生对象控制，并让两种软件遵循同一套设计、绘图、审查、纠正和可编辑性验收标准。

**开发人：科研up主:进击的土博**<br>
GitHub: [@icebird1998](https://github.com/icebird1998)

> 当前版本：`1.5.0`。Windows Microsoft PowerPoint 使用 COM 实时控制；macOS Microsoft PowerPoint 在任务窗格连接后使用 Office.js 与 `context.sync()` 真正逐对象刷新，未连接时回退到安全的 OOXML 工作副本；Windows/macOS WPS 演示继续使用标准 PPTX 原生对象后端。

### 版本发布与旧版回退

- 最新稳定版：[`v1.5.0`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.0)，加入 Windows/macOS 双平台下 draw.io、Microsoft PowerPoint 与 WPS 演示的统一适配，以及 Mac PowerPoint Office.js 实时后端；
- 旧版归档：[`v1.3.0`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.3.0)，保留首次公开发布时的 Windows PowerPoint COM 与 draw.io 实现；
- 每个公开版本使用独立且不可移动的 Git 标签和 GitHub Release。发布新版不会覆盖、重写或删除旧版本，旧版源码压缩包会继续由 GitHub 提供；
- `main` 分支和一键安装器默认跟随最新版。如需回退，请克隆仓库后执行 `git checkout v1.3.0`，再从该目录注册 Marketplace 并安装插件。

---

## 中文说明

### 这个项目解决什么问题

普通“图片转 PPT / draw.io”经常只得到一张扁平图片，或者只重画少数外框。Scientific Illustrator 把“最大程度可编辑”作为硬约束：

- 文字必须优先使用原生文本对象，而不是烘焙在图片里；
- 矩形、圆、分区、图例、标注和箭头优先使用原生形状与连接线；
- 表格和图表优先使用原生表格、原生图表或可编辑组合对象；
- 只有确实无法用目标软件原生图元可靠表达的区域才允许插图；
- 插图必须尽量裁成语义单一的“原子图像”，不能用一张大图遮住本可拆分的文字和形状；
- 每完成一个面板就进行结构检查和渲染检查，有问题先修正，再绘制下一区域；
- 全图完成后继续审查、纠正、复查，直到审查者没有可复现的阻断问题。

### 从上一研究项目升级了什么

| 项目 | 上一研究项目 | Scientific Illustrator |
|---|---|---|
| 目标软件 | draw.io | Microsoft PowerPoint + WPS 演示 + draw.io |
| 绘制策略 | draw.io 实时图模型 | 双后端统一语义、分别映射原生对象 |
| 角色流程 | 重绘与检查 | 设计者 → 绘图者 → 审查者 → 纠正者闭环 |
| 可编辑性 | 优先使用 draw.io 图元 | 深层可编辑性审计 + 原子栅格约束 |
| 布局 | 逐步绘制与调整 | 对齐、等距、分区网格、连接线安全间距 |
| 质量门 | 截图检查 | 局部结构 + 局部渲染 + 全图结构 + 全图渲染 |
| 无参考图设计 | 基础支持 | 先设计布局与连线路由，再按面板执行 |

新项目不是只给 PowerPoint 增加一套独立逻辑。draw.io 与 PowerPoint 都要先检测能力、逐区域构建、保持深层可编辑、执行相同审查标准，并交付各自的原生文件。

### 双后端能力对照

| 统一能力 | PowerPoint 实现 | draw.io 实现 |
|---|---|---|
| 状态与连接 | 当前 PowerPoint 应用、演示文稿和幻灯片 | 可见 draw.io 桌面画布与 graph 状态 |
| 能力检测 | 枚举可用形状、连接线、表格、图表、图片、组合与布局操作 | 枚举可用 cell、edge、表格、图表、图片、组合与布局操作 |
| 文本与基础图形 | 原生文本框、AutoShape | 原生 vertex 与 HTML/text label |
| 线与箭头 | 原生 line / connector，连接点和箭头端点 | 原生 line / edge，正交路由和端点样式 |
| 表格 | PowerPoint 原生 Table | 可编辑 cell 组合表格 |
| 图表 | PowerPoint 原生 Chart | 可编辑组合图表 |
| 图片 | 图片对象、裁切与位置控制 | image cell、裁切后的原子素材 |
| 结构操作 | 命名、复制、分组、解组、层级、对齐、等距 | cell ID、复制、分组、解组、层级、对齐、等距 |
| 审查 | 结构检查 + 幻灯片导出图 | graph 检查 + 画布截图 |
| 交付 | `.pptx` + 幻灯片预览图 | `.drawio` + PNG/SVG/PDF/JPG |

实现对象不同，但语义结果、可编辑性要求和通过门槛相同。用户只需选择 PowerPoint 或 draw.io，插件会自动选择并编排所需 Skill，不要求手动指定 `$skill-name`。

### 四角色质量闭环

1. **设计者（Designer）**：有参考图时先拆解面板、对象、层级、间距和连接关系；无参考图时先建立视觉语法、栅格和路由方案。
2. **绘图者（Drawer）**：检测目标软件能力，优先使用原生可编辑对象，按面板或逻辑区域逐步绘制。
3. **审查者（Reviewer）**：同时检查视觉一致性与深层可编辑性，包括文字排版、边距、对齐、箭头净空、层级、分组和图片是否还能继续拆分。
4. **纠正者（Corrector）**：把问题转换成最小、可执行、对象级的修改指令，再交回绘图者执行。

每个局部都执行 `绘图 → 结构检查 → 渲染检查 → 审查 → 纠正 → 再检查`。全图完成后再执行同样的整体循环。一次 MCP 调用成功不等于绘图合格；必须以对象结构和真实渲染结果共同判断。

### 系统要求

#### 通用

1. 支持插件的 Codex 桌面应用或 Codex CLI；
2. Git；
3. 从 Codex 捆绑运行环境以外启动 MCP 时，需要可用的 Node.js，推荐 Node.js 22 或更高版本；
4. 安装后重启 Codex，并新建任务以加载新的 Skill 与 MCP 工具。

### Windows/macOS × 三软件兼容矩阵

| 目标软件 | Windows | macOS |
|---|---|---|
| draw.io Desktop | 支持；通过本机调试通道直接调用可见画布的 graph API，属于主要测试路径 | 支持；使用同一 graph API 和可编辑 cell/edge，对具体 Electron 版本仍应执行启动与导出烟测 |
| Microsoft PowerPoint | 支持；使用 Office COM 直接控制当前演示文稿，逐对象实时刷新 | 支持；任务窗格连接时使用 Office.js `PowerPoint.run()` + `context.sync()`，未连接时回退到可编辑 OOXML 工作副本 |
| WPS 演示 | 支持；使用标准可编辑 PPTX/OOXML 工作副本并在 WPS 中打开 | 支持；使用同一标准可编辑 PPTX/OOXML 工作副本并在 WPS 中打开 |

六种组合都是正式兼容目标，但后端体验不同：PowerPoint COM 和已连接的 Mac Office.js 是当前画布实时控制；WPS 是文件式可编辑后端，不应宣称为 COM/Office.js 式实时控制。字体、SVG、图表主题和应用版本差异仍需在交付目标软件中做最终渲染检查。

#### PowerPoint / WPS 演示

- Windows Microsoft PowerPoint：使用本机 PowerShell 和 Office COM 对象模型进行最快的实时控制；
- macOS Microsoft PowerPoint：优先使用本机 HTTPS 命令桥和 Office.js 任务窗格，通过 `PowerPoint.run()` 与 `context.sync()` 直接更新当前幻灯片；任务窗格未连接时使用 `python-pptx` OOXML 工作副本兜底；
- Windows/macOS WPS 演示：使用同一标准 PPTX 原生对象后端，并由 WPS 打开；
- Office.js 实时后端需要本机 OpenSSL 生成 localhost 证书、用户手动确认信任，以及旁载仓库内的加载项 manifest；插件不会自动修改系统证书信任；
- 文件后端要求可用的 Python 3 与 `python-pptx`。安装器会优先复用 Codex 捆绑环境，否则建立插件本地虚拟环境；
- PNG/PDF 预览优先使用本机 LibreOffice 与 Poppler；
- 不使用系统鼠标键盘模拟。目标应用处于模态对话框时，应先关闭对话框。

#### draw.io

- [draw.io Desktop](https://www.drawio.com/)；
- Windows 与 macOS 均为支持平台；Windows 是主要测试路径，macOS 使用相同 graph API，并应针对已安装的 Electron 版本执行启动、保存和导出烟测；
- 插件通过仅限本机的调试通道调用 draw.io 自身 graph API，不先生成 XML 冒充实时绘制。

### 安装

#### 方法一：让 Codex 安装

在一个具备终端权限的 Codex 任务中粘贴：

```text
请安装公开 Codex 插件：https://github.com/icebird1998/scientific-illustrator。
把仓库克隆到本地，将仓库根目录注册为 Codex Marketplace，然后安装
scientific-illustrator@scientific-illustrator-tools。完成后告诉我何时重启 Codex。
```

#### 方法二：Windows 一键安装

先检查 [`install.ps1`](install.ps1)，然后运行：

```powershell
$p="$env:TEMP\scientific-illustrator-install.ps1"; Invoke-WebRequest https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.ps1 -OutFile $p; powershell -ExecutionPolicy Bypass -File $p
```

#### 方法三：macOS/Linux 一键安装

该方式可安装 draw.io、Mac Microsoft PowerPoint 和 Mac WPS 演示能力：

```bash
curl -fsSL https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.sh | bash
```

#### 方法四：手动、可审计安装

PowerShell：

```powershell
git clone https://github.com/icebird1998/scientific-illustrator.git
Set-Location scientific-illustrator
codex plugin marketplace add (Get-Location).Path
codex plugin add scientific-illustrator@scientific-illustrator-tools
```

macOS/Linux：

```bash
git clone https://github.com/icebird1998/scientific-illustrator.git
cd scientific-illustrator
codex plugin marketplace add "$(pwd)"
codex plugin add scientific-illustrator@scientific-illustrator-tools
```

安装后请重启 Codex，并创建一个新任务。复杂参考图建议使用具备较强视觉理解与推理能力的模型，并为多轮局部审查预留足够时间。

### Mac PowerPoint：启用真正逐对象绘制

普通插件安装会保留 OOXML 兜底，但 Office.js 实时任务窗格需要额外旁载一次。进入仓库后执行：

```bash
node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare
openssl x509 -in "$HOME/.codex/scientific-illustrator/officejs/localhost.crt" -text -noout
node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload
```

这些命令会生成只供 `https://localhost:17645` 使用的证书，并把已审查的 `officejs/manifest.xml` 复制到 Mac PowerPoint 的 WEF 加载项目录；不会更改证书信任。随后：

1. 在 macOS“钥匙串访问”中打开并检查 `~/.codex/scientific-illustrator/officejs/localhost.crt`，由你手动设置信任；
2. 完全退出并重新打开 Microsoft PowerPoint；
3. 在 Codex 新任务中选择 Scientific Illustrator，先要求它调用一次 `powerpoint_officejs_status`，启动本机 HTTPS 桥；
4. 打开要绘制的空白或目标演示文稿，在 **插入 → 我的加载项** 中打开 **Scientific Illustrator Live** 并保持任务窗格开启；
5. 再调用一次 `powerpoint_officejs_status`。只有返回 `connected=true` 且 `backend=officejs-context-sync` 后才开始绘制。

证书、私钥和会话令牌只用于本机回环连接。若不希望旁载加载项，可以跳过本节，Mac PowerPoint 会继续使用已有的 OOXML 可编辑文件后端。

### 从旧项目迁移

旧项目会继续保留，不会被本项目覆盖。由于两个插件都包含 draw.io 工具，建议迁移时在 Codex 插件设置中停用或卸载 `drawio-scientific-illustrator`，再启用 `scientific-illustrator`，避免重复工具造成选择歧义。确认新项目工作正常后，再删除旧项目的本地克隆。

### 如何调用：Skill 自动选择

在 Codex 输入框中选择 **Scientific Illustrator** 插件，或者在支持插件链接的环境中使用：

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
```

然后只需要告诉插件：

1. 使用 PowerPoint 还是 draw.io；
2. 是复刻参考图、无参考图设计、检查现有插图，还是修正问题；
3. 输出路径、画面比例、语言或期刊风格等约束。

插件会根据任务自动选择设计、复刻、绘图、审查和纠正 Skill。不要在提示词中手动罗列 Skill，除非你确实想强制某一阶段。

> `@personal` 是个人 Marketplace 安装的插件链接。若你从本仓库 Marketplace 安装后插件显示在其他来源下，请在 Codex 输入框中直接选择 **Scientific Illustrator**；正文提示词保持不变。

### PowerPoint / WPS 演示提示词

如需强制指定应用，在第一句写“使用 Mac PowerPoint”“使用 Windows PowerPoint”“使用 Mac WPS”或“使用 Windows WPS”。插件会把它映射为 `host_application=powerpoint` 或 `host_application=wps`。未指定时使用 `auto`，优先 Microsoft PowerPoint。

#### Mac PowerPoint：实时逐对象复刻

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
使用 Scientific Illustrator，在当前 Mac PowerPoint 中复刻这张参考图。开始前必须调用
powerpoint_officejs_status，确认 connected=true，再用 powerpoint_set_backend 将本次任务
锁定为 officejs；如果任务窗格未连接就暂停并告诉我，不要回退后仍声称是实时绘制。
使用 powerpoint_draw_sequence 的 per_object 模式，每个对象完成 context.sync() 后再继续。
优先使用可编辑文字、形状、表格和规整的几何箭头；Office.js 无法原生创建的连接符或图表
必须明确标为可编辑组合对象。只有预先紧密裁切的最小原子图像才能插入。每完成一个区域
导出当前幻灯片、与原图比较并修正，最后做全局检查，保存可编辑 PPTX 和预览图。
```

#### 有参考图：最大程度可编辑复刻

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
使用插件在 PowerPoint 或 WPS 演示中复刻我上传的参考图。先连接目标应用，调用状态、
能力检测和结构检查工具；若没有演示文稿则新建。优先使用 PowerPoint 原生可编辑的
文字、形状、连接符、表格和图表。只有无法用原生对象可靠表达的最小语义区域才允许
抠图插入，并继续检查它是否还能拆得更细。按面板逐步绘制，每完成一个局部就同时做
结构检查和导出图视觉检查，有问题先修正再画下一区域。特别检查文字位置、对齐、等距、
箭头端点与矩形边界净空、层级和深层可编辑性。全图完成后反复审查和纠正，直到审查者
没有可复现的阻断问题，再保存为 PPTX 并导出最终幻灯片预览图。
```

#### 无参考图：从研究内容设计

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
根据下面的研究内容，在 PowerPoint 中设计一张 16:9 的可编辑科学图摘要。先规划信息
层级、面板栅格、视觉语法和箭头通道，再开始绘制。文字、形状、表格、图表和连接符
使用 PowerPoint 原生对象；统一字体、线宽、圆角、间距和配色。每完成一个面板就检查
布局与可编辑性并修正，最后执行全图审查，确认无重叠、无文字溢出、箭头整齐且不压住
矩形后保存。研究内容：……
```

#### 只读检查当前 PowerPoint

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
先连接当前 PowerPoint，调用状态、能力检测和检查工具，只读取演示文稿结构，不做修改。
报告当前页尺寸、幻灯片数量、对象类型、命名、层级、文本、组合关系和潜在可编辑性问题。
```

### draw.io 提示词

#### 有参考图：最大程度可编辑复刻

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
使用插件在可见的 draw.io 桌面画布中复刻我上传的参考图。先启动或连接 draw.io，调用
状态、能力检测和结构检查工具。优先使用原生可编辑的文字、vertex、edge、组合表格和
组合图表；只有无法用原生图元可靠表达的最小语义区域才允许作为原子图片插入。按面板
逐步绘制，每完成一个局部就检查 graph 结构并截取真实画布进行视觉审查，有问题先修正
再继续。特别检查对齐、等距、文本换行、正交箭头路由、端点净空、层级、组合关系和图片
是否还能拆分。全图完成后反复审查和纠正，直到没有可复现的阻断问题，再保存 .drawio，
校验文件并导出 2000 px PNG 和 SVG。
```

#### 无参考图：从研究内容设计

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
根据下面的研究内容，在 draw.io 中设计一张可编辑科研流程图。先规划阅读方向、面板栅格、
节点尺寸和独立箭头通道，再开始绘制。所有重复节点使用统一样式并精确对齐、等距；连接线
优先正交路由，避免穿过节点或与文字相交。每完成一个区域就截图检查并修正，最后执行全图
结构与渲染审查，通过后保存 .drawio 并导出 PNG、SVG。研究内容：……
```

#### 只读检查当前 draw.io

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
连接当前可见的 draw.io 画布，调用状态、能力检测、结构检查和截图工具，只读取当前图，
不要修改。报告页面、对象、连接关系、分组、层级、文本、布局和深层可编辑性问题。
```

### 典型工具流程

Mac PowerPoint Office.js 实时模式执行：

```text
powerpoint_officejs_status
→ powerpoint_set_backend（officejs）
→ powerpoint_status + powerpoint_get_capabilities
→ powerpoint_inspect
→ powerpoint_draw_sequence（per_object，每步等待 context.sync）
→ powerpoint_audit_figure + powerpoint_export_slide_image
→ 审查 / 纠正 / 再检查
→ powerpoint_save（导出当前可编辑 PPTX）
```

Windows COM 或 PowerPoint/WPS OOXML 模式通常执行：

```text
powerpoint_status
→ powerpoint_get_capabilities
→ powerpoint_new_presentation（仅在需要时）
→ powerpoint_inspect
→ 分面板添加原生对象
→ powerpoint_audit_figure + powerpoint_export_slide_image
→ 审查 / 纠正 / 再检查
→ powerpoint_save
```

draw.io 通常执行：

```text
drawio_live_launch
→ drawio_live_status
→ drawio_live_get_capabilities
→ drawio_live_inspect
→ 分区域添加原生 cell / edge / 可编辑组合对象
→ drawio_live_audit_figure + drawio_live_screenshot
→ 审查 / 纠正 / 再检查
→ drawio_live_save_snapshot
→ drawio_validate + drawio_export
```

这些顺序是质量协议，不是要求用户手动调用每个工具。插件会按当前任务和只读/写入权限自动执行。

### 更新

再次运行对应的一键安装脚本即可。安装器会对已有仓库执行安全的快进更新并重新安装插件。也可以手动执行：

```powershell
git -C "$HOME\.codex\marketplaces\scientific-illustrator" pull --ff-only
codex plugin add scientific-illustrator@scientific-illustrator-tools
```

更新后重启 Codex 并新建任务。

### draw.io 可选配置

| 环境变量 | 作用 | 默认值 |
|---|---|---|
| `DRAWIO_PATH` | 显式指定 draw.io 可执行文件 | 自动检测 |
| `DRAWIO_LIVE_PORT` | 首选本机调试端口 | `9333`，冲突时选择附近空闲端口 |
| `DRAWIO_LIVE_PROFILE` | draw.io/Electron 独立用户目录 | `~/.drawio-live-mcp/<port>` |

PowerShell 示例：

```powershell
$env:DRAWIO_PATH = "D:\Apps\draw.io\draw.io.exe"
```

Windows Microsoft PowerPoint 使用本机 Office COM；WPS 和 Mac PowerPoint 的兜底后端使用本地 PPTX 工作副本。Mac PowerPoint Office.js 模式会在 `127.0.0.1:17645` 开启 HTTPS 回环端点，只接受带随机会话令牌的本机任务窗格连接，不监听公网地址。若连接失败，先关闭目标应用的弹窗或受保护视图，再重试状态检查。

演示文稿后端还支持：

| 环境变量 | 作用 | 默认值 |
|---|---|---|
| `SCIENTIFIC_ILLUSTRATOR_PPT_HOST` | `auto`、`powerpoint` 或 `wps` | `auto` |
| `SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND` | `auto`、`officejs`、`com` 或 `ooxml` | `auto` |
| `SCIENTIFIC_ILLUSTRATOR_PYTHON` | 显式指定含 `python-pptx` 的 Python | 自动检测 |
| `SCIENTIFIC_ILLUSTRATOR_OFFICEJS_PORT` | Office.js 本机 HTTPS 端口；修改后还需同步修改 manifest | `17645` |
| `SCIENTIFIC_ILLUSTRATOR_OFFICEJS_CERT` | 显式指定 localhost 证书 | `~/.codex/scientific-illustrator/officejs/localhost.crt` |
| `SCIENTIFIC_ILLUSTRATOR_OFFICEJS_KEY` | 显式指定 localhost 私钥 | `~/.codex/scientific-illustrator/officejs/localhost.key` |
| `WPS_PRESENTATION_PATH` | Windows 上显式指定 `wpp.exe` 或 `wpsoffice.exe` | 自动检测 |
| `SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC` | 设为 `0` 时只更新工作副本，不自动打开应用 | `1` |

### 常见问题

- **插件安装后不可见**：重启 Codex，并新建任务；旧任务不会自动加载新工具。
- **`node` 不可用**：安装 Node.js 22+，或确认 Codex 捆绑运行环境可供插件使用。
- **PowerPoint/WPS 连接失败**：先调用状态工具确认 `host_application` 和 `backend`。Windows Microsoft PowerPoint 检查 COM 与受保护视图；Mac PowerPoint/WPS 检查应用路径和 `python-pptx`。
- **Mac PowerPoint 看不到逐对象过程**：确认任务窗格仍打开，`powerpoint_officejs_status.connected=true`，并在第一项绘制操作前调用 `powerpoint_set_backend(officejs)`；若结果是 `python-pptx-ooxml+application-reload`，当前使用的是文件刷新兜底而非实时后端。
- **任务窗格显示证书或网络错误**：检查 localhost 证书是否由用户手动信任、端口 `17645` 是否被占用，并在 Codex 中先调用 `powerpoint_officejs_status` 启动桥接器后重新打开加载项。
- **draw.io 找不到**：安装桌面版，或设置 `DRAWIO_PATH`。
- **draw.io graph 未就绪**：关闭插件此前启动但已失效的 draw.io 窗口后重试。
- **旧插件与新插件同时出现**：停用旧的 `drawio-scientific-illustrator`，只保留新插件。
- **箭头压住矩形**：要求审查连接线端点与矩形边界净空，并让纠正者给出对象级路由调整；不要用截图掩盖。
- **文字位置或换行不一致**：检查文本框边距、字体、字号、段落对齐、行距和边界框，不要只移动整张图片。
- **图片仍可继续拆分**：要求深层可编辑性审查；把其中的文字、图标、框线和箭头重建为原生对象，只保留最小原子图像。
- **导出失败**：确认目标目录可写，并验证 PowerPoint/draw.io 桌面端能够手工保存到同一目录。

### 项目结构

```text
scientific-illustrator/
├─ .agents/plugins/marketplace.json
├─ plugins/scientific-illustrator/
│  ├─ .codex-plugin/plugin.json
│  ├─ .mcp.json
│  ├─ scripts/
│  │  ├─ live-server.mjs          # draw.io 实时 MCP
│  │  ├─ server.mjs               # draw.io 文件检查与导出 MCP
│  │  ├─ powerpoint-server.mjs    # PowerPoint MCP
│  │  ├─ powerpoint-bridge.ps1    # Windows Microsoft PowerPoint COM 桥接
│  │  ├─ powerpoint-mac-bridge.py # Mac PowerPoint 与跨平台 WPS OOXML 桥接
│  │  ├─ officejs-bridge.mjs      # localhost HTTPS 命令桥与逐步确认
│  │  └─ officejs-setup.mjs       # 证书生成和 Mac manifest 旁载（不修改信任）
│  ├─ officejs/                    # PowerPoint Office.js manifest 与任务窗格
│  └─ skills/                     # 设计、双端绘图、审查与纠正流程
├─ scripts/                       # 仓库校验与 MCP 冒烟测试
├─ install.ps1
└─ install.sh
```

### 安全与隐私

- draw.io 调试端点只绑定 `127.0.0.1`；
- Windows Microsoft PowerPoint 使用本机 COM；Mac PowerPoint Office.js 桥只绑定 `127.0.0.1`、使用 HTTPS 和随机令牌；Mac/WPS OOXML 使用本地 PPTX 工作副本；所有演示文稿后端均不开放公网服务；
- Office.js 设置脚本只生成证书和旁载 manifest，不会自动修改 macOS 钥匙串信任；
- 不使用系统级鼠标键盘自动化；
- 插件不包含遥测或托管后端；
- 参考图和文档是否进入模型上下文取决于 Codex 与模型提供商设置，详见 [PRIVACY.md](PRIVACY.md)；
- 执行远程安装脚本前，请先检查脚本内容和目标提交。

### 已知限制

- Windows PowerPoint COM 提供最完整的原生对象模型；连接任务窗格后的 Mac PowerPoint 可以真正逐对象刷新，未连接时和 WPS 一样使用较慢的文件级 OOXML 刷新；
- PowerPoint Office.js 当前不公开线条箭头端点、连接点绑定或原生图表创建。实时后端会把箭头/连接线和常规图表构造成命名、可编辑的几何组合并明确报告；若必须使用数据驱动的原生图表或真正附着连接符，应在绘制前选择 COM/OOXML；
- Office.js 的 `ShapeFill.setImage` 不公开图片裁切参数，因此实时模式只接受已经紧密裁切的原子图像；
- WPS 与 Microsoft PowerPoint 的字体度量、图表主题和 SVG 渲染可能有差异，最终预览必须在目标应用中检查；
- 显微照片、复杂纹理、热图等连续栅格内容不能被无损转换成原生矢量对象，插件会尽量把它们限制在最小语义区域；
- 参考图分辨率、字体可用性和目标软件渲染差异会影响像素级一致性；
- “审查者没有问题”指在当前证据、阈值和可复现检查范围内通过，不代表数学意义上的绝对一致。

---

## English guide

### Overview

Scientific Illustrator is a Codex plugin for building, recreating, reviewing, and correcting scientific figures in Microsoft PowerPoint, WPS Presentation, or draw.io Desktop. It prioritizes native editable objects over flattened screenshots.

This project is the **integrated, upgraded, and optimized successor** to [`icebird1998/drawio-scientific-illustrator`](https://github.com/icebird1998/drawio-scientific-illustrator). It preserves and expands the draw.io implementation, adds native PowerPoint control, and applies one shared quality contract to both backends.

**Developer: 科研up主:进击的土博**<br>
GitHub: [@icebird1998](https://github.com/icebird1998)

### Versioned releases and rollback

- Latest stable release: [`v1.5.0`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.0), with the Windows/macOS draw.io, Microsoft PowerPoint, and WPS compatibility layer plus live Mac PowerPoint Office.js drawing;
- Archived first public release: [`v1.3.0`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.3.0), preserving the original Windows PowerPoint COM and draw.io implementation;
- Every public version has an independent immutable Git tag and GitHub Release. Publishing a new version does not overwrite or delete the source archives for an older version;
- `main` and the one-command installers track the newest release. To roll back, clone the repository, run `git checkout v1.3.0`, then register and install the plugin from that checkout.

### Core behavior

- The user chooses Microsoft PowerPoint, WPS Presentation, or draw.io; the plugin automatically selects the required skills.
- The Designer establishes structure, layout, visual grammar, and connector lanes.
- The Drawer inventories backend capabilities and creates native editable objects panel by panel.
- The Reviewer checks rendered fidelity, layout, connector clearance, text fit, structure, and deep editability.
- The Corrector translates findings into minimal object-level repairs.
- Local review gates run after each region, followed by repeated whole-figure review.
- Raster images are allowed only for the smallest region that cannot be reproduced reliably with native objects.

Windows Microsoft PowerPoint uses native objects through Office COM. On macOS, a connected Scientific Illustrator Office.js task pane updates the current PowerPoint slide object by object and acknowledges every `context.sync()`; the isolated standard-PPTX OOXML working copy remains the fallback. WPS Presentation uses the OOXML backend on Windows and macOS. draw.io uses native graph cells and editable composites through its graph API. The representations differ; the expected semantic result and acceptance gate do not.

### Requirements

1. Codex desktop or Codex CLI with plugin support;
2. Git;
3. Node.js 22+ when the bundled Codex runtime is not available;
4. For presentations: desktop Microsoft PowerPoint or WPS Presentation on Windows/macOS; the file-backed backend requires Python 3 plus `python-pptx`;
5. For live Mac PowerPoint: OpenSSL, a user-reviewed and manually trusted localhost certificate, and the sideloaded Office.js manifest;
6. For preview rendering in file-backed mode: local LibreOffice and Poppler are recommended;
7. For draw.io: [draw.io Desktop](https://www.drawio.com/).

Restart Codex and open a new task after installation.

### Windows/macOS × three-application matrix

| Application | Windows | macOS |
|---|---|---|
| draw.io Desktop | Supported through the visible desktop graph API; primary validation path | Supported through the same graph API and editable cells/edges; run launch and export smoke tests against the installed Electron build |
| Microsoft PowerPoint | Supported through live Office COM control of the current presentation | Supported through live Office.js `PowerPoint.run()` + `context.sync()` when the task pane is connected, with editable OOXML fallback |
| WPS Presentation | Supported through a standard editable PPTX/OOXML working copy opened in WPS | Supported through the same standard editable PPTX/OOXML working copy opened in WPS |

All six combinations are compatibility targets, but their interaction models differ. PowerPoint COM and connected Mac Office.js update the current canvas live. WPS is a file-backed editable workflow and is not described as COM/Office.js-style live control. Always perform the final renderer check in the target application because fonts, SVG, chart themes, and application versions can differ.

### Install

Ask Codex to install the plugin:

```text
Install the public Codex plugin from https://github.com/icebird1998/scientific-illustrator.
Clone the repository, register its root as a Codex marketplace, install
scientific-illustrator@scientific-illustrator-tools, and tell me when to restart Codex.
```

Windows one-command installer (review [`install.ps1`](install.ps1) first):

```powershell
$p="$env:TEMP\scientific-illustrator-install.ps1"; Invoke-WebRequest https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.ps1 -OutFile $p; powershell -ExecutionPolicy Bypass -File $p
```

macOS/Linux installer for draw.io, Mac Microsoft PowerPoint, and Mac WPS Presentation support:

```bash
curl -fsSL https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.sh | bash
```

Manual installation:

```bash
git clone https://github.com/icebird1998/scientific-illustrator.git
cd scientific-illustrator
codex plugin marketplace add "$(pwd)"
codex plugin add scientific-illustrator@scientific-illustrator-tools
```

On PowerShell, replace `"$(pwd)"` with `(Get-Location).Path`.

To enable real object-by-object drawing in Mac PowerPoint, run these commands from the repository after installation:

```bash
node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare
openssl x509 -in "$HOME/.codex/scientific-illustrator/officejs/localhost.crt" -text -noout
node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload
```

Review and trust the certificate manually in Keychain Access, then restart PowerPoint. In a new Codex task, call `powerpoint_officejs_status` once to start the local bridge; next open **Insert > My Add-ins > Scientific Illustrator Live** in the target deck and call status again. The setup script never changes certificate trust automatically. Before drawing, status must report `connected=true`, then select `officejs` with `powerpoint_set_backend`.

### Prompting

Select **Scientific Illustrator** in the Codex composer. In environments that support plugin links, you may start with:

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
```

You only need to state the target application and task. Skills are selected automatically.

Live Mac PowerPoint reference-recreation prompt:

```text
Use Scientific Illustrator in the current Mac PowerPoint deck. Before drawing, require
powerpoint_officejs_status.connected=true and lock this task to the officejs backend. Stop and tell
me if the task pane is not connected; do not call a file refresh "live". Recreate the reference
panel by panel with editable objects and per_object pacing, wait for context.sync after every object,
review each rendered region against the source, then run a whole-slide review and export the editable
PPTX plus a final preview.
```

PowerPoint or WPS general reference-recreation prompt:

```text
Use Scientific Illustrator in Microsoft PowerPoint or WPS Presentation to recreate the attached reference as a maximally
editable figure. Inspect status, capabilities, and presentation structure first. Prefer native
text, shapes, connectors, tables, and charts; use only minimal atomic raster regions when native
objects cannot reproduce the content. Draw panel by panel. After each panel, inspect structure and
export a slide image for visual review, correct all reproducible issues, then continue. Repeat the
whole-slide review until there are no blocking findings, save the PPTX, and export a final preview.
```

draw.io reference-recreation prompt:

```text
Use Scientific Illustrator in the visible draw.io Desktop canvas to recreate the attached
reference as a maximally editable figure. Inspect status, capabilities, and graph structure first.
Prefer native text, vertices, edges, editable table/chart composites, and groups; use only minimal
atomic raster regions when necessary. Draw region by region, inspect the graph and screenshot each
completed region, correct all reproducible issues, then continue. Repeat whole-figure review, save
the .drawio file, validate it, and export PNG and SVG deliverables.
```

Read-only PowerPoint prompt:

```text
Connect to the current PowerPoint presentation. Call status, capability, and inspection tools.
Read only the presentation structure and report it; do not modify anything.
```

The full Chinese guide above includes no-reference design prompts, read-only draw.io inspection, update instructions, migration advice, configuration, troubleshooting, and the exact backend tool flows.

### Updating

Run the installer again. It performs a fast-forward update and reinstalls the plugin. Restart Codex and create a new task afterward.

If the earlier `drawio-scientific-illustrator` plugin is still enabled, disable or uninstall it before using this successor so duplicate draw.io tools do not create ambiguity.

### Contributing

Issues and pull requests are welcome. Include the operating system, Codex version, PowerPoint/WPS/draw.io version, reproduction steps, and relevant MCP error text. Do not upload confidential figures or unpublished data.

## License

MIT © 2026 科研up主:进击的土博 ([icebird1998](https://github.com/icebird1998))
