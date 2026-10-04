// Verifies the deck truth document (deck@1): schema validation, three-level
// discovery (explicit deck_path > .scientific-illustrator/decks/<stem>/deck.json
// > sibling <stem>.si-deck.json), slide brief path resolution, the optimistic
// locking lifecycle, and the deck_read/deck_write MCP tools through a real
// server process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  DECK_SCHEMA_VERSION,
  KNOWN_SLIDE_ROLES,
  readDeck,
  resolveDeckTarget,
  slideBriefPath,
  validateDeck,
  writeDeck,
} from "../plugins/scientific-illustrator/scripts/figure-deck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-deck-"));
process.on("exit", () => {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeDeck(overrides = {}) {
  return {
    schema: DECK_SCHEMA_VERSION,
    deck_id: "egu2026-talk",
    title: "Carbon cycle talk",
    profile: "slides",
    style_id: "main",
    profile_settings: { aspect: "16:9" },
    narrative: {
      arc: ["background", "question", "method", "result", "conclusion"],
      message: "The carbon cycle shifts under warming.",
    },
    slides: [
      { id: "01-title", role: "title", message: "Title and motivation" },
      { id: "02-method", role: "method", message: "Sampling and analysis" },
      { id: "03-result", role: "result", message: "Warming signal", brief: "briefs/03-result.json" },
    ],
    ...overrides,
  };
}

try {
  // ----------------------------------------------------- validation
  await check("a well-formed deck validates without errors or warnings", () => {
    const { errors, warnings } = validateDeck(makeDeck());
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  await check("schema, deck_id, and slide ids are enforced", () => {
    assert.equal(validateDeck(makeDeck({ schema: "scientific-illustrator/deck@2" })).errors.some((e) => e.includes("schema must be")), true);
    assert.equal(validateDeck(makeDeck({ deck_id: "  " })).errors.some((e) => e.includes("deck_id")), true);
    assert.equal(validateDeck(makeDeck({ slides: "x" })).errors.some((e) => e.includes("slides must be an array")), true);
    assert.equal(validateDeck(makeDeck({ slides: [null] })).errors.some((e) => e.includes("slides[0] must be an object")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a" }, { id: "a" }] })).errors.some((e) => e.includes("duplicate id")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ message: "no id" }] })).errors.some((e) => e.includes(".id must be")), true);
  });

  await check("profile, style_id, and profile_settings follow the brief conventions", () => {
    assert.equal(validateDeck(makeDeck({ profile: "slides2" })).warnings.some((w) => w.includes("not one of the known profiles")), true);
    assert.equal(validateDeck(makeDeck({ profile: "" })).errors.some((e) => e.includes("profile must be")), true);
    assert.equal(validateDeck(makeDeck({ style_id: null })).errors.length, 0);
    assert.equal(validateDeck(makeDeck({ style_id: 42 })).errors.some((e) => e.includes("style_id")), true);
    assert.equal(validateDeck(makeDeck({ profile_settings: { nonsense: 1 } })).warnings.some((w) => w.includes("profile_settings.nonsense")), true);
    assert.equal(validateDeck(makeDeck({ profile_settings: [] })).errors.some((e) => e.includes("profile_settings must be an object")), true);
  });

  await check("narrative and slide entries reject malformed values and warn on unknown fields", () => {
    assert.equal(validateDeck(makeDeck({ narrative: { arc: ["a", ""] } })).errors.some((e) => e.includes("narrative.arc")), true);
    assert.equal(validateDeck(makeDeck({ narrative: { message: "" } })).errors.some((e) => e.includes("narrative.message")), true);
    assert.equal(validateDeck(makeDeck({ narrative: { beat: "x" } })).warnings.some((w) => w.includes("narrative.beat")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", role: "mystery" }] })).warnings.some((w) => w.includes("not one of the known roles")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", role: "" }] })).errors.some((e) => e.includes(".role")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", note: "x" }] })).warnings.some((w) => w.includes("slides[0].note")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", message: " " }] })).errors.some((e) => e.includes(".message")), true);
    assert.equal(KNOWN_SLIDE_ROLES.includes("backup"), true);
  });

  await check("slide brief references must stay relative to the deck directory", () => {
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", brief: "C:/abs/brief.json" }] })).errors.some((e) => e.includes("relative path")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", brief: "../escape.json" }] })).errors.some((e) => e.includes("relative path")), true);
    assert.equal(validateDeck(makeDeck({ slides: [{ id: "a", brief: "slides/a.brief.json" }] })).errors.length, 0);
  });

  await check("unknown top-level fields and invalid revisions are handled", () => {
    assert.equal(validateDeck(makeDeck({ something_new: 1 })).warnings.some((w) => w.includes("something_new")), true);
    assert.equal(validateDeck(makeDeck({ revision: -1 })).errors.some((e) => e.includes("revision")), true);
    assert.equal(validateDeck(makeDeck({ revision: 1.5 })).errors.some((e) => e.includes("revision")), true);
    assert.equal(validateDeck(makeDeck({ revision: "3" })).errors.some((e) => e.includes("revision")), true);
    assert.equal(validateDeck(null).errors.some((e) => e.includes("must be a JSON object")), true);
  });

  await check("slideBriefPath resolves explicit references and the conventional location", () => {
    const deckPath = path.join(tempRoot, "decks", "talk", "deck.json");
    const explicit = slideBriefPath(null, deckPath, { id: "03-result", brief: "briefs/03-result.json" });
    assert.equal(explicit, path.join(tempRoot, "decks", "talk", "briefs", "03-result.json"));
    const conventional = slideBriefPath(null, deckPath, { id: "01-title" });
    assert.equal(conventional, path.join(tempRoot, "decks", "talk", "slides", "01-title.brief.json"));
    const slugged = slideBriefPath(null, deckPath, { id: "A B/C" });
    assert.equal(slugged, path.join(tempRoot, "decks", "talk", "slides", "A-B-C.brief.json"));
    assert.throws(() => slideBriefPath(null, deckPath, { id: "a", brief: "../../escape.json" }), /escapes the deck directory/);
    assert.throws(() => slideBriefPath(null, deckPath, { id: "" }), /slide\.id/);
    assert.throws(() => slideBriefPath(null, "", { id: "a" }), /deckPath/);
  });

  // ----------------------------------------------------- discovery + lifecycle
  await check("discovery prefers explicit, then project, then sibling placement", async () => {
    const base = path.join(tempRoot, "discover");
    await fs.mkdir(base, { recursive: true });
    const artifact = path.join(base, "talk.pptx");
    const sibling = await resolveDeckTarget({ artifactPath: artifact });
    assert.equal(sibling.resolutionBasis, "sibling");
    assert.equal(sibling.target, path.join(base, "talk.si-deck.json"));
    await fs.mkdir(path.join(base, ".scientific-illustrator"), { recursive: true });
    const project = await resolveDeckTarget({ artifactPath: artifact });
    assert.equal(project.resolutionBasis, "project");
    assert.equal(project.target, path.join(base, ".scientific-illustrator", "decks", "talk", "deck.json"));
    const explicit = await resolveDeckTarget({ artifactPath: artifact, deckPath: path.join(base, "custom", "deck.json") });
    assert.equal(explicit.resolutionBasis, "explicit");
    assert.equal(explicit.target, path.join(base, "custom", "deck.json"));
  });

  await check("create, update, and read follow the tool-managed lifecycle", async () => {
    const base = path.join(tempRoot, "lifecycle");
    await fs.mkdir(base, { recursive: true });
    const artifact = path.join(base, "lifecycle.pptx");
    const created = await writeDeck({ artifactPath: artifact, document: makeDeck() });
    assert.equal(created.created, true);
    assert.equal(created.revision, 0);
    const read = await readDeck({ artifactPath: artifact });
    assert.equal(read.exists, true);
    assert.equal(read.document.deck_id, "egu2026-talk");
    assert.equal(read.revision, 0);
    assert.equal(typeof read.document.created_at, "string");
    const updated = await writeDeck({
      artifactPath: artifact,
      document: makeDeck({ title: "Updated" }),
      expectedRevision: 0,
    });
    assert.equal(updated.created, false);
    assert.equal(updated.revision, 1);
    const reread = await readDeck({ artifactPath: artifact });
    assert.equal(reread.document.title, "Updated");
    assert.equal(reread.document.created_at, read.document.created_at);
  });

  await check("stale revisions, missing expectations, and invalid existing files are rejected", async () => {
    const base = path.join(tempRoot, "locking");
    await fs.mkdir(base, { recursive: true });
    const artifact = path.join(base, "locking.pptx");
    await writeDeck({ artifactPath: artifact, document: makeDeck() });
    await assert.rejects(
      writeDeck({ artifactPath: path.join(base, "fresh.pptx"), document: makeDeck(), expectedRevision: 3 }),
      /expected_revision must be 0/
    );
    await assert.rejects(
      writeDeck({ artifactPath: artifact, document: makeDeck(), expectedRevision: 7 }),
      /does not match the current revision/
    );
    await assert.rejects(writeDeck({ artifactPath: artifact, document: makeDeck() }), /pass expected_revision=0/);
    await assert.rejects(
      writeDeck({ artifactPath: artifact, document: makeDeck(), expectedRevision: 1.5 }),
      /non-negative integer/
    );
    const target = (await resolveDeckTarget({ artifactPath: artifact })).target;
    await fs.writeFile(target, JSON.stringify({ ...makeDeck(), revision: "3" }), "utf8");
    await assert.rejects(
      writeDeck({ artifactPath: artifact, document: makeDeck(), expectedRevision: 0 }),
      /invalid or missing revision/
    );
    await fs.writeFile(target, JSON.stringify({ ...makeDeck(), schema: "scientific-illustrator/deck@2", revision: 0 }), "utf8");
    await assert.rejects(
      writeDeck({ artifactPath: artifact, document: makeDeck(), expectedRevision: 0 }),
      /refusing to overwrite across schema versions/
    );
  });

  await check("a missing deck reads as exists=false and a corrupt deck throws", async () => {
    const base = path.join(tempRoot, "missing");
    await fs.mkdir(base, { recursive: true });
    const missing = await readDeck({ artifactPath: path.join(base, "none.pptx") });
    assert.equal(missing.exists, false);
    assert.equal(missing.document, null);
    const artifact = path.join(base, "corrupt.pptx");
    const target = (await resolveDeckTarget({ artifactPath: artifact })).target;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "{not json", "utf8");
    await assert.rejects(readDeck({ artifactPath: artifact }), /not valid JSON/);
  });

  await check("tool-managed fields are ignored with warnings", async () => {
    const base = path.join(tempRoot, "managed");
    await fs.mkdir(base, { recursive: true });
    const artifact = path.join(base, "managed.pptx");
    const created = await writeDeck({
      artifactPath: artifact,
      document: makeDeck({ created_at: "1999-01-01T00:00:00.000Z", revision: 9 }),
    });
    assert.equal(created.revision, 0);
    assert.equal(created.schema_warnings.some((w) => w.includes("created_at is tool-managed")), true);
    assert.equal(created.schema_warnings.some((w) => w.includes("revision is tool-managed")), true);
    const read = await readDeck({ artifactPath: artifact });
    assert.notEqual(read.document.created_at, "1999-01-01T00:00:00.000Z");
  });

  // ----------------------------------------------------- MCP wiring
  console.log("MCP tool wiring");
  {
    const mcpDir = path.join(tempRoot, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    const artifact = path.join(mcpDir, "talk.pptx");
    const child = spawn(process.execPath, [path.join(root, "plugins", "scientific-illustrator", "scripts", "server.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    let nextId = 0;
    const pending = new Map();
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
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
      entry.resolve(message.result);
    });
    async function request(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`timeout ${method}: ${stderr}`));
        }, 30000).unref();
      });
    }
    async function call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
      return result.structuredContent;
    }

    try {
      const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "figure-deck-smoke", version: "1.0.0" } });

      await check("tools/list exposes deck_read/deck_write and instructions mention them", async () => {
        const tools = await request("tools/list");
        const names = new Set(tools.tools.map((tool) => tool.name));
        assert.equal(names.has("deck_read"), true);
        assert.equal(names.has("deck_write"), true);
        const write = tools.tools.find((tool) => tool.name === "deck_write");
        assert.deepEqual(write.inputSchema.required, ["document"]);
        assert.equal(write.inputSchema.additionalProperties, false);
        assert.match(init.instructions, /deck_read\/deck_write/);
      });

      await check("the MCP round trip writes and reads the deck at the sibling location", async () => {
        const created = await call("deck_write", { artifact_path: artifact, document: makeDeck() });
        assert.equal(created.created, true);
        assert.equal(created.resolved_path, path.join(mcpDir, "talk.si-deck.json"));
        const read = await call("deck_read", { artifact_path: artifact });
        assert.equal(read.exists, true);
        assert.equal(read.document.slides.length, 3);
      });

      await check("updates require the current revision and stale writes fail loudly", async () => {
        const updated = await call("deck_write", {
          artifact_path: artifact,
          document: makeDeck({ title: "Second version" }),
          expected_revision: 0,
        });
        assert.equal(updated.revision, 1);
        await assert.rejects(
          call("deck_write", { artifact_path: artifact, document: makeDeck(), expected_revision: 0 }),
          /does not match the current revision/
        );
      });

      await check("a missing deck reads as exists=false and an explicit path anchors without an artifact", async () => {
        const missing = await call("deck_read", { artifact_path: path.join(mcpDir, "missing.pptx") });
        assert.equal(missing.exists, false);
        const explicitPath = path.join(mcpDir, "anchored", "deck.json");
        await call("deck_write", { deck_path: explicitPath, document: makeDeck({ deck_id: "anchored" }) });
        const read = await call("deck_read", { deck_path: explicitPath });
        assert.equal(read.document.deck_id, "anchored");
        assert.equal(read.resolution_basis, "explicit");
      });

      await check("an invalid deck document is rejected with field-level errors", async () => {
        await assert.rejects(
          call("deck_write", { artifact_path: artifact, document: makeDeck({ slides: [{ id: "" }] }) }),
          /Deck document is invalid/
        );
      });
    } finally {
      lines.close();
      child.kill();
    }
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log(`figure deck smoke: ${checks} checks passed.`);
