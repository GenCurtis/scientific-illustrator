#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVER_NAME = "powerpoint-live";
const SERVER_VERSION = "1.3.0";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = path.join(SCRIPT_DIR, "powerpoint-bridge.ps1");
const MAX_BUFFER = 20 * 1024 * 1024;

const positionProperties = {
  left: { type: "number", minimum: -100000, maximum: 100000, description: "Left position in points (72 points = 1 inch)." },
  top: { type: "number", minimum: -100000, maximum: 100000, description: "Top position in points." },
  width: { type: "number", exclusiveMinimum: 0, maximum: 100000, description: "Width in points." },
  height: { type: "number", exclusiveMinimum: 0, maximum: 100000, description: "Height in points." },
};

const textStyleProperties = {
  font_name: { type: "string" },
  font_size: { type: "number", minimum: 1, maximum: 400 },
  font_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
  bold: { type: "boolean" },
  italic: { type: "boolean" },
  alignment: { type: "string", enum: ["left", "center", "right", "justify"] },
  vertical_alignment: { type: "string", enum: ["top", "middle", "bottom"] },
};

const textFrameProperties = {
  margin_left: { type: "number", minimum: 0, maximum: 1000 },
  margin_right: { type: "number", minimum: 0, maximum: 1000 },
  margin_top: { type: "number", minimum: 0, maximum: 1000 },
  margin_bottom: { type: "number", minimum: 0, maximum: 1000 },
  word_wrap: { type: "boolean", default: true },
  text_autofit: { type: "string", enum: ["none", "shrink_text", "grow_shape"], default: "none" },
};

const lineStyleProperties = {
  line_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
  line_width: { type: "number", minimum: 0, maximum: 50 },
  line_transparency: { type: "number", minimum: 0, maximum: 100 },
  line_dash: {
    type: "string",
    enum: ["solid", "square_dot", "round_dot", "dash", "dash_dot", "long_dash", "long_dash_dot", "long_dash_dot_dot"],
  },
  start_arrow: { type: "string", enum: ["none", "open", "triangle", "stealth", "diamond", "oval"], default: "none" },
  end_arrow: { type: "string", enum: ["none", "open", "triangle", "stealth", "diamond", "oval"], default: "none" },
};

const shapeTargetProperties = {
  slide_index: { type: "integer", minimum: 1 },
  shape_name: { type: "string", description: "PowerPoint shape name. Prefer stable semantic names." },
  shape_id: { type: "integer", minimum: 1, description: "Numeric PowerPoint shape id." },
};

