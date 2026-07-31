# Scientific Illustrator

让 Codex 在 **PowerPoint、WPS 演示和 draw.io** 中绘制、复刻、检查并修正科研插图。优先使用可编辑文字、形状、连接线、表格和图表；只有无法可靠重建的最小区域才使用紧裁剪图片。

**作者：科研 up 主「进击的土博」**

GitHub：[@icebird1998](https://github.com/icebird1998)

当前版本：[`v1.5.1`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.1)

本项目是 [`drawio-scientific-illustrator`](https://github.com/icebird1998/drawio-scientific-illustrator) 的集成升级版，后续功能在本项目更新。

## 平台与软件

| 平台与软件 | 后端 | 开始时调用 | 绘制与窗口行为 |
|---|---|---|---|
| Windows PowerPoint | Office COM | `powerpoint_status` → `powerpoint_get_capabilities` → `powerpoint_inspect` | 原生对象实时绘制；默认不抢占当前窗口 |
| Mac PowerPoint，任务窗格已连接 | Office.js `context.sync()` | 再调用 `powerpoint_officejs_status` 和 `powerpoint_set_backend(officejs)` | 真正逐对象更新；PowerPoint 可放在后台 |
| Mac PowerPoint，任务窗格未连接 | OOXML 工作副本 | PowerPoint 通用三项检查 | 文件刷新模式；使用后台打开，不反复抢焦点 |
| Windows / Mac WPS 演示 | OOXML 工作副本 | PowerPoint 通用三项检查，并指定 `host_application=wps` | 文件刷新模式；默认不抢占当前窗口 |
| Windows / Mac draw.io | graph API / CDP | `drawio_live_status` → `drawio_live_get_capabilities` → 结构检查 | 启动时可能显示一次；后续绘制不反复抢焦点 |

所有后端都遵循同一原则：能编辑的内容必须使用原生对象；显微照片、复杂纹理等只能作为最小原子图片插入；每个区域和全图完成后都要做结构检查与导出图检查。

## 安装

需要 Codex、Git，以及要使用的 PowerPoint、WPS 演示或 [draw.io Desktop](https://www.drawio.com/)。

### 让 Codex 安装

把下面内容发送给 Codex：

```text
请安装 https://github.com/icebird1998/scientific-illustrator。
把仓库根目录注册为 Codex Marketplace，然后安装
scientific-illustrator@scientific-illustrator-tools。完成后提醒我重启 Codex。
```

### Windows 一键安装

```powershell
$p="$env:TEMP\scientific-illustrator-install.ps1"; Invoke-WebRequest https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.ps1 -OutFile $p; powershell -ExecutionPolicy Bypass -File $p
```

### macOS / Linux 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/icebird1998/scientific-illustrator/main/install.sh | bash
```

### 手动安装

```bash
git clone https://github.com/icebird1998/scientific-illustrator.git
cd scientific-illustrator
codex plugin marketplace add "$(pwd)"
codex plugin add scientific-illustrator@scientific-illustrator-tools
```

安装或更新后，重启 Codex 并新建任务。

### Mac PowerPoint 实时绘制（可选）

不执行本节也能使用 OOXML 可编辑后端。需要 Office.js 逐对象实时绘制时，在仓库目录运行：

```bash
node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare
openssl x509 -in "$HOME/.codex/scientific-illustrator/officejs/localhost.crt" -text -noout
node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload
```

然后：

1. 在 macOS“钥匙串访问”中检查并手动信任 localhost 证书；
2. 重启 PowerPoint；
3. 在 PowerPoint 的“插入 → 我的加载项”中打开 **Scientific Illustrator Live**；
4. 保持任务窗格开启，确认 `powerpoint_officejs_status.connected=true`。

插件不会自动修改系统证书信任。

## 使用

下面的提示词已包含插件调用命令，整段复制到 Codex 即可使用。

### PowerPoint / WPS 复刻参考图

```text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
使用 Scientific Illustrator，在 PowerPoint 中复刻我上传的参考图。开始前检查状态、
能力和演示文稿结构，并保持 focus_policy=preserve，不要反复抢占窗口。优先使用原生
可编辑对象；只有无法可靠重建的最小区域才使用紧裁剪图片。按区域绘制，每个区域完成
后检查结构和导出图并修正。最后做全图检查，保存 PPTX 和预览图。
```

使用 WPS 时，把“PowerPoint”改成“Windows WPS”或“Mac WPS”。

### draw.io 复刻参考图

```text
[@scientific-illustrator](plugin://scientific-illustrator@scientific-illustrator-tools)
使用 Scientific Illustrator，在实时 draw.io 画布中复刻我上传的参考图。优先使用
可编辑 cell、文字、连接线、表格和图表；复杂素材只保留最小原子图片。按区域绘制，
逐区检查并修正，最后保存 .drawio 并导出 PNG。
```

### 窗口焦点

`v1.5.1` 默认使用：

```text
powerpoint_set_focus_policy({"focus_policy":"preserve"})
```

绘制时可以继续使用其他软件。需要让 PowerPoint/WPS 一直置前观看过程时，改为：

```text
powerpoint_set_focus_policy({"focus_policy":"foreground"})
```

`powerpoint_activate_slide` 只用于一次明确的前台切换。

## 版本更新

| 版本 | 主要变化 |
|---|---|
| [`v1.5.1`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.1) | 修复 PowerPoint/WPS 逐对象抢焦点；新增 `preserve` / `foreground` 策略；默认后台绘制 |
| [`v1.5.0`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.5.0) | 加入 Windows/macOS 下 PowerPoint、WPS、draw.io 统一适配和 Mac PowerPoint Office.js 后端 |
| [`v1.3.0`](https://github.com/icebird1998/scientific-illustrator/releases/tag/v1.3.0) | 首个公开版本，支持 Windows PowerPoint COM 和 draw.io |

旧版本不会被覆盖。需要回退时：

```bash
git fetch --tags
git checkout v1.5.0
```

然后从该目录重新注册 Marketplace 并安装插件。更新到最新版可重新运行安装脚本。

## 许可证与隐私

[MIT License](LICENSE) · [隐私说明](PRIVACY.md)

感谢使用 **Scientific Illustrator**。制作者：**进击的土博**。
