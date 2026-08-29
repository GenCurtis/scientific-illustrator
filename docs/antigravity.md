# Using Scientific Illustrator with Antigravity

Google Antigravity natively discovers Agent Skills placed in `.agents/skills/` (or configured via `skills.json`). The six skills in this repository follow the open Agent Skills standard and are immediately discovered by Antigravity.

To use the live drawing capabilities in PowerPoint or draw.io, register the repository's MCP servers in Antigravity.

## Installation & Setup

### 1. Clone this repository

```bash
git clone https://github.com/GenCurtis/scientific-illustrator.git C:/path/to/scientific-illustrator
```

### 2. Configure MCP Servers in Antigravity

Antigravity reads MCP configuration from `~/.gemini/config/mcp_config.json` (global) or `.agents/` project settings.

Add the three local servers from `mcp_config.json.example` into your `mcp_config.json`:

```json
{
  "mcpServers": {
    "drawio-live": {
      "command": "node",
      "args": ["plugins/scientific-illustrator/scripts/live-server.mjs"],
      "cwd": "C:/path/to/scientific-illustrator"
    },
    "drawio-file-utils": {
      "command": "node",
      "args": ["plugins/scientific-illustrator/scripts/server.mjs"],
      "cwd": "C:/path/to/scientific-illustrator"
    },
    "powerpoint-live": {
      "command": "node",
      "args": ["plugins/scientific-illustrator/scripts/powerpoint-server.mjs"],
      "cwd": "C:/path/to/scientific-illustrator"
    }
  }
}
```

> **Note**: On Windows, replace `C:/path/to/scientific-illustrator` with the absolute path to your local checkout.

### 3. Expose Skills to your Workspace

Place or link the skills to your project's `.agents/skills/` directory, or list this repo's skills path in your project's `.agents/skills.json`:

```json
{
  "entries": [
    {
      "path": "C:/path/to/scientific-illustrator/plugins/scientific-illustrator/skills"
    }
  ]
}
```

### 4. Restart your Antigravity session

Once restarted, the `powerpoint_*` and `drawio_*` MCP tools will be active in your agent environment.

## Usage Prompts

Open your target software (Microsoft PowerPoint, WPS Presentation, or draw.io Desktop) and prompt Antigravity:

- **New Architecture / Figure 1**:
  > "Use design-scientific-figure and edit-powerpoint-live to design a method overview diagram for my paper in my active PowerPoint window."
- **Recreate Reference Image**:
  > "Use recreate-scientific-figure to reconstruct the attached diagram into editable vector shapes in PowerPoint."

## Key Behaviors & Best Practices

1. **Live COM In-Place Editing**: On Windows, the agent connects directly to your active PowerPoint window (`GetActiveObject("PowerPoint.Application")`), modifying shapes live on your screen without creating cluttered intermediate `.pptx` files.
2. **Academic Styling & Color Palettes**: Supports top-tier conference color palettes (*Ocean Dusk*, *Okabe-Ito*, *Modern Minimal*) and OMML vector math equations.
3. **Atomic Images**: Complex textures or microscopy regions are tightly cropped as atomic rasters, while all labels, arrows, tables, and bounding boxes remain 100% native editable vectors.
