import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  publishRelease,
  resolveFiles,
  ensureRelease,
  uploadAssets,
  verifyAssets,
} from "./publish-release.mjs";

const file = (dir, name) => {
  const path = join(dir, name);
  writeFileSync(path, name);
  return path;
};

test("resolves the expected artifact files from a dist dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  file(dir, "larify-0.0.7-setup.exe");
  file(dir, "larify-0.0.7-setup.exe.blockmap");
  file(dir, "latest.yml");
  assert.deepEqual(resolveFiles(dir, "v0.0.7"), [
    join(dir, "larify-0.0.7-setup.exe"),
    join(dir, "larify-0.0.7-setup.exe.blockmap"),
    join(dir, "latest.yml"),
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("throws when an expected artifact is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  file(dir, "latest.yml");
  assert.throws(() => resolveFiles(dir, "v0.0.7"), /Missing artifact/);
  rmSync(dir, { recursive: true, force: true });
});

test("does not create a release when it already exists", () => {
  const calls = [];
  const runCmd = (cmd, args) => {
    calls.push({ cmd, args });
    return "v0.0.7";
  };
  const existed = ensureRelease("v0.0.7", runCmd);
  assert.equal(existed, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args.join(" "), /release view/);
});

test("creates a release when it does not exist", () => {
  const calls = [];
  const runCmd = (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "gh" && args.includes("view")) {
      throw new Error("not found");
    }
    return "";
  };
  const existed = ensureRelease("v0.0.7", runCmd);
  assert.equal(existed, false);
  const create = calls.find((c) => c.args.includes("create"));
  assert.ok(create, "should call gh release create");
  assert.match(create.args.join(" "), /v0.0.7/);
  assert.match(create.args.join(" "), /--prerelease=false/);
});

test("uploads all files with clobber", () => {
  let call;
  uploadAssets(
    "v0.0.7",
    ["a.exe", "a.exe.blockmap", "latest.yml"],
    (cmd, args) => {
      call = { cmd, args };
    },
  );
  assert.equal(call.cmd, "gh");
  assert.match(call.args.join(" "), /release upload v0.0.7/);
  assert.ok(call.args.includes("--clobber"));
  assert.ok(call.args.includes("a.exe.blockmap"));
});

test("passes when all expected assets are present", () => {
  const runCmd = () => "larify-0.0.7-setup.exe\nlarify-0.0.7-setup.exe.blockmap\nlatest.yml";
  assert.ok(verifyAssets("v0.0.7", runCmd));
});

test("throws when an expected asset is missing", () => {
  const runCmd = () => "larify-0.0.7-setup.exe\nlatest.yml";
  assert.throws(() => verifyAssets("v0.0.7", runCmd), /Missing assets/);
});

test("publishRelease resolves, ensures, uploads, verifies", () => {
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  file(dir, "larify-0.0.7-setup.exe");
  file(dir, "larify-0.0.7-setup.exe.blockmap");
  file(dir, "latest.yml");
  const calls = [];
  const runCmd = (cmd, args) => {
    calls.push(args.join(" "));
    if (/release view/.test(args.join(" "))) return "v0.0.7";
    if (/releases\/tags/.test(args.join(" ")))
      return "larify-0.0.7-setup.exe\nlarify-0.0.7-setup.exe.blockmap\nlatest.yml";
    return "";
  };
  const existing = publishRelease({ tag: "v0.0.7", dir, runCmd });
  assert.deepEqual(existing, [
    "larify-0.0.7-setup.exe",
    "larify-0.0.7-setup.exe.blockmap",
    "latest.yml",
  ]);
  assert.ok(calls.some((c) => /release upload/.test(c)));
  rmSync(dir, { recursive: true, force: true });
});
