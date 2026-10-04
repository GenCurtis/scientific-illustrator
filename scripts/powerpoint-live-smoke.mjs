#!/usr/bin/env node
// Live end-to-end smoke test for the Windows Microsoft PowerPoint COM backend.
//
// This suite is intentionally NOT part of `npm test`/CI: the GitHub runners do
// not have Microsoft PowerPoint installed. Run it locally on a Windows machine
// with PowerPoint installed:
//
//     npm run test:live
//
// It drives the real powerpoint-live MCP server over stdio, creates one
// untitled scratch presentation in a fresh temp directory, exercises every
// COM-backed tool (lifecycle, slides, text boxes, shapes, lines, attached
// connectors, tables, native charts, images, update/duplicate/group/z-order/
// align/distribute/delete, inspect, audit, activation, PNG export, PPTX save,
// PDF export, close, quit), verifies the saved artifacts on disk (magic bytes
// plus a python-pptx round trip when available), verifies the rejection paths,
// and then closes only its own deck.
//
// PowerPoint is quit only when this suite started it; if PowerPoint was
// already running, only the scratch deck is closed. Ordinary drawing uses the
// default "preserve" focus policy, so the window does not steal focus, except
// for the single explicit powerpoint_activate_slide check.

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = process.env.POWERPOINT_LIVE_SERVER
  ? path.resolve(process.env.POWERPOINT_LIVE_SERVER)
  : path.join(root, "plugins", "scientific-illustrator", "scripts", "powerpoint-server.mjs");

function skipped(message) {
  console.log(`SKIPPED (live PowerPoint suite): ${message}`);
  process.exit(0);
}

if (process.platform !== "win32") skipped("this suite requires Windows and Microsoft PowerPoint.");
try {
  await execFileAsync("reg.exe", ["query", "HKCR\\PowerPoint.Application\\CLSID"], { encoding: "utf8" });
} catch {
  skipped("Microsoft PowerPoint is not installed (HKCR\\PowerPoint.Application\\CLSID is missing).");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = path.join(os.tmpdir(), `scientific-illustrator-live-smoke-${stamp}`);
await fs.mkdir(workDir, { recursive: true });
const imagePath = path.join(workDir, "smoke-image.png");
await fs.copyFile(
  path.join(root, "plugins", "scientific-illustrator", "officejs", "assets", "icon-64.png"),
  imagePath,
);

const deckPptx = path.join(workDir, "smoke-deck.pptx");
const deckPdf = path.join(workDir, "smoke-deck.pdf");
const slidePng = path.join(workDir, "smoke-slide.png");

const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY: "preserve" },
});
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += String(chunk)));

let nextId = 1;
const pending = new Map();
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Timed out waiting for ${method} (id ${id}).\n${stderr}`));
    }, 180000).unref();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (result) => (result.content || []).map((part) => part.text || "").join("\n");

async function tool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${textOf(result)}`);
  return result.structuredContent;
}

async function expectToolError(name, args, pattern) {
  const result = await rpc("tools/call", { name, arguments: args });
  assert.equal(result.isError, true, `${name} was expected to fail, but it succeeded.`);
  assert.match(textOf(result), pattern);
}

const steps = [];
let firstFailure = null;

async function step(label, work) {
  const started = Date.now();
  try {
    const value = await work();
    steps.push({ label, ok: true, ms: Date.now() - started });
    console.log(`ok   ${label} (${Date.now() - started} ms)`);
    return value;
  } catch (error) {
    steps.push({ label, ok: false, ms: Date.now() - started, error: error.message });
    if (!firstFailure) firstFailure = error;
    console.log(`FAIL ${label}: ${error.message}`);
    throw error;
  }
}

async function readHead(filePath, length) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