const tools = [
  {
    name: "powerpoint_status",
    description: "Check whether desktop PowerPoint is installed and whether a visible presentation is currently available for native COM control. This is read-only and never launches PowerPoint.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "powerpoint_get_capabilities",
    description: "Read the installed PowerPoint/Office type metadata and report which native drawing object families, AutoShapes, chart types, connectors, arrows, grouping, and layering operations are available. Also reports which capabilities this MCP exposes. This is read-only, does not launch PowerPoint, and never changes a deck.",
    inputSchema: {
      type: "object",
      properties: {
        include_auto_shapes: { type: "boolean", default: true, description: "Return the complete installed MsoAutoShapeType catalog with reusable names and numeric ids." },
        include_chart_types: { type: "boolean", default: true, description: "Return the installed native chart type catalog." },
        include_shape_types: { type: "boolean", default: true, description: "Return native PowerPoint shape-kind metadata used during inspection." },
        include_api_methods: { type: "boolean", default: false, description: "Return the raw installed Shapes/Shape COM method names for advanced planning." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_launch",
    description: "Connect to the running Windows PowerPoint application or launch it, optionally opening a local .pptx file. PowerPoint remains visible so the user can watch native slide edits.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Optional absolute path to an existing .pptx/.pptm/.ppsx file." },
        create_if_missing: { type: "boolean", default: true, description: "Create a blank presentation only when no file and no active deck are available." },
        read_only: { type: "boolean", default: false },
        visible: { type: "boolean", default: true },
        maximize: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_new_presentation",
    description: "Create and activate a separate blank presentation in visible PowerPoint. Use this to avoid modifying an already-open deck when starting new work.",
    inputSchema: {
      type: "object",
      properties: {
        maximize: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_inspect",
    description: "Inspect the active presentation, slide dimensions, and a compact inventory of slides and native shapes without changing the deck.",
    inputSchema: {
      type: "object",
      properties: {
        max_slides: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        max_shapes_per_slide: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
        include_text: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_audit_figure",
    description: "Run a deterministic geometry, connector, text-fit, repeated-layout, and raster editability audit on one slide. Returns named hard failures and correction-oriented findings; it does not modify the presentation.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        alignment_tolerance: { type: "number", minimum: 0.05, maximum: 50, default: 0.75 },
        endpoint_clearance: { type: "number", minimum: 0, maximum: 100, default: 1.5 },
        text_overflow_tolerance: { type: "number", minimum: 0, maximum: 50, default: 1.5 },
        large_raster_area_ratio: { type: "number", minimum: 0.001, maximum: 1, default: 0.08 },
        max_findings: { type: "integer", minimum: 1, maximum: 2000, default: 300 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_activate_slide",
    description: "Make a slide active in the visible PowerPoint window so subsequent live work is easy to follow.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      properties: { slide_index: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_slide",
    description: "Insert a native PowerPoint slide and display it. Use the blank layout for fully programmatic scientific figures.",
    inputSchema: {
      type: "object",
      properties: {
        position: { type: "integer", minimum: 1, description: "1-based insertion position; defaults to the end." },
        layout: { type: "string", enum: ["blank", "title", "text"], default: "blank" },
        name: { type: "string", description: "Optional semantic slide name." },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_textbox",
    description: "Add an editable native text box to a slide. Coordinates are PowerPoint points (72 points = 1 inch).",
    inputSchema: {
      type: "object",
      required: ["slide_index", "text", "left", "top", "width", "height"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        text: { type: "string" },
        ...positionProperties,
        ...textStyleProperties,
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        line_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        line_width: { type: "number", minimum: 0, maximum: 50 },
        ...textFrameProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_shape",
    description: "Add any editable native PowerPoint AutoShape exposed by powerpoint_get_capabilities, using its plugin_name, Office enum name, or numeric shape_type_id.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "left", "top", "width", "height"],
      anyOf: [{ required: ["shape"] }, { required: ["shape_type_id"] }],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        shape: { type: "string", description: "Friendly plugin_name such as rectangle, flowchart_process, or left_right_arrow, or an Office enum name such as msoShapeRectangle." },
        shape_type_id: { type: "integer", minimum: 1, maximum: 10000, description: "Numeric MsoAutoShapeType id returned by powerpoint_get_capabilities." },
        text: { type: "string" },
        ...positionProperties,
        rotation: { type: "number", minimum: -360, maximum: 360 },
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        line_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        line_width: { type: "number", minimum: 0, maximum: 50 },
        ...textStyleProperties,
        ...textFrameProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_image",
    description: "Insert a tightly scoped local raster or SVG asset as a PowerPoint picture shape. A specific audit reason is mandatory; never use this for a whole panel containing text, boxes, arrows, tables, charts, labels, or other reconstructable native objects.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "image_path", "left", "top", "width", "height", "raster_reason", "source_is_tightly_cropped", "atomic_raster_unit", "contains_reconstructable_content", "decomposition_note"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        image_path: { type: "string", description: "Absolute path to a local image." },
        name: { type: "string" },
        ...positionProperties,
        lock_aspect_ratio: { type: "boolean", default: false },
        alt_text: { type: "string" },
        raster_reason: { type: "string", minLength: 8, description: "Why this exact visual region cannot be faithfully recreated with native editable PowerPoint objects, for example microscopy texture or a dense heatmap." },
        source_is_tightly_cropped: { type: "boolean", description: "True only when the source file already contains no reconstructable surrounding panel content. If false, at least one crop field is required." },
        atomic_raster_unit: { type: "boolean", const: true, description: "Must be true only when the picture contains exactly one irreducible raster field rather than a grid, montage, panel, comparison, or stack." },
        contains_reconstructable_content: { type: "boolean", const: false, description: "Must be false. Text, borders, arrows, legends, tables, axes, and regular plots must be rebuilt as native objects outside this picture." },
        decomposition_note: { type: "string", minLength: 8, description: "What was separated from the source crop and rebuilt natively, or why no further semantic split is possible." },
        crop_left_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_top_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_right_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_bottom_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_left_points: { type: "number", minimum: 0, maximum: 100000 },
        crop_top_points: { type: "number", minimum: 0, maximum: 100000 },
        crop_right_points: { type: "number", minimum: 0, maximum: 100000 },
        crop_bottom_points: { type: "number", minimum: 0, maximum: 100000 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_line",
    description: "Add an editable native PowerPoint line or arrow between explicit slide coordinates. Use this for free arrows, separators, axes, ticks, and annotations that should not be attached to two shapes.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "begin_x", "begin_y", "end_x", "end_y"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        begin_x: { type: "number", minimum: -100000, maximum: 100000 },
        begin_y: { type: "number", minimum: -100000, maximum: 100000 },
        end_x: { type: "number", minimum: -100000, maximum: 100000 },
        end_y: { type: "number", minimum: -100000, maximum: 100000 },
        start_clearance: { type: "number", minimum: 0, maximum: 10000, default: 0, description: "Trim this many points from the beginning of the line." },
        end_clearance: { type: "number", minimum: 0, maximum: 10000, default: 0, description: "Trim this many points from the end so the arrowhead does not intrude into a target object." },
        ...lineStyleProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_connector",
    description: "Connect two named native shapes on a slide with a PowerPoint connector that stays attached when shapes move.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "source_name", "target_name"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        source_name: { type: "string" },
        target_name: { type: "string" },
        source_site: { type: "integer", minimum: 1, default: 1 },
        target_site: { type: "integer", minimum: 1, default: 1 },
        connector_type: { type: "string", enum: ["straight", "elbow", "curve"], default: "elbow" },
        ...lineStyleProperties,
        end_arrow: { type: "string", enum: ["none", "open", "triangle", "stealth", "diamond", "oval"], default: "triangle" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_table",
    description: "Add a native editable PowerPoint table. Text, fills, borders, header styling, banding, and per-cell overrides remain editable and must be preferred over rasterized tables.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "rows", "columns", "left", "top", "width", "height"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        rows: { type: "integer", minimum: 1, maximum: 200 },
        columns: { type: "integer", minimum: 1, maximum: 100 },
        data: {
          type: "array",
          maxItems: 200,
          items: { type: "array", maxItems: 100, items: { type: ["string", "number", "boolean", "null"] } },
        },
        ...positionProperties,
        ...textStyleProperties,
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        header_rows: { type: "integer", minimum: 0, maximum: 20, default: 1 },
        header_fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        header_font_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        header_bold: { type: "boolean", default: true },
        banded_rows: { type: "boolean", default: false },
        band_fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_width: { type: "number", minimum: 0, maximum: 20 },
        cell_margin: { type: "number", minimum: 0, maximum: 100 },
        cell_styles: {
          type: "array",
          maxItems: 1000,
          items: {
            type: "object",
            required: ["row", "column"],
            properties: {
              row: { type: "integer", minimum: 1 },
              column: { type: "integer", minimum: 1 },
              text: { type: "string" },
              ...textStyleProperties,
              fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
              border_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
              border_width: { type: "number", minimum: 0, maximum: 20 },
            },
            additionalProperties: false,
          },
        },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_update_table_cell",
    description: "Update one cell in an existing native PowerPoint table without replacing the table or rasterizing it.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "row", "column"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        row: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        text: { type: "string" },
        ...textStyleProperties,
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_width: { type: "number", minimum: 0, maximum: 20 },
        cell_margin: { type: "number", minimum: 0, maximum: 100 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_update_table_layout",
    description: "Set exact native PowerPoint table column widths and row heights so method columns, numeric columns, and compact scientific tables remain aligned and readable.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        column_widths: { type: "array", minItems: 1, maxItems: 100, items: { type: "number", exclusiveMinimum: 0, maximum: 100000 } },
        row_heights: { type: "array", minItems: 1, maxItems: 200, items: { type: "number", exclusiveMinimum: 0, maximum: 100000 } },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_chart",
    description: "Add a native editable PowerPoint chart backed by embedded chart data. Use this for regular quantitative plots instead of screenshotting charts.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "left", "top", "width", "height", "categories", "series"],
      anyOf: [{ required: ["chart_type"] }, { required: ["chart_type_id"] }],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        chart_type: { type: "string", description: "Friendly plugin_name or Office XlChartType enum name returned by powerpoint_get_capabilities." },
        chart_type_id: { type: "integer", minimum: -10000, maximum: 10000 },
        categories: { type: "array", minItems: 1, maxItems: 1000, items: { type: ["string", "number"] } },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            required: ["name", "values"],
            properties: {
              name: { type: "string" },
              values: { type: "array", minItems: 1, maxItems: 1000, items: { type: "number" } },
            },
            additionalProperties: false,
          },
        },
        ...positionProperties,
        title: { type: "string" },
        has_legend: { type: "boolean", default: true },
        legend_position: { type: "string", enum: ["right", "left", "top", "bottom"], default: "right" },
        chart_style: { type: "integer", minimum: 1, maximum: 48 },
        category_axis_title: { type: "string" },
        value_axis_title: { type: "string" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_duplicate_shape",
    description: "Duplicate a native PowerPoint shape, table, chart, group, or picture and give the duplicate a stable semantic name.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "new_name"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        new_name: { type: "string", minLength: 1 },
        ...positionProperties,
        rotation: { type: "number", minimum: -360, maximum: 360 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_group_shapes",
    description: "Group two or more named native PowerPoint objects while preserving editability of the group members.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "shape_names"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        shape_names: { type: "array", minItems: 2, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        name: { type: "string" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_ungroup_shape",
    description: "Ungroup one native PowerPoint group and return the editable member inventory.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: { ...shapeTargetProperties, pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 } },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_set_z_order",
    description: "Move a native PowerPoint object forward, backward, to the front, or to the back without flattening the slide.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "command"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        command: { type: "string", enum: ["bring_to_front", "send_to_back", "bring_forward", "send_backward"] },
        repeat: { type: "integer", minimum: 1, maximum: 1000, default: 1 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_align_shapes",
    description: "Align two or more named native objects to an exact shared edge or center using PowerPoint's layout engine.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "shape_names", "alignment"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        shape_names: { type: "array", minItems: 2, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        alignment: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"] },
        relative_to: { type: "string", enum: ["selection", "slide"], default: "selection" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_distribute_shapes",
    description: "Distribute three or more named native objects with equal horizontal or vertical spacing using PowerPoint's layout engine.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "shape_names", "direction"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        shape_names: { type: "array", minItems: 3, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        direction: { type: "string", enum: ["horizontal", "vertical"] },
        relative_to: { type: "string", enum: ["selection", "slide"], default: "selection" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_update_shape",
    description: "Update an existing native shape by stable name or numeric id while preserving the rest of the slide.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        new_name: { type: "string" },
        text: { type: "string" },
        ...positionProperties,
        rotation: { type: "number", minimum: -360, maximum: 360 },
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        line_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        line_width: { type: "number", minimum: 0, maximum: 50 },
        ...textStyleProperties,
        ...textFrameProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_delete_shape",
    description: "Delete one native PowerPoint shape. Requires confirm=true because this changes the active deck.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "confirm"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: { ...shapeTargetProperties, confirm: { const: true }, pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 } },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_draw_sequence",
    description: "Apply a paced sequence of native slide, text, shape, line, connector, table, chart, image, grouping, layering, and update operations. Each operation is a distinct PowerPoint update visible to the user.",
    inputSchema: {
      type: "object",
      required: ["operations"],
      properties: {
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            required: ["type"],
            properties: { type: { type: "string", enum: ["add_slide", "add_textbox", "add_shape", "add_image", "add_line", "add_connector", "add_table", "update_table_cell", "update_table_layout", "add_chart", "duplicate_shape", "group_shapes", "ungroup_shape", "set_z_order", "align_shapes", "distribute_shapes", "update_shape", "activate_slide", "wait"] } },
            additionalProperties: true,
          },
        },
        step_delay_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_export_slide_image",
    description: "Export one slide through PowerPoint's renderer to PNG or JPG and return it for visual inspection.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "output_path"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        output_path: { type: "string", description: "Absolute .png/.jpg output path." },
        width: { type: "integer", minimum: 100, maximum: 10000, default: 1920 },
        height: { type: "integer", minimum: 100, maximum: 10000, default: 1080 },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_save",
    description: "Save the active deck, save an editable .pptx copy, or export a PDF. Existing output files require overwrite=true.",
    inputSchema: {
      type: "object",
      properties: {
        output_path: { type: "string", description: "Optional absolute .pptx or .pdf path. Without it, saves the active presentation in place." },
        format: { type: "string", enum: ["pptx", "pdf"], description: "Defaults from output_path extension." },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_close_presentation",
    description: "Close only the active presentation, either saving or discarding its unsaved changes. Requires confirm=true; use carefully when other user decks are open.",
    inputSchema: {
      type: "object",
      required: ["confirm"],
      properties: {
        confirm: { const: true },
        save_changes: { type: "string", enum: ["discard", "save"], default: "discard" },
        output_path: { type: "string", description: "Optional absolute .pptx path used when save_changes=save and the deck has no file path." },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_quit_application",
    description: "Quit PowerPoint only when it has zero open presentations. Requires confirm=true and the exact active application process id reported by powerpoint_status, preventing accidental closure of a user application instance.",
    inputSchema: {
      type: "object",
      required: ["confirm", "expected_process_id"],
      properties: {
        confirm: { const: true },
        expected_process_id: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
];

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(value, { isError = false, imageData, mimeType = "image/png" } = {}) {
  const content = [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  if (imageData) content.push({ type: "image", data: imageData, mimeType });
  return {
    content,
    ...(typeof value === "object" && value !== null ? { structuredContent: value } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

function powershellExecutable() {
  if (process.env.POWERSHELL_PATH?.trim()) return process.env.POWERSHELL_PATH.trim();
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  const candidate = systemRoot && path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return candidate && existsSync(candidate) ? candidate : "powershell.exe";
}

async function runBridge(action, args = {}) {
  if (process.platform !== "win32") throw new Error("Live PowerPoint control currently requires Windows desktop PowerPoint.");
  const payload = Buffer.from(JSON.stringify({ action, arguments: args }), "utf8").toString("base64");
  try {
    const { stdout } = await execFileAsync(
      powershellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", BRIDGE_PATH, "-PayloadBase64", payload],
      { encoding: "utf8", windowsHide: true, maxBuffer: MAX_BUFFER },
    );
    const text = stdout.trim();
    if (!text) throw new Error("PowerPoint bridge returned no JSON.");
    return JSON.parse(text);
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || error).trim();
    throw new Error(details || "PowerPoint bridge failed.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSequence(args) {
  const actionMap = {
    add_slide: "add_slide",
    add_textbox: "add_textbox",
    add_shape: "add_shape",
    add_image: "add_image",
    add_line: "add_line",
    add_connector: "add_connector",
    add_table: "add_table",
    update_table_cell: "update_table_cell",
    update_table_layout: "update_table_layout",
    add_chart: "add_chart",
    duplicate_shape: "duplicate_shape",
    group_shapes: "group_shapes",
    ungroup_shape: "ungroup_shape",
    set_z_order: "set_z_order",
    align_shapes: "align_shapes",
    distribute_shapes: "distribute_shapes",
    update_shape: "update_shape",
    activate_slide: "activate_slide",
  };
  const delay = args.step_delay_ms ?? 350;
  const results = [];
  for (let index = 0; index < args.operations.length; index += 1) {
    const operation = { ...args.operations[index] };
    const type = operation.type;
    delete operation.type;
    if (type === "wait") {
      const waitMs = Math.max(0, Math.min(10000, operation.ms ?? delay));
      await sleep(waitMs);
      results.push({ index, type, waited_ms: waitMs });
      continue;
    }
    const action = actionMap[type];
    if (!action) throw new Error(`Unsupported sequence operation at index ${index}: ${type}`);
    operation.pause_after_ms = 0;
    results.push({ index, type, result: await runBridge(action, operation) });
    if (delay > 0) await sleep(delay);
  }
  return { operations_applied: results.length, results };
}

async function handleTool(name, args = {}) {
  if (name === "powerpoint_draw_sequence") return { value: await runSequence(args) };
  const actionMap = {
    powerpoint_status: "status",
    powerpoint_get_capabilities: "capabilities",
    powerpoint_launch: "launch",
    powerpoint_new_presentation: "new_presentation",
    powerpoint_inspect: "inspect",
    powerpoint_audit_figure: "audit_figure",
    powerpoint_activate_slide: "activate_slide",
    powerpoint_add_slide: "add_slide",
    powerpoint_add_textbox: "add_textbox",
    powerpoint_add_shape: "add_shape",
    powerpoint_add_image: "add_image",
    powerpoint_add_line: "add_line",
    powerpoint_add_connector: "add_connector",
    powerpoint_add_table: "add_table",
    powerpoint_update_table_cell: "update_table_cell",
    powerpoint_update_table_layout: "update_table_layout",
    powerpoint_add_chart: "add_chart",
    powerpoint_duplicate_shape: "duplicate_shape",
    powerpoint_group_shapes: "group_shapes",
    powerpoint_ungroup_shape: "ungroup_shape",
    powerpoint_set_z_order: "set_z_order",
    powerpoint_align_shapes: "align_shapes",
    powerpoint_distribute_shapes: "distribute_shapes",
    powerpoint_update_shape: "update_shape",
    powerpoint_delete_shape: "delete_shape",
    powerpoint_export_slide_image: "export_slide_image",
    powerpoint_save: "save",
    powerpoint_close_presentation: "close_presentation",
    powerpoint_quit_application: "quit_application",
  };
  const action = actionMap[name];
  if (!action) throw new Error(`Unknown tool: ${name}`);
  const value = await runBridge(action, args);
  if (name === "powerpoint_get_capabilities") {
    const availableTools = new Set(tools.map((tool) => tool.name));
    const familyToolMap = {
      text_box: "powerpoint_add_textbox",
      auto_shape: "powerpoint_add_shape",
      free_line_or_arrow: "powerpoint_add_line",
      attached_connector: "powerpoint_add_connector",
      table: "powerpoint_add_table",
      chart: "powerpoint_add_chart",
      picture_or_svg: "powerpoint_add_image",
      duplicate: "powerpoint_duplicate_shape",
      group: "powerpoint_group_shapes",
      ungroup: "powerpoint_ungroup_shape",
      z_order: "powerpoint_set_z_order",
      align: "powerpoint_align_shapes",
      distribute: "powerpoint_distribute_shapes",
      figure_audit: "powerpoint_audit_figure",
    };
    value.native_object_families = (value.native_object_families || []).map((family) => {
      const mcpTool = familyToolMap[family.family] || null;
      return { ...family, mcp_tool: mcpTool, mcp_available: Boolean(mcpTool && availableTools.has(mcpTool)) };
    });
    value.mcp_coverage = {
      server_version: SERVER_VERSION,
      tool_count: tools.length,
      tools: [...availableTools].sort(),
      native_first_policy: "If PowerPoint exposes the semantic object and an MCP tool exists, native reconstruction is mandatory. Every picture must be one atomic irreducible raster unit with a decomposition note and must pass powerpoint_audit_figure.",
    };
  }
  if (name === "powerpoint_export_slide_image") {
    const imageData = await fs.readFile(value.output_path, { encoding: "base64" });
    return { value, imageData, mimeType: value.mime_type };
  }
  const delay = Number(args.pause_after_ms ?? 0);
  if (delay > 0) await sleep(Math.min(delay, 10000));
  return { value };
}

async function handleMessage(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    return rpcResult(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "On Windows, control the active visible PowerPoint presentation through PowerPoint's native COM object model. Use the Designer -> Drawer -> Reviewer -> Corrector loop. Call powerpoint_get_capabilities before reconstruction, keep every reconstructable item native, require every picture to be an atomic irreducible raster unit, and run powerpoint_audit_figure after each region and the whole slide. Use exact alignment/distribution, table layout, text-fit, and line-clearance tools before declaring a gate passed. Never use OS-level mouse or keyboard automation.",
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools });
  if (method === "tools/call") {
    try {
      const result = await handleTool(params?.name, params?.arguments || {});
      return rpcResult(id, toolResult(result.value, result));
    } catch (error) {
      return rpcResult(id, toolResult({ error: error.message, tool: params?.name }, { isError: true }));
    }
  }
  if (method?.startsWith("notifications/")) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error", error.message))}\n`);
    return;
  }
  try {
    const response = await handleMessage(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(rpcError(message.id, -32603, "Internal error", error.message))}\n`);
  }
});

process.on("uncaughtException", (error) => process.stderr.write(`[${SERVER_NAME}] ${error.stack || error.message}\n`));
process.on("unhandledRejection", (error) => process.stderr.write(`[${SERVER_NAME}] ${error?.stack || error}\n`));
