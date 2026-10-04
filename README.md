# Scientific Illustrator

把你的参考图交给 AI Agent（Codex、OpenCode、Google Antigravity 等），它会在 **Microsoft PowerPoint、WPS 演示或 draw.io** 中尽量用可编辑对象重新绘制，并自动检查和修正。

**作者：GenCurtis**

GitHub：[@GenCurtis](https://github.com/GenCurtis)

最新版本与完整变更历史：[CHANGELOG.md](CHANGELOG.md)

本项目是 [drawio-scientific-illustrator](https://github.com/icebird1998/drawio-scientific-illustrator) 的升级整合版，后续功能只在本项目更新。插件遵循开放的 Agent Skills 标准与 MCP 协议，可在 Codex、OpenCode、Google Antigravity 及同类 Agent 环境中使用。

## 安装

按你使用的 Agent 环境选择安装方式。

### Codex

把下面这段话完整发送给 Codex：

~~~text
请安装 https://github.com/GenCurtis/scientific-illustrator。
把仓库根目录注册为 Codex Marketplace，然后安装
scientific-illustrator@scientific-illustrator-tools。完成后提醒我重启 Codex。
~~~

也可以直接运行安装脚本。

**Windows**

~~~powershell
$p="$env:TEMP\scientific-illustrator-install.ps1"; Invoke-WebRequest https://raw.githubusercontent.com/GenCurtis/scientific-illustrator/main/install.ps1 -OutFile $p; powershell -ExecutionPolicy Bypass -File $p
~~~

**macOS / Linux**

~~~bash
curl -fsSL https://raw.githubusercontent.com/GenCurtis/scientific-illustrator/main/install.sh | bash
~~~

**手动安装**

~~~bash
git clone https://github.com/GenCurtis/scientific-illustrator.git
cd scientific-illustrator
codex plugin marketplace add "$(pwd)"
codex plugin add scientific-illustrator@scientific-illustrator-tools
~~~

安装或更新后，重启 Codex 并新建任务。

### OpenCode

参见 [OpenCode 使用指南](docs/opencode.md)：克隆仓库，按 `opencode.json.example` 把三个 MCP server 注册进 `opencode.json`，并把技能放到 OpenCode 的发现路径。

### Google Antigravity

参见 [Antigravity 使用指南](docs/antigravity.md)：克隆仓库，按 `mcp_config.json.example` 注册 MCP server，并把技能目录加入工作区。

### 其他 Agent 环境

任何支持 Agent Skills 标准并提供本地 MCP server 的环境都可以接入：技能位于 `plugins/scientific-illustrator/skills/`，MCP 定义见 `plugins/scientific-illustrator/.mcp.json`，可参考上面两个示例配置。

## 第一次使用：只需 3 步

1. 按上面的方式安装，然后重启你的 Agent 并新建任务；
2. 打开准备使用的 PowerPoint、WPS 演示或 draw.io Desktop；
3. 上传参考图，从下方选择与你的软件对应的提示词，**整段复制发送**即可。

## 支持哪些平台和软件

| 软件 | Windows | macOS | 使用方式与结果 |
|---|---|---|---|
| Microsoft PowerPoint | 支持 | 支持 | 绘制为可编辑 PPTX；Windows 可实时绘制，Mac 可选择普通模式或实时加载项模式 |
| WPS 演示 | 支持 | 支持 | 绘制为可编辑 PPTX 工作副本；默认按检查点后台刷新，不会持续抢占窗口 |
| draw.io Desktop | 支持 | 支持 | 直接控制 draw.io 画布，保存可编辑 .drawio 并导出预览图 |

默认情况下，PowerPoint 和 WPS 会在后台绘制，你可以继续使用电脑。新启动的 PowerPoint 窗口会在后台最小化打开，图表数据用的 Excel 窗口也会隐藏，不再弹到前台。绘制默认使用零人工等待的有界批量：Windows COM 与 OOXML 都是「一批一进程」，OOXML 每批只读写一次文件；简单重复对象批量复用，复杂模块才定点检查修正。每次 inspect/audit/渲染都会返回 `discipline` 计数器（内容修订号、重复审查计数、未审查债务），重复检查未变更内容会被明确标记，改动后未复审也会显示为 review debt；未渲染的改动累计超过阈值时，变更结果会附带 `review_reminder` 检查点提醒。WPS 使用可编辑 PPTX 工作副本，不会假装已经连接任意未保存的当前窗口；macOS 会验证文件是否真的由 WPS 打开，Windows 无法验证时会明确显示“未知”。draw.io 不认识的图形名会直接报错，不会悄悄退化成矩形。显微照片、复杂纹理等确实无法用形状还原的内容，只会把最小必要区域作为图片插入，其余文字、箭头和边框仍保持可编辑。数学公式请用 `powerpoint_add_equation` 以 LaTeX 插入为原生可编辑的 OMML 矢量公式，不要用纯文本或图片代替（Windows 实时绘制需要安装 Microsoft Word 完成公式转换）。

每次更新都会在 Ubuntu、macOS 和 Windows 上运行代码、MCP、Python、PowerShell、路径发现与 OOXML 回归测试。本版另在真实 Mac 上验证了 PowerPoint 精确打开/刷新/关闭、WPS 指定文件打开和 draw.io 实时画布；GitHub 公共测试机没有商业版 PowerPoint/WPS，因此 Windows 的应用内联调必须由安装后的状态工具确认，不能把模拟测试当成实机连接成功。

## 直接复制使用

先在对应软件中打开工作环境并上传参考图。

> **Codex 用户**：在提示词最前面加上一行 `[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)`，或直接在输入框的插件菜单中选择 **Scientific Illustrator**，确保插件被调用。其他 Agent 环境直接发送下面的提示词正文即可。

### 使用 Microsoft PowerPoint

先打开 PowerPoint 并上传参考图，然后复制：

~~~text
使用 Scientific Illustrator，在当前 Microsoft PowerPoint 中复刻我上传的参考图。
先连接 PowerPoint，检查状态、可用能力、backend 和当前幻灯片；如果没有演示文稿就新建。
只有 COM 或 officejs-context-sync 才能声称连接当前窗口；如果使用 OOXML，明确说明正在编辑工作副本。
默认在后台绘制，不要反复抢占窗口；使用零人工等待的批量绘制。优先使用可编辑的文字、形状、连接线、表格和图表；公式用 LaTeX 通过原生公式插入，不要写成纯文本。
只有无法可靠绘制的最小区域，例如显微照片或复杂纹理，才裁剪为图片插入。
按有界批次连续绘制，在每个检查点检查结构和预览图，只修正有问题的对象，然后继续。
完成后做全图对比检查，保存 PPTX 并导出最终预览图。
~~~

### 使用 WPS 演示

先打开 WPS 演示并上传参考图，然后复制：

~~~text
使用 Scientific Illustrator，在 WPS 演示中复刻我上传的参考图。
请将 host_application 明确设为 wps，不要连接 Microsoft PowerPoint；先检查状态和可用能力，
确认 target_application=wps 且 microsoft_powerpoint_used=false。如果没有指定要编辑的 PPTX 路径，
就新建一个 WPS 可编辑工作副本，不要声称已连接任意未保存的当前窗口。默认在后台按检查点绘制。
优先使用可编辑的文字、形状、连接线、表格和图表。只有无法可靠绘制的最小区域，
例如显微照片或复杂纹理，才裁剪为图片插入。按有界批次绘制；每个检查点完成后调用刷新，
分别检查 open_dispatched、document_open_verified 和 refresh_verified，有问题先修正。
完成后做全图对比检查，保存 PPTX 并导出最终预览图。
~~~

### 使用 draw.io

先安装并打开 [draw.io Desktop](https://www.drawio.com/)，上传参考图，然后复制：

~~~text
使用 Scientific Illustrator，连接实时 draw.io 画布并复刻我上传的参考图。
优先使用可编辑的文字、图形、连接线、表格、图表和分组对象。
只有无法可靠绘制的最小区域，例如显微照片或复杂纹理，才裁剪为图片插入。
按区域逐步绘制，每完成一个区域就检查结构和画布截图，有问题先修正再继续。
完成后做全图对比检查，保存可编辑 .drawio，并导出宽度为 2000 px 的 PNG 预览图。
~~~

如果想让 PowerPoint 或 WPS 一直显示在最前面观看绘制过程，在提示词最后加一句：

~~~text
绘制期间请将 focus_policy 设置为 foreground，让演示文稿保持在前台。
~~~

<details>
<summary><strong>Mac PowerPoint：启用逐对象实时绘制（可选）</strong></summary>

普通安装已经可以生成可编辑 PPTX。只有想在 Mac PowerPoint 中观看逐对象实时绘制时，才需要完成本节。

在仓库目录运行：

~~~bash
node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare
openssl x509 -in "$HOME/.codex/scientific-illustrator/officejs/localhost.crt" -text -noout
node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload
~~~

然后：

1. 在 macOS“钥匙串访问”中检查并手动信任 localhost 证书；
2. 重启 PowerPoint；
3. 在“插入 → 我的加载项”中打开 **Scientific Illustrator Live**；
4. 保持任务窗格开启，确认 powerpoint_officejs_status 显示 connected=true。

插件不会自动修改系统证书信任。

</details>

## 版本更新

最新版本与每个版本的详细变更见 [CHANGELOG.md](CHANGELOG.md)；历史版本（用于回退）见 [tags 页面](https://github.com/GenCurtis/scientific-illustrator/tags)。

需要回退时：

~~~bash
git fetch --tags
git checkout <tag>
~~~

回退后，按上面的安装方式重新安装（Codex 重新注册该目录的 Marketplace；其他环境重新指向该目录的 MCP 配置）。

## 许可证与隐私

[MIT License](LICENSE) · [隐私说明](PRIVACY.md)