const PYTHON_VERIFIER = `
import json
import sys
import zipfile

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE


def counts(shapes):
    result = {"texts": [], "tables": 0, "charts": 0, "pictures": 0, "autoshapes": 0, "groups": 0}
    for shape in shapes:
        try:
            if shape.has_text_frame and shape.text_frame.text.strip():
                result["texts"].append(shape.text_frame.text.strip())
        except Exception:
            pass
        try:
            if shape.has_table:
                result["tables"] += 1
        except Exception:
            pass
        try:
            if shape.has_chart:
                result["charts"] += 1
        except Exception:
            pass
        shape_type = shape.shape_type
        if shape_type == MSO_SHAPE_TYPE.PICTURE:
            result["pictures"] += 1
        elif shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
            result["autoshapes"] += 1
        elif shape_type == MSO_SHAPE_TYPE.GROUP:
            result["groups"] += 1
            nested = counts(shape.shapes)
            result["texts"].extend(nested["texts"])
            for key in ("tables", "charts", "pictures", "autoshapes", "groups"):
                result[key] += nested[key]
    return result


presentation = Presentation(sys.argv[1])
report = {"slide_count": len(presentation.slides), "slides": []}
with zipfile.ZipFile(sys.argv[1]) as archive:
    equation_tags = 0
    alternate_content_shapes = 0
    slide_one_xml = ""
    for name in archive.namelist():
        if name.startswith("ppt/slides/slide") and name.endswith(".xml"):
            raw = archive.read(name).decode("utf-8", "ignore")
            equation_tags += raw.count("<a14:m")
            alternate_content_shapes += raw.count("<mc:AlternateContent")
            if name.endswith("slide1.xml"):
                slide_one_xml = raw
report["xml_equations"] = equation_tags
report["xml_alternate_content_shapes"] = alternate_content_shapes
report["xml_live_smoke_text"] = "Live smoke: text box" in slide_one_xml
for index, slide in enumerate(presentation.slides, start=1):
    entry = counts(slide.shapes)
    entry["index"] = index
    entry["shape_count"] = len(slide.shapes)
    report["slides"].append(entry)
print(json.dumps(report))
`;

async function verifySavedPptx(filePath) {
  const verifierPath = path.join(workDir, "verify-saved-deck.py");
  await fs.writeFile(verifierPath, PYTHON_VERIFIER, "utf8");
  for (const [command, prefix] of [["python", []], ["py", ["-3"]]]) {
    try {
      await execFileAsync(command, [...prefix, "-c", "import pptx"], { encoding: "utf8" });
    } catch {
      continue;
    }
    const { stdout } = await execFileAsync(command, [...prefix, verifierPath, filePath], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout.trim());
  }
  return null;
}

const SLIDE_ONE_SHAPES = [
  "smoke_conn", "smoke_text", "smoke_equation", "smoke_rect", "smoke_rect2", "smoke_rect3",
  "smoke_rect4", "smoke_rect5", "smoke_line", "smoke_image", "smoke_table", "smoke_chart",
  "batch_a", "batch_b", "batch_link", "batch_c",
  "equiv_solo_shape", "equiv_solo_target", "equiv_solo_link",
  "equiv_batch_shape", "equiv_batch_target", "equiv_batch_link",
  "eq_boundary_before", "eq_boundary_after", "eq_boundary_math",
];

let deckName = "";
let processId = 0;
let startedByUs = false;
let finished = false;
let rect3ZOrder = 0;

