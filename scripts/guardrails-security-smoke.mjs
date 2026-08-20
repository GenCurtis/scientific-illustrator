// Permission / security edge-case smoke test for the Scientific Illustrator
// guardrails. Covers the allowed-root confinement (lexical + symlink escape),
// image magic-byte sniffing, atomic writes, the Office.js page-token asset
// auth, and the PowerPoint sequence-operation schema validation.
//
// Run with: node scripts/guardrails-security-smoke.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { OfficeJsCommandBridge } from "../plugins/scientific-illustrator/scripts/officejs-bridge.mjs";
import {
  assertAllowedPath,
  assertAllowedRealPath,
  atomicWrite,
  sniffImageMime,
  MAX_IMAGE_BYTES,
} from "../plugins/scientific-illustrator/scripts/guardrails.mjs";
import { validateSequenceOperation, sanitizePathArgs } from "../plugins/scientific-illustrator/scripts/powerpoint-server.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scientific-illustrator-guardrails-"));
const isWindows = process.platform === "win32";
const OLD_ROOT = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok - ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${label}: ${error.message}`);
  }
}

function setRoot(root) {
  if (root === null) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = root;
}

async function expectThrowsAsync(fn, pattern) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "expected a throw but none occurred");
  assert.match(String(error.message), pattern);
  return error;
}

function expectThrows(fn, pattern) {
  let error;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "expected a throw but none occurred");
  assert.match(String(error.message), pattern);
  return error;
}

function requestAssetStatus(port, route, { token, bearer } = {}) {
  return new Promise((resolve, reject) => {
    const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
    const req = https.request({
      hostname: "127.0.0.1",
      port,
      path: token ? `${route}?token=${encodeURIComponent(token)}` : route,
      method: "GET",
      rejectUnauthorized: false,
      headers,
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.once("error", reject);
    req.end();
  });
}

function rawRequest(port, { path: route, method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      rejectUnauthorized: false,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject);
    req.end();
  });
}

function findOpenssl() {
  const candidates = ["openssl"];
  if (process.platform === "win32") {
    candidates.unshift("C:\\Program Files\\Git\\usr\\bin\\openssl.exe");
  }
  for (const candidate of candidates) {
    try {
      execFileAsync(candidate, ["version"], { maxBuffer: 1024 * 1024 });
      return candidate;
    } catch {}
  }
  return null;
}

try {
  console.log("1. assertAllowedPath lexical confinement");
  {
    const root = path.join(tempRoot, "allowed");
    const outside = path.join(tempRoot, "outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });

    setRoot(root);
    await check("exact root is allowed", () => assert.equal(assertAllowedPath(root), root));
    await check("path inside root is allowed", () => {
      const p = path.join(root, "sub", "file.drawio");
      assert.equal(assertAllowedPath(p), p);
    });
    await check("sibling prefix root-evil is rejected", () => {
      expectThrows(() => assertAllowedPath(`${root}-evil`), /outside the configured/);
    });
    await check("path outside root is rejected", () => {
      expectThrows(() => assertAllowedPath(path.join(outside, "file")), /outside the configured/);
    });
    await check("traversal escaping root is rejected", () => {
      expectThrows(() => assertAllowedPath(path.join(root, "..", "outside", "file")), /outside the configured/);
    });
    await check("traversal staying inside root is allowed", () => {
      const p = path.join(root, "a", "..", "sub");
      assert.equal(assertAllowedPath(p), path.join(root, "sub"));
    });
    if (isWindows) {
      await check("win32 root comparison is case-insensitive", () => {
        const alt = root.toLowerCase();
        const accepted = assertAllowedPath(path.join(alt, "x"));
        assert.equal(accepted.toLowerCase(), path.join(root, "x").toLowerCase());
      });
    }
    setRoot(null);
    await check("no root set preserves any-path behavior", () => {
      assert.equal(assertAllowedPath(path.join(outside, "file")), path.join(outside, "file"));
    });
    await check("~ is expanded relative to home, not cwd", () => {
      assert.equal(assertAllowedPath("~/guardrail-home-token.txt"), path.join(os.homedir(), "guardrail-home-token.txt"));
    });
    setRoot(root);
  }

  console.log("2. assertAllowedRealPath symlink escape defense");
  {
    const root = path.join(tempRoot, "real-root");
    const secretDir = path.join(tempRoot, "secret-dir");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(secretDir, { recursive: true });
    const secretFile = path.join(secretDir, "secret.txt");
    await fs.writeFile(secretFile, "top secret");
    setRoot(root);

    let fileSymlinkOk = false;
    let dirSymlinkOk = false;
    try {
      await fs.symlink(secretFile, path.join(root, "link-file.txt"));
      fileSymlinkOk = true;
    } catch (error) {
      console.log(`  (file symlink unavailable (${error.code}); skipping file-escape checks)`);
    }
    try {
      await fs.symlink(secretDir, path.join(root, "link-dir"), "junction");
      dirSymlinkOk = true;
    } catch (error) {
      console.log(`  (directory symlink unavailable (${error.code}); skipping dir-escape checks)`);
    }
    if (fileSymlinkOk) {
      await check("file symlink pointing outside root is rejected on read", () =>
        assert.rejects(assertAllowedRealPath(path.join(root, "link-file.txt")), /escapes the configured/));
    }
    if (dirSymlinkOk) {
      await check("directory symlink pointing outside root is rejected on read", () =>
        assert.rejects(assertAllowedRealPath(path.join(root, "link-dir", "secret.txt")), /escapes the configured/));
      await check("atomicWrite through a symlinked dir is rejected", () =>
        assert.rejects(atomicWrite(path.join(root, "link-dir", "out.txt"), "x"), /escapes the configured/));
    }
    await check("non-existent path under an existing root resolves through the real ancestor", async () =>
      assert.equal(await assertAllowedRealPath(path.join(root, "new-dir", "new-file")), path.resolve(root, "new-dir", "new-file")));
    await check("direct read of the real secret file outside root is rejected", () =>
      assert.rejects(assertAllowedRealPath(secretFile), /outside the configured/));
    setRoot(null);
  }

  console.log("3. sniffImageMime magic-byte checks");
  {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await check("PNG magic -> image/png", () => assert.equal(sniffImageMime(png, ".png"), "image/png"));
    await check("JPEG magic -> image/jpeg", () => assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ".jpg"), "image/jpeg"));
    await check("GIF magic -> image/gif", () => assert.equal(sniffImageMime(Buffer.from("GIF89a...."), ".gif"), "image/gif"));
    await check("WebP magic -> image/webp", () => assert.equal(sniffImageMime(Buffer.from("RIFF....WEBP...."), ".webp"), "image/webp"));
    await check("SVG root element -> image/svg+xml", () => assert.equal(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), ".svg"), "image/svg+xml"));
    await check("BOM + xml declaration + svg -> image/svg+xml", () => {
      const head = Buffer.from('\uFEFF<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
      assert.equal(sniffImageMime(head, ".svg"), "image/svg+xml");
    });
    await check("truncated PNG (3 bytes) -> null", () => assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e]), ".png"), null));
    await check("plain text renamed .png -> null", () => assert.equal(sniffImageMime(Buffer.from("hello world, not an image"), ".png"), null));
    await check("HTML document renamed .svg -> null", () => {
      assert.equal(sniffImageMime(Buffer.from('<!doctype html><html><body><svg>…</svg></body></html>'), ".svg"), null);
    });
    await check("script-only content renamed .svg -> null", () => {
      assert.equal(sniffImageMime(Buffer.from('<script>document.write("<svg></svg>")</script>'), ".svg"), null);
    });
    await check("SVG bytes behind a .png extension -> null (caller rejects the mismatch)", () => {
      assert.equal(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), ".png"), null);
    });
  }

  console.log("4. atomicWrite");
  {
    const root = path.join(tempRoot, "atomic-root");
    await fs.mkdir(root, { recursive: true });
    setRoot(root);
    const target = path.join(root, "deep", "nested", "out.txt");
    await atomicWrite(target, "hello");
    await check("writes content and creates parent directories", async () => assert.equal(await fs.readFile(target, "utf8"), "hello"));
    await check("overwrites an existing file", async () => {
      await atomicWrite(target, "hello again");
      assert.equal(await fs.readFile(target, "utf8"), "hello again");
    });
    await check("leaves no stray temp files behind", async () => {
      const leftovers = (await fs.readdir(path.join(root, "deep", "nested"))).filter((f) => f.includes(".tmp"));
      assert.deepEqual(leftovers, []);
    });
    await check("write outside the root is rejected", () =>
      assert.rejects(atomicWrite(path.join(tempRoot, "outside-write.txt"), "x"), /outside the configured/));
    setRoot(null);
  }

  console.log("5. MAX_IMAGE_BYTES guard");
  {
    await check("default limit is 64 MiB", () => assert.equal(MAX_IMAGE_BYTES, 64 * 1024 * 1024));
    const script = "const m = await import('./plugins/scientific-illustrator/scripts/guardrails.mjs'); console.log(m.MAX_IMAGE_BYTES);";
    const override = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repoRoot,
      env: { ...process.env, SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES: "4096" },
    });
    await check("env override is respected", () => assert.equal(Number(override.stdout.trim()), 4096));
    const bad = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repoRoot,
      env: { ...process.env, SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES: "not-a-number" },
    }).catch((error) => error);
    await check("malformed limit fails closed at import", () => {
      assert.ok(bad);
      assert.match(String(bad.stderr), /SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES/);
    });
  }

  console.log("6. PowerPoint sequence-operation schema validation");
  {
    await check("valid add_textbox passes", () => {
      assert.equal(validateSequenceOperation({ type: "add_textbox", slide_index: 1, text: "x", left: 0, top: 0, width: 10, height: 10 }, 0), null);
    });
    await check("wait with no fields passes", () => {
      assert.equal(validateSequenceOperation({ type: "wait" }, 0), null);
    });
    await check("missing required field is rejected with the field names", () => {
      const error = validateSequenceOperation({ type: "add_textbox", slide_index: 1 }, 3);
      assert.ok(error instanceof Error);
      assert.match(error.message, /at index 3/);
      assert.match(error.message, /missing required field/);
      assert.match(error.message, /text/);
    });
    await check("null required field counts as missing", () => {
      const error = validateSequenceOperation({ type: "add_slide", slide_index: null }, 1);
      assert.ok(error instanceof Error);
      assert.match(error.message, /slide_index/);
    });
    await check("anyOf group satisfied by shape_name passes", () => {
      assert.equal(validateSequenceOperation({ type: "update_shape", slide_index: 1, shape_name: "box" }, 0), null);
    });
    await check("anyOf group satisfied by shape_id passes", () => {
      assert.equal(validateSequenceOperation({ type: "update_shape", slide_index: 1, shape_id: 5 }, 0), null);
    });
    await check("neither anyOf alternative present is rejected", () => {
      const error = validateSequenceOperation({ type: "update_shape", slide_index: 1 }, 2);
      assert.ok(error instanceof Error);
      assert.match(error.message, /requires one of/);
    });
    await check("unknown operation type is left to dispatch-time validation", () => {
      assert.equal(validateSequenceOperation({ type: "no_such_op", anything: 1 }, 0), null);
    });
    await check("missing type is left to dispatch-time validation", () => {
      assert.equal(validateSequenceOperation({ slide_index: 1 }, 0), null);
    });
  }

  console.log("7. sanitizePathArgs allowed-root enforcement");
  {
    const root = path.join(tempRoot, "sanitize-root");
    const outside = path.join(tempRoot, "sanitize-outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    setRoot(root);
    const cleaned = await sanitizePathArgs({ image_path: path.join(root, "img.png"), output_path: path.join(outside, "x.png"), untouched: 42 }).catch((error) => error);
    await check("out-of-root path is rejected during sanitization", () => {
      assert.ok(cleaned instanceof Error);
      assert.match(cleaned.message, /outside the configured/);
    });
    const ok = await sanitizePathArgs({ image_path: path.join(root, "img.png"), untouched: 42 });
    await check("in-root path is kept and non-path keys are preserved", () => {
      assert.equal(ok.image_path, path.join(root, "img.png"));
      assert.equal(ok.untouched, 42);
    });
    setRoot(null);
  }

  console.log("8. Office.js page-token asset auth edge cases");
  let bridge = null;
  {
    const openssl = findOpenssl();
    if (!openssl) {
      console.log("  (openssl unavailable; skipping HTTPS bridge checks)");
    } else {
      const certPath = path.join(tempRoot, "bridge.crt");
      const keyPath = path.join(tempRoot, "bridge.key");
      await execFileAsync(openssl, [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
        "-keyout", keyPath, "-out", certPath, "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ], { maxBuffer: 4 * 1024 * 1024 });
      bridge = new OfficeJsCommandBridge({
        host: "127.0.0.1", port: 0,
        certPath, keyPath,
        commandTimeoutMs: 1000, longPollMs: 500, clientTtlMs: 3000,
      });
      const started = await bridge.start();
      try {
        await check("asset without token is rejected", async () => {
          assert.equal(await requestAssetStatus(started.port, "/taskpane.html"), 401);
          assert.equal(await requestAssetStatus(started.port, "/taskpane.css"), 401);
          assert.equal(await requestAssetStatus(started.port, "/assets/icon-32.png"), 401);
        });
        await check("wrong token is rejected", async () => {
          assert.equal(await requestAssetStatus(started.port, "/taskpane.html", { token: "wrong-token" }), 401);
        });
        await check("correct query token is accepted", async () => {
          assert.equal(await requestAssetStatus(started.port, "/taskpane.html", { token: bridge.pageToken }), 200);
        });
        await check("correct Bearer header token is accepted", async () => {
          assert.equal(await requestAssetStatus(started.port, "/taskpane.html", { bearer: bridge.pageToken }), 200);
        });
        await check("path traversal in the asset route cannot escape the asset directory", async () => {
          const status = await requestAssetStatus(started.port, "/..%2f..%2fpackage.json", { token: bridge.pageToken });
          assert.ok(status === 403 || status === 404, `expected 403/404, got ${status}`);
        });
      } finally {
        // bridge stays open for the HTTP fuzz section; closed in the outer finally
      }
    }
  }

  console.log("9. HTTP fuzz probe against the bridge");
  if (bridge) {
    const started = { port: bridge.port };
    const validToken = bridge.pageToken;
    try {
      await check("health endpoint does not leak the page token", async () => {
        const health = await rawRequest(started.port, { path: "/health" });
        assert.equal(health.status, 200);
        assert.ok(!health.body.includes(validToken), "health body must not contain the page token");
        assert.ok(!health.body.includes("session"), "health body must not expose session state");
      });
      await check("non-GET methods on assets are rejected with 405", async () => {
        for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
          const response = await rawRequest(started.port, { path: "/taskpane.html", method, headers: { Authorization: `Bearer ${validToken}` } });
          assert.equal(response.status, 405, `${method} should be 405`);
        }
      });
      await check("raw token without Bearer prefix is rejected", async () => {
        const response = await rawRequest(started.port, { path: "/taskpane.html", headers: { Authorization: validToken } });
        assert.equal(response.status, 401);
      });
      await check("wrong query token wins over a correct header token (never authenticate on mixed input)", async () => {
        const response = await rawRequest(started.port, { path: `/taskpane.html?token=wrong`, headers: { Authorization: `Bearer ${validToken}` } });
        assert.equal(response.status, 401);
      });
      await check("token with trailing newline/whitespace is rejected", async () => {
        assert.equal(await requestAssetStatus(started.port, "/taskpane.html", { token: `${validToken}\n` }), 401);
        assert.equal(await requestAssetStatus(started.port, "/taskpane.html", { token: ` ${validToken}` }), 401);
      });
      await check("oversized token value is rejected without crashing the server", async () => {
        const huge = "a".repeat(32_000);
        let blocked = false;
        try {
          const status = await requestAssetStatus(started.port, "/taskpane.html", { token: huge });
          assert.ok(status === 401 || status === 431, `expected 401/431, got ${status}`);
          blocked = true;
        } catch (error) {
          blocked = /ECONNRESET|ECONNREFUSED|socket hang up/i.test(String(error.message));
        }
        assert.ok(blocked, "oversized token must be blocked (clean response or connection reset)");
      });
      const traversalPaths = [
        "/..%2f..%2fpackage.json",
        "/..%2f..%2f..%2fWindows%2fwin.ini",
        "/%2e%2e/%2e%2e/package.json",
        "/..\\..\\package.json",
        "/assets/..%2f..%2f..%2f..%2fpackage.json",
        "/taskpane.html/../../package.json",
      ];
      await check("path traversal variants never expose files outside the asset directory", async () => {
        for (const route of traversalPaths) {
          const response = await rawRequest(started.port, { path: `${route}?token=${encodeURIComponent(validToken)}` });
          assert.ok(response.status === 403 || response.status === 404, `route ${route} -> ${response.status}`);
          assert.ok(!response.body.includes('"name": "scientific-illustrator-marketplace"'), `route ${route} leaked package.json`);
        }
      });
      await check("API routes reject the page token (session token required)", async () => {
        const response = await rawRequest(started.port, {
          path: "/api/nonexistent", method: "POST",
          headers: { Authorization: `Bearer ${validToken}` },
        });
        assert.equal(response.status, 401);
      });
      await check("unknown API routes with the session token are 404, not leaked", async () => {
        const response = await rawRequest(started.port, {
          path: "/api/nonexistent", method: "POST",
          headers: { Authorization: `Bearer ${bridge.sessionToken}` },
        });
        assert.equal(response.status, 404);
      });
      await check("security headers are present on asset responses", async () => {
        const response = await rawRequest(started.port, { path: "/taskpane.html?token=" + encodeURIComponent(validToken) });
        assert.equal(response.status, 200);
        assert.match(response.headers["x-content-type-options"] || "", /nosniff/);
        assert.ok(response.headers["referrer-policy"], "missing Referrer-Policy");
        assert.ok(response.headers["content-security-policy"], "missing Content-Security-Policy");
        assert.match(response.headers["cache-control"] || "", /no-store/);
      });
      await check("server still serves valid requests after the fuzz traffic", async () => {
        assert.equal(await requestAssetStatus(started.port, "/taskpane.html", { token: validToken }), 200);
      });
    } finally {
      await bridge.close();
      bridge = null;
    }
  } else {
    console.log("  (bridge unavailable; skipping HTTP fuzz)");
  }
} finally {
  if (OLD_ROOT === undefined) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = OLD_ROOT;
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

if (failures > 0) {
  console.error(`\nguardrails-security-smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nguardrails-security-smoke: all permission/security edge cases passed.");
process.exit(0);