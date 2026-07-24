# Scientific Illustrator

[中文说明](#中文说明) · [English guide](#english-guide) · [MIT License](LICENSE)

一个让 Codex 在 **Microsoft PowerPoint 或 draw.io 桌面端**逐步绘制、复刻、审查并修正科研插图的插件。目标不是把参考图整张贴进画布，而是尽可能还原为可编辑的文字、形状、连接线、表格、图表和原子图像素材。

> **项目关系：本项目是上一研究项目 [`icebird1998/drawio-scientific-illustrator`](https://github.com/icebird1998/drawio-scientific-illustrator) 的集成升级优化版本。**前代项目聚焦 draw.io；本项目在保留并升级 draw.io 能力的同时，加入 PowerPoint 原生对象控制，并让两种软件遵循同一套设计、绘图、审查、纠正和可编辑性验收标准。

**开发人：科研up主:进击的土博**<br>
GitHub: [@icebird1998](https://github.com/icebird1998)

> 当前版本：`1.3.0`。PowerPoint 实时控制面向 Windows 桌面版 Microsoft PowerPoint；draw.io 支持 Windows，并包含 macOS/Linux 的可执行文件发现逻辑，实际表现会受 draw.io/Electron 打包方式影响。

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
| 目标软件 | draw.io | PowerPoint + draw.io |
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

#### PowerPoint

- Windows；
- Microsoft PowerPoint 桌面版；
- PowerPoint 不应处于模态对话框、受保护视图或被其他操作阻塞的状态；
- 插件通过本机 PowerShell 和 Office COM 对象模型控制 PowerPoint，不使用系统鼠标键盘模拟。

#### draw.io

- [draw.io Desktop](https://www.drawio.com/)；
- Windows 为主要测试平台；macOS/Linux 为尽力支持；
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

该方式可安装 draw.io 能力；PowerPoint 实时控制仍要求 Windows：

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

### PowerPoint 提示词

#### 有参考图：最大程度可编辑复刻

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
使用插件在 PowerPoint 中复刻我上传的参考图。先连接当前 PowerPoint，调用状态、
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

PowerPoint 通常执行：

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

PowerPoint 不需要配置网络端口；它使用本机 Office COM。若连接失败，先关闭 PowerPoint 的弹窗或受保护视图，再重试状态检查。

### 常见问题

- **插件安装后不可见**：重启 Codex，并新建任务；旧任务不会自动加载新工具。
- **`node` 不可用**：安装 Node.js 22+，或确认 Codex 捆绑运行环境可供插件使用。
- **PowerPoint 连接失败**：确认使用 Windows 桌面版 PowerPoint，并关闭模态对话框、受保护视图或卡住的演示文稿。
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
│  │  └─ powerpoint-bridge.ps1    # PowerPoint COM 桥接
│  └─ skills/                     # 设计、双端绘图、审查与纠正流程
├─ scripts/                       # 仓库校验与 MCP 冒烟测试
├─ install.ps1
└─ install.sh
```

### 安全与隐私

- draw.io 调试端点只绑定 `127.0.0.1`；
- PowerPoint 使用本机 COM，不开放公网服务；
- 不使用系统级鼠标键盘自动化；
- 插件不包含遥测或托管后端；
- 参考图和文档是否进入模型上下文取决于 Codex 与模型提供商设置，详见 [PRIVACY.md](PRIVACY.md)；
- 执行远程安装脚本前，请先检查脚本内容和目标提交。

### 已知限制

- PowerPoint 实时控制依赖 Windows 与桌面版 Microsoft PowerPoint；
- 显微照片、复杂纹理、热图等连续栅格内容不能被无损转换成原生矢量对象，插件会尽量把它们限制在最小语义区域；
- 参考图分辨率、字体可用性和目标软件渲染差异会影响像素级一致性；
- “审查者没有问题”指在当前证据、阈值和可复现检查范围内通过，不代表数学意义上的绝对一致。

---

## English guide

### Overview

Scientific Illustrator is a Codex plugin for building, recreating, reviewing, and correcting scientific figures live in either Microsoft PowerPoint or draw.io Desktop. It prioritizes native editable objects over flattened screenshots.

This project is the **integrated, upgraded, and optimized successor** to [`icebird1998/drawio-scientific-illustrator`](https://github.com/icebird1998/drawio-scientific-illustrator). It preserves and expands the draw.io implementation, adds native PowerPoint control, and applies one shared quality contract to both backends.

**Developer: 科研up主:进击的土博**<br>
GitHub: [@icebird1998](https://github.com/icebird1998)

### Core behavior

- The user chooses PowerPoint or draw.io; the plugin automatically selects the required skills.
- The Designer establishes structure, layout, visual grammar, and connector lanes.
- The Drawer inventories backend capabilities and creates native editable objects panel by panel.
- The Reviewer checks rendered fidelity, layout, connector clearance, text fit, structure, and deep editability.
- The Corrector translates findings into minimal object-level repairs.
- Local review gates run after each region, followed by repeated whole-figure review.
- Raster images are allowed only for the smallest region that cannot be reproduced reliably with native objects.

PowerPoint uses native text boxes, AutoShapes, connectors, tables, charts, groups, and pictures through the Windows Office COM model. draw.io uses native graph cells, edges, editable table/chart composites, groups, and image cells through draw.io's graph API. The representations differ; the expected semantic result and acceptance gate do not.

### Requirements

1. Codex desktop or Codex CLI with plugin support;
2. Git;
3. Node.js 22+ when the bundled Codex runtime is not available;
4. For PowerPoint: Windows and desktop Microsoft PowerPoint;
5. For draw.io: [draw.io Desktop](https://www.drawio.com/).

Restart Codex and open a new task after installation.

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

macOS/Linux installer for draw.io support (PowerPoint live control still requires Windows):

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

### Prompting

Select **Scientific Illustrator** in the Codex composer. In environments that support plugin links, you may start with:

```text
[@scientific-illustrator](plugin://scientific-illustrator@personal)
```

You only need to state the target application and task. Skills are selected automatically.

PowerPoint reference-recreation prompt:

```text
Use Scientific Illustrator in PowerPoint to recreate the attached reference as a maximally
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

Issues and pull requests are welcome. Include the operating system, Codex version, PowerPoint or draw.io version, reproduction steps, and relevant MCP error text. Do not upload confidential figures or unpublished data.

## License

MIT © 2026 科研up主:进击的土博 ([icebird1998](https://github.com/icebird1998))
