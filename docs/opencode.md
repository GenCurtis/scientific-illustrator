# Using Scientific Illustrator with OpenCode

OpenCode natively loads Agent Skills from `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`. The six skills in this plugin follow that standard, so they work in OpenCode once placed on a discovery path. The MCP servers are standard local MCP servers, but OpenCode reads its own `opencode.json` `mcp` config instead of the Codex `.mcp.json` convention, so they must be registered explicitly.

## Install

1. Clone this repository anywhere on your machine.

   ```bash
   git clone https://github.com/icebird1998/scientific-illustrator.git ~/scientific-illustrator
   ```

2. Register the plugin's MCP servers in your OpenCode config. OpenCode reads `opencode.json` at the project root, `~/.config/opencode/opencode.json` or `~/.config/opencode/opencode.jsonc` (global). See the example in this repository's `opencode.json.example` for the full shape.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "drawio-live": {
      "type": "local",
      "command": ["node", "plugins/scientific-illustrator/scripts/live-server.mjs"],
      "cwd": "~/scientific-illustrator",
      "enabled": true
    },
    "drawio-file-utils": {
      "type": "local",
      "command": ["node", "plugins/scientific-illustrator/scripts/server.mjs"],
      "cwd": "~/scientific-illustrator",
      "enabled": true
    },
    "powerpoint-live": {
      "type": "local",
      "command": ["node", "plugins/scientific-illustrator/scripts/powerpoint-server.mjs"],
      "cwd": "~/scientific-illustrator",
      "enabled": true
    }
  }
}
```

On Windows, use the full path to the checkout instead of `~/scientific-illustrator` (the `~` shorthand is resolved by Unix shells only).

3. Restart OpenCode so the MCP servers start and their tools are registered.

4. Open the app you want to draw in (PowerPoint, WPS Presentation, or draw.io Desktop) and start a new OpenCode session from the project that contains your reference image.

## Using the skills

The six skills follow the Agent Skills standard, so OpenCode's native `skill` tool loads them automatically:

- `design-scientific-figure` - new figure from a brief
- `recreate-scientific-figure` - rebuild a reference image panel by panel
- `recreate-scientific-figure-in-drawio` - the draw.io Drawer adapter
- `edit-powerpoint-live` - the PowerPoint/WPS Drawer adapter
- `audit-scientific-figure` - the Reviewer
- `correct-scientific-figure` - the Corrector

To invoke a skill, load it with the `skill` tool: `skill({ name: "edit-powerpoint-live" })`. The `$skill-name` references inside the skill instructions are the Codex sub-agent convention; in OpenCode load the referenced skill with the `skill` tool and follow its instructions in the current agent session instead.

## Optional hardening

Set these environment variables to tighten the local file access surface:

- `SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT` - restrict every file argument to a directory (e.g. your project folder) instead of the whole disk. The check also resolves symlinks, so a link placed inside the root cannot redirect a read/write outside it.
- `SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES` - lower the per-image size cap from the default 64 MB.

The Office.js bridge protects its local HTTPS task-pane assets with a per-machine page token written to `page_token_path` in the state directory. `officejs-setup.mjs prepare` writes a tokenized `manifest.xml` into the state dir; sideload that generated manifest (not the repo template) so the token reaches the task pane. Any asset request without the token is rejected with 401.

See `references/onboarding.md` and `references/profiles.md` for brand onboarding and multi-client profiles, which work identically in OpenCode.