try {
  const statusBefore = await step("powerpoint_status (initial)", () => tool("powerpoint_status", {}));
  assert.equal(statusBefore.platform, "win32");
  assert.equal(statusBefore.installed, true);
  startedByUs = Number(statusBefore.running_processes || 0) === 0;
  console.log(
    startedByUs
      ? "     PowerPoint is not running; the suite will launch it and quit it afterwards."
      : `     PowerPoint is already running (pid ${statusBefore.process_ids.join(", ")}); only the scratch deck will be closed.`,
  );

  await step("powerpoint_set_backend(com)", async () => {
    const value = await tool("powerpoint_set_backend", { backend: "com" });
    assert.equal(value.backend_preference, "com");
    return value;
  });

  const created = await step("powerpoint_new_presentation", () => tool("powerpoint_new_presentation", {}));
  assert.equal(created.created, true);
  assert.equal(created.slide_count, 0);
  assert.ok(created.presentation_name, "new presentation must report its name");
  assert.equal(created.backend_selection?.selected, "com");
  if (startedByUs) {
    assert.equal(created.window_state, "minimized", "preserve mode must keep the newly launched PowerPoint window in the background");
  }
  deckName = created.presentation_name;

  await step("powerpoint_launch (attach to the scratch deck)", async () => {
    const value = await tool("powerpoint_launch", {});
    assert.equal(value.presentation_name, deckName);
    assert.equal(value.connected, true);
    if (startedByUs) {
      assert.equal(value.window_state, "minimized", "attaching must not pull our background window to the foreground");
    }
    return value;
  });

  await step("powerpoint_add_slide(position 1)", async () => {
    const value = await tool("powerpoint_add_slide", { position: 1, layout: "blank" });
    assert.equal(value.slide_index, 1);
    return value;
  });

  await step("powerpoint_add_slide(position 2)", async () => {
    const value = await tool("powerpoint_add_slide", { position: 2, layout: "blank" });
    assert.equal(value.slide_index, 2);
    return value;
  });

  await step("powerpoint_get_capabilities (read-only)", async () => {
    const value = await tool("powerpoint_get_capabilities", {
      include_auto_shapes: false,
      include_shape_types: false,
      include_chart_types: true,
    });
    assert.equal(value.detection?.read_only, true);
    for (const familyName of ["text_box", "auto_shape", "free_line_or_arrow", "attached_connector", "table", "chart", "picture_or_svg", "duplicate", "group", "ungroup", "z_order", "align", "distribute"]) {
      const family = (value.native_object_families || []).find((entry) => entry.family === familyName);
      assert.ok(family, `capability family ${familyName} is missing`);
      assert.equal(family.host_supported, true, `capability family ${familyName} reports host_supported=false`);
    }
    assert.ok(
      Array.isArray(value.chart_types) && value.chart_types.some((entry) => Number(entry.value) === 51),
      "xlColumnClustered (51) is missing from the native chart catalog",
    );
    return value;
  });

  await step("powerpoint_add_textbox", async () => {
    const value = await tool("powerpoint_add_textbox", {
      slide_index: 1, name: "smoke_text", text: "Live smoke: text box",
      left: 60, top: 40, width: 300, height: 40,
      font_size: 20, bold: true, alignment: "center", vertical_alignment: "middle", fill_color: "E8F0FE",
    });
    assert.equal(value.name, "smoke_text");
    assert.equal(value.type_name, "msoTextBox");
    return value;
  });

  const equation = await step("powerpoint_add_equation (native OMML)", () =>
    tool("powerpoint_add_equation", {
      slide_index: 1, name: "smoke_equation", latex: String.raw`\frac{a}{b} = \sqrt{x_1^2 + y_1^2}`,
      left: 60, top: 320, width: 420, height: 70, font_size: 18,
    }));
  assert.equal(equation.equation, true, "add_equation must report a native equation object");
  assert.equal(equation.name, "smoke_equation");

  await step("powerpoint_add_equation (append into existing text box)", async () => {
    const value = await tool("powerpoint_add_equation", {
      slide_index: 1, shape_name: "smoke_text", latex: String.raw`E = mc^2`,
    });
    assert.equal(value.equation, true);
    assert.equal(value.name, "smoke_text");
    return value;
  });

  const addShape = (name, shape, left, top, width, height, extra = {}) =>
    step(`powerpoint_add_shape(${name})`, async () => {
      const value = await tool("powerpoint_add_shape", { slide_index: 1, name, shape, left, top, width, height, ...extra });
      assert.equal(value.name, name);
      assert.equal(value.type_name, "msoAutoShape");
      return value;
    });

  await addShape("smoke_rect", "rectangle", 60, 120, 160, 90, { text: "Rect A", fill_color: "D9EAD3", line_color: "38761D", line_width: 1.5 });
  await addShape("smoke_rect2", "rounded_rectangle", 280, 130, 160, 90, { text: "Rect B", fill_color: "FFF2CC" });
  rect3ZOrder = Number((await addShape("smoke_rect3", "oval", 500, 130, 140, 90, { text: "Rect C" })).z_order_position);
  await addShape("smoke_rect4", "rectangle", 60, 280, 140, 70);
  await addShape("smoke_rect5", "rectangle", 280, 290, 140, 70);

  await step("powerpoint_add_line", async () => {
    const value = await tool("powerpoint_add_line", {
      slide_index: 1, name: "smoke_line", begin_x: 60, begin_y: 240, end_x: 300, end_y: 270,
      line_color: "990000", line_width: 2, end_arrow: "triangle",
    });
    assert.equal(value.type_name, "msoLine");
    assert.equal(Number(value.line?.begin_x), 60);
    assert.equal(Number(value.line?.end_x), 300);
    return value;
  });

  await step("powerpoint_add_connector", async () => {
    const value = await tool("powerpoint_add_connector", {
      slide_index: 1, name: "smoke_conn", source_name: "smoke_rect", target_name: "smoke_rect2",
      connector_type: "elbow", end_arrow: "triangle",
    });
    assert.equal(value.name, "smoke_conn");
    assert.ok(Number(value.id) > 0);
    return value;
  });

  await step("powerpoint_add_image", async () => {
    const value = await tool("powerpoint_add_image", {
      slide_index: 1, name: "smoke_image", image_path: imagePath, left: 800, top: 40, width: 64, height: 64,
      raster_reason: "live smoke atomic icon texture",
      source_is_tightly_cropped: true,
      atomic_raster_unit: true,
      contains_reconstructable_content: false,
      decomposition_note: "single irreducible icon; no text or axes to rebuild",
    });
    assert.equal(value.type_name, "msoPicture");
    assert.equal(value.raster_reason, "live smoke atomic icon texture");
    return value;
  });

  await step("powerpoint_add_table", async () => {
    const value = await tool("powerpoint_add_table", {
      slide_index: 1, name: "smoke_table", rows: 2, columns: 2,
      left: 520, top: 40, width: 240, height: 72,
      data: [["Metric", "Value"], ["AUC", "0.91"]],
      header_rows: 1, banded_rows: true,
    });
    assert.equal(value.is_table, true);
    assert.equal(value.rows, 2);
    assert.equal(value.columns, 2);
    return value;
  });

  await step("powerpoint_update_table_cell", async () => {
    const value = await tool("powerpoint_update_table_cell", {
      slide_index: 1, shape_name: "smoke_table", row: 2, column: 2, text: "0.93", fill_color: "FFF2CC",
    });
    assert.equal(value.updated, true);
    assert.equal(value.text, "0.93");
    return value;
  });

  await step("powerpoint_update_table_layout", async () => {
    const value = await tool("powerpoint_update_table_layout", {
      slide_index: 1, shape_name: "smoke_table", column_widths: [140, 100], row_heights: [36, 36],
    });
    assert.deepEqual(value.column_widths, [140, 100]);
    assert.deepEqual(value.row_heights, [36, 36]);
    return value;
  });

  await step("powerpoint_add_chart", async () => {
    const value = await tool("powerpoint_add_chart", {
      slide_index: 1, name: "smoke_chart", chart_type_id: 51,
      left: 520, top: 240, width: 360, height: 220,
      categories: ["A", "B", "C"], series: [{ name: "S1", values: [1, 2, 3] }], title: "Smoke",
    });
    assert.equal(Array.isArray(value), false, "add_chart must return a single structured object, not an array");
    assert.equal(value.is_chart, true);
    assert.equal(Number(value.chart_type_id), 51);
    assert.equal(value.category_count, 3);
    assert.equal(value.series_count, 1);
    assert.ok(
      value.chart_data_window === "application_hidden" || value.chart_data_window === "workbook_window_hidden",
      `chart data Excel window must stay in the background (got ${value.chart_data_window})`,
    );
    return value;
  });

  await step("powerpoint_update_shape", async () => {
    const value = await tool("powerpoint_update_shape", {
      slide_index: 1, shape_name: "smoke_rect3", text: "Rect C updated", fill_color: "FCE5CD", rotation: 5,
    });
    assert.equal(value.text, "Rect C updated");
    assert.equal(Number(value.rotation), 5);
    return value;
  });

  await step("powerpoint_duplicate_shape", async () => {
    const value = await tool("powerpoint_duplicate_shape", {
      slide_index: 1, shape_name: "smoke_text", new_name: "smoke_text_copy", left: 420, top: 110,
    });
    assert.equal(value.name, "smoke_text_copy");
    return value;
  });

  await step("powerpoint_align_shapes", async () => {
    const value = await tool("powerpoint_align_shapes", {
      slide_index: 1, shape_names: ["smoke_rect", "smoke_rect2"], alignment: "top",
    });
    assert.equal(Number(value.shapes?.[0]?.top), Number(value.shapes?.[1]?.top));
    return value;
  });

  await step("powerpoint_distribute_shapes", async () => {
    const value = await tool("powerpoint_distribute_shapes", {
      slide_index: 1, shape_names: ["smoke_rect3", "smoke_rect4", "smoke_rect5"], direction: "horizontal",
    });
    const boxes = (value.shapes || [])
      .map((shape) => ({ left: Number(shape.left), width: Number(shape.width) }))
      .sort((a, b) => a.left - b.left);
    assert.equal(boxes.length, 3);
    const firstGap = boxes[1].left - (boxes[0].left + boxes[0].width);
    const secondGap = boxes[2].left - (boxes[1].left + boxes[1].width);
    assert.ok(Math.abs(firstGap - secondGap) < 0.05, `horizontal gaps are uneven: ${firstGap} vs ${secondGap}`);
    return value;
  });

  await step("powerpoint_set_z_order(bring_to_front)", async () => {
    const value = await tool("powerpoint_set_z_order", { slide_index: 1, shape_name: "smoke_rect3", command: "bring_to_front" });
    assert.ok(Number(value.z_order_position) > rect3ZOrder, `z-order did not move forward: ${value.z_order_position} <= ${rect3ZOrder}`);
    return value;
  });

  await step("powerpoint_group_shapes", async () => {
    const value = await tool("powerpoint_group_shapes", { slide_index: 1, shape_names: ["smoke_rect", "smoke_rect2"], name: "smoke_group" });
    assert.equal(value.type_name, "msoGroup");
    assert.equal(value.group_item_count, 2);
    return value;
  });

  await step("powerpoint_ungroup_shape", async () => {
    const value = await tool("powerpoint_ungroup_shape", { slide_index: 1, shape_name: "smoke_group" });
    assert.equal(value.ungrouped, true);
    assert.equal(value.member_count, 2);
    return value;
  });

  await step("powerpoint_delete_shape", async () => {
    const value = await tool("powerpoint_delete_shape", { slide_index: 1, shape_name: "smoke_text_copy", confirm: true });
    assert.equal(value.deleted, true);
    assert.equal(value.shape?.name, "smoke_text_copy");
    return value;
  });

  await step("powerpoint_draw_sequence (bounded COM batch)", async () => {
    const value = await tool("powerpoint_draw_sequence", {
      operations: [
        { type: "add_shape", slide_index: 1, name: "batch_a", shape: "rectangle", left: 640, top: 60, width: 90, height: 40, fill_color: "D9EAD3" },
        { type: "add_shape", slide_index: 1, name: "batch_b", shape: "rounded_rectangle", left: 780, top: 60, width: 90, height: 40 },
        { type: "add_connector", slide_index: 1, name: "batch_link", source_name: "batch_a", target_name: "batch_b" },
        { type: "update_shape", slide_index: 1, shape_name: "batch_a", text: "batch" },
      ],
      pacing_mode: "fast",
    });
    assert.equal(value.object_operations_applied, 4);
    assert.ok(Array.isArray(value.batches) && value.batches.length >= 1, "COM sequences must report a bounded batch");
    assert.ok(value.batches[0].operations_applied >= 1);
    return value;
  });

  await step("powerpoint_draw_sequence keeps the committed prefix on partial failure", async () => {
    await expectToolError("powerpoint_draw_sequence", {
      operations: [
        { type: "add_shape", slide_index: 1, name: "batch_c", shape: "rectangle", left: 640, top: 130, width: 90, height: 40 },
        { type: "add_shape", slide_index: 1, name: "batch_c", shape: "rectangle", left: 640, top: 130, width: 90, height: 40 },
      ],
      pacing_mode: "fast",
    }, /failed_operation_index/);
    const inspected = await tool("powerpoint_inspect", { include_text: false, max_shapes_per_slide: 1000 });
    const names = new Set(inspected.slides[0].shapes.map((shape) => shape.shape_name ?? shape.name));
    assert.ok(names.has("batch_c"), "the committed prefix must remain after a partial batch failure");
    return inspected;
  });

  await step("powerpoint_draw_sequence matches the per-object path (COM equivalence)", async () => {
    await tool("powerpoint_add_shape", { slide_index: 1, name: "equiv_solo_shape", shape: "rectangle", left: 60, top: 420, width: 90, height: 40, text: "same", fill_color: "D9EAD3" });
    await tool("powerpoint_add_shape", { slide_index: 1, name: "equiv_solo_target", shape: "rounded_rectangle", left: 200, top: 420, width: 90, height: 40 });
    await tool("powerpoint_add_connector", { slide_index: 1, name: "equiv_solo_link", source_name: "equiv_solo_shape", target_name: "equiv_solo_target" });
    await tool("powerpoint_update_shape", { slide_index: 1, shape_name: "equiv_solo_shape", rotation: 5 });
    const batched = await tool("powerpoint_draw_sequence", {
      pacing_mode: "fast",
      operations: [
        { type: "add_shape", slide_index: 1, name: "equiv_batch_shape", shape: "rectangle", left: 60, top: 420, width: 90, height: 40, text: "same", fill_color: "D9EAD3" },
        { type: "add_shape", slide_index: 1, name: "equiv_batch_target", shape: "rounded_rectangle", left: 200, top: 420, width: 90, height: 40 },
        { type: "add_connector", slide_index: 1, name: "equiv_batch_link", source_name: "equiv_batch_shape", target_name: "equiv_batch_target" },
        { type: "update_shape", slide_index: 1, shape_name: "equiv_batch_shape", rotation: 5 },
      ],
    });
    assert.equal(batched.batches.length, 1, "four fast operations must fit one batch");
    const inspected = await tool("powerpoint_inspect", { include_text: true, max_shapes_per_slide: 1000 });
    const byName = new Map(inspected.slides[0].shapes.map((shape) => [shape.shape_name ?? shape.name, shape]));
    for (const [soloName, batchName] of [
      ["equiv_solo_shape", "equiv_batch_shape"],
      ["equiv_solo_target", "equiv_batch_target"],
      ["equiv_solo_link", "equiv_batch_link"],
    ]) {
      const solo = byName.get(soloName);
      const batch = byName.get(batchName);
      assert.ok(solo && batch, `missing equivalence pair ${soloName}/${batchName}`);
      for (const field of ["type_name", "auto_shape_type", "left", "top", "width", "height", "rotation", "text"]) {
        assert.equal(batch[field], solo[field], `${batchName}.${field} differs from ${soloName}: ${batch[field]} vs ${solo[field]}`);
      }
    }
    return inspected;
  });

  await step("powerpoint_draw_sequence treats equations as a batch boundary", async () => {
    const value = await tool("powerpoint_draw_sequence", {
      pacing_mode: "fast",
      operations: [
        { type: "add_shape", slide_index: 1, name: "eq_boundary_before", shape: "rectangle", left: 400, top: 420, width: 70, height: 30 },
        { type: "add_equation", slide_index: 1, name: "eq_boundary_math", latex: String.raw`a^2 + b^2 = c^2`, left: 500, top: 420, width: 220, height: 40 },
        { type: "add_shape", slide_index: 1, name: "eq_boundary_after", shape: "rectangle", left: 760, top: 420, width: 70, height: 30 },
      ],
    });
    assert.equal(value.batches.length, 2, "the equation must split COM batches");
    const equationResult = value.results.find((entry) => entry.type === "add_equation");
    assert.ok(equationResult, "the equation result is missing from the sequence results");
    assert.equal(equationResult.result.equation, true);
    return value;
  });

  await step("powerpoint_draw_sequence preflight rejects before any mutation", async () => {
    const before = await tool("powerpoint_inspect", { include_text: false, max_shapes_per_slide: 1000 });
    await expectToolError("powerpoint_draw_sequence", {
      pacing_mode: "fast",
      operations: [
        { type: "add_shape", slide_index: 1, name: "preflight_ghost", shape: "rectangle", left: 10, top: 10, width: 20, height: 20 },
        { type: "unsupported_op" },
      ],
    }, /Unsupported sequence operation/);
    const after = await tool("powerpoint_inspect", { include_text: false, max_shapes_per_slide: 1000 });
    assert.equal(after.slides[0].shape_count, before.slides[0].shape_count, "preflight must reject before mutating the deck");
    return after;
  });

  await step("powerpoint_draw_sequence splits batches at checkpoints by default", async () => {
    const operations = Array.from({ length: 12 }, (_, index) => ({
      type: "update_shape", slide_index: 1, shape_name: "batch_a", text: "c",
    }));
    const value = await tool("powerpoint_draw_sequence", { operations });
    assert.deepEqual(value.batches.map((batch) => batch.operations_applied), [10, 2], "default checkpoint batches must split at 10 operations");
    return value;
  });

  await step("powerpoint_inspect", async () => {
    const value = await tool("powerpoint_inspect", { include_text: true });
    assert.equal(value.slide_count, 2);
    const slideOne = (value.slides || []).find((slide) => slide.index === 1);
    assert.ok(slideOne, "slide 1 is missing from the inspection");
    const names = new Set((slideOne.shapes || []).map((shape) => shape.name));
    for (const name of SLIDE_ONE_SHAPES) assert.ok(names.has(name), `inspect is missing shape ${name}`);
    assert.equal(names.has("smoke_group"), false, "the ungrouped group is still visible");
    assert.equal(names.has("smoke_text_copy"), false, "the deleted duplicate is still visible");
    assert.equal(slideOne.shape_count, SLIDE_ONE_SHAPES.length);
    return value;
  });

  await step("powerpoint_audit_figure", async () => {
    const value = await tool("powerpoint_audit_figure", { slide_index: 1 });
    assert.equal(value.hard_failure_count, 0, `audit hard failures: ${JSON.stringify(value.findings)}`);
    assert.equal(value.passed, true);
    return value;
  });

  await step("discipline counters detect repeated unchanged reviews", async () => {
    const inspectOne = await tool("powerpoint_inspect", { include_text: false, max_shapes_per_slide: 1000 });
    const inspectTwo = await tool("powerpoint_inspect", { include_text: false, max_shapes_per_slide: 1000 });
    assert.equal(inspectTwo.discipline.unchanged_since_last_call, true, "a repeated unchanged inspect must be flagged");
    assert.equal(inspectTwo.discipline.redundant_inspects, inspectOne.discipline.redundant_inspects + 1);
    const renderPath = path.join(workDir, "discipline-render.png");
    const renderOne = await tool("powerpoint_export_slide_image", { slide_index: 1, output_path: renderPath, overwrite: true });
    const renderTwo = await tool("powerpoint_export_slide_image", { slide_index: 1, output_path: renderPath, overwrite: true });
    assert.equal(renderTwo.discipline.unchanged_since_last_call, true, "a repeated unchanged render must be flagged");
    assert.equal(renderTwo.discipline.redundant_renders, renderOne.discipline.redundant_renders + 1);
    await tool("powerpoint_update_shape", { slide_index: 1, shape_name: "batch_a", fill_color: "F4CCCC" });
    const renderThree = await tool("powerpoint_export_slide_image", { slide_index: 1, output_path: renderPath, overwrite: true });
    assert.equal(renderThree.discipline.unchanged_since_last_call, false, "a render after a mutation is fresh");
    assert.equal(renderThree.discipline.mutations_since_last_render, 0);
    assert.equal(renderThree.discipline.stale_review, true, "the earlier audit is stale after the mutation");
    await tool("powerpoint_audit_figure", { slide_index: 1 });
    const status = await tool("powerpoint_status", {});
    assert.equal(status.discipline.stale_review, false, "a fresh audit and render clear the review debt");
    return status;
  });

  console.log("     note: powerpoint_activate_slide intentionally brings the presentation forward once.");
  await step("powerpoint_activate_slide", async () => {
    const value = await tool("powerpoint_activate_slide", { slide_index: 1 });
    assert.equal(value.activated, true);
    return value;
  });

  await step("powerpoint_export_slide_image", async () => {
    const value = await tool("powerpoint_export_slide_image", { slide_index: 1, output_path: slidePng, width: 1280, height: 720 });
    assert.ok(Number(value.bytes) > 0);
    assert.equal(value.width, 1280);
    assert.equal(value.height, 720);
    const head = await readHead(slidePng, 4);
    assert.equal(head.toString("hex"), "89504e47", "the exported slide is not a PNG");
    return value;
  });

  await step("powerpoint_save(pptx)", async () => {
    const value = await tool("powerpoint_save", { output_path: deckPptx, overwrite: true });
    assert.equal(value.saved, true);
    assert.equal(value.format, "pptx");
    const head = await readHead(deckPptx, 4);
    assert.equal(head.toString("hex"), "504b0304", "the saved deck is not an OOXML package");
    const report = await verifySavedPptx(deckPptx);
    if (!report) {
      console.log("     note: python-pptx is unavailable; verified the file magic only.");
      return value;
    }
    assert.equal(report.slide_count, 2, "the saved deck must contain 2 slides");
    const [slideOne, slideTwo] = report.slides;
    assert.equal(slideTwo.shape_count, 0, "the second slide must stay blank");
    assert.ok(report.xml_live_smoke_text, `saved text is missing: ${slideOne.texts.join(" | ")}`);
    assert.ok(slideOne.tables >= 1, "the saved deck must contain the native table");
    assert.equal(slideOne.charts, 1, "the saved deck must contain the native chart");
    assert.equal(slideOne.pictures, 1, "the saved deck must contain the picture");
    assert.ok(slideOne.autoshapes >= 5, `expected native auto shapes in the saved deck, found ${slideOne.autoshapes}`);
    assert.ok(report.xml_equations >= 3, `expected native OMML equations in the saved deck, found ${report.xml_equations} math zones`);
    return value;
  });

  await step("powerpoint_save(pdf)", async () => {
    const value = await tool("powerpoint_save", { output_path: deckPdf, format: "pdf", overwrite: true });
    assert.equal(value.saved, true);
    assert.equal(value.format, "pdf");
    assert.ok(Number(value.bytes) > 1024, "the exported PDF is suspiciously small");
    const head = await readHead(deckPdf, 5);
    assert.equal(head.toString("latin1"), "%PDF-", "the exported PDF has a wrong header");
    return value;
  });

  await step("powerpoint_save rejects a non-pptx/pdf extension", () =>
    expectToolError("powerpoint_save", { output_path: path.join(workDir, "smoke-deck.txt") }, /must end with \.pptx or \.pdf/));

  await step("powerpoint_add_textbox rejects a duplicate shape name", () =>
    expectToolError("powerpoint_add_textbox", { slide_index: 1, name: "smoke_text", text: "duplicate", left: 10, top: 10, width: 120, height: 30 }, /already exists/));

  const statusBeforeClose = await step("powerpoint_status (confirm the scratch deck is active)", () => tool("powerpoint_status", {}));
  assert.equal(statusBeforeClose.presentation?.presentation_name, deckName, "the active deck is not the scratch deck");
  processId = Number(statusBeforeClose.active_application_process_id || 0);

  await step("powerpoint_close_presentation(discard)", async () => {
    const value = await tool("powerpoint_close_presentation", { confirm: true, save_changes: "discard" });
    assert.equal(value.closed, true);
    return value;
  });

  if (startedByUs) {
    await step("powerpoint_quit_application", async () => {
      const value = await tool("powerpoint_quit_application", { confirm: true, expected_process_id: processId });
      assert.equal(value.quit, true);
      return value;
    });
    await step("powerpoint_status (PowerPoint fully exited)", async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const value = await tool("powerpoint_status", {});
        if (Number(value.running_processes || 0) === 0) return value;
        await sleep(500);
      }
      throw new Error("PowerPoint is still running after the quit request.");
    });
  } else {
    console.log("skip  powerpoint_quit_application (PowerPoint was already running before the suite)");
  }

  finished = true;
} catch (error) {
  if (!firstFailure) firstFailure = error;
  console.log("\ncleanup: restoring PowerPoint state after the failure...");
  try {
    const status = await tool("powerpoint_status", {});
    if (status?.presentation?.presentation_name && status.presentation.presentation_name === deckName) {
      await tool("powerpoint_close_presentation", { confirm: true, save_changes: "discard" });
    } else if (status?.active_presentation) {
      console.warn(`cleanup: the active deck "${status?.presentation?.presentation_name}" is not the scratch deck; leaving it open.`);
    }
    if (startedByUs && Number(status?.running_processes || 0) > 0) {
      const pid = Number(status?.active_application_process_id || 0);
      if (pid > 0) await tool("powerpoint_quit_application", { confirm: true, expected_process_id: pid });
    }
  } catch (cleanupError) {
    console.warn(`cleanup warning: ${cleanupError.message}`);
  }
} finally {
  lines.close();
  child.kill();
}

console.log(`\nartifacts kept for inspection: ${workDir}`);

if (firstFailure) {
  console.error(`\nPowerPoint live smoke FAILED: ${firstFailure.message}`);
  if (stderr.trim()) console.error(`server stderr:\n${stderr.slice(0, 2000)}`);
  process.exit(1);
}

const okCount = steps.filter((entry) => entry.ok).length;
console.log(`\nPowerPoint live smoke passed: ${okCount}/${steps.length} steps.`);
process.exit(0);
