import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseAssets } from "./sync-cnb-release.mjs";

const PUBLISH_OWNER = "larify-ai";
const PUBLISH_REPO = "larify-desktop";

const run = (command, args, env = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...env },
  });

/** Resolve the expected artifact files for a tag inside a build dir. */
export function resolveFiles(dir, tag) {
  return releaseAssets(tag).map((name) => {
    const path = join(dir, name);
    if (!existsSync(path)) {
      throw new Error(`Missing artifact: ${name} (expected at ${path})`);
    }
    return path;
  });
}

/** Ensure a (possibly empty) release exists for the tag. Returns true if it already existed. */
export function ensureRelease(tag, runCmd = run) {
  let found = true;
  try {
    runCmd("gh", ["release", "view", tag, "--repo", `${PUBLISH_OWNER}/${PUBLISH_REPO}`, "--json", "tagName"]);
  } catch {
    found = false;
    runCmd("gh", [
      "release",
      "create",
      tag,
      "--repo",
      `${PUBLISH_OWNER}/${PUBLISH_REPO}`,
      "--title",
      `Release ${tag}`,
      "--prerelease=false",
    ]);
  }
  return found;
}

/** Upload the artifact files to the release. Throws on gh failure (does not silently drop). */
export function uploadAssets(tag, files, runCmd = run) {
  runCmd("gh", [
    "release",
    "upload",
    tag,
    ...files,
    "--repo",
    `${PUBLISH_OWNER}/${PUBLISH_REPO}`,
    "--clobber",
  ]);
}

/** Verify all expected asset names are present on the GitHub release. */
export function verifyAssets(tag, runCmd = run) {
  const expected = releaseAssets(tag);
  const existing = runCmd("gh", [
    "api",
    `repos/${PUBLISH_OWNER}/${PUBLISH_REPO}/releases/tags/${tag}`,
    "--jq",
    ".assets[].name",
  ])
    .split("\n")
    .filter(Boolean);
  const missing = expected.filter((name) => !existing.includes(name));
  if (missing.length) {
    throw new Error(`Missing assets on GitHub release: ${missing.join(", ")}`);
  }
  return existing;
}

/** Full publish flow: resolve -> ensure release -> upload -> verify. */
export function publishRelease({ tag, dir, runCmd = run }) {
  const files = resolveFiles(dir, tag);
  ensureRelease(tag, runCmd);
  uploadAssets(tag, files, runCmd);
  return verifyAssets(tag, runCmd);
}

async function main() {
  const tag = process.env.RELEASE_TAG;
  const dir = process.env.DIST_DIR;
  const token = process.env.GH_TOKEN || process.env.RELEASE_TOKEN;
  if (!tag) throw new Error("RELEASE_TAG is not configured");
  if (!dir) throw new Error("DIST_DIR is not configured");
  if (!token) throw new Error("GH_TOKEN/RELEASE_TOKEN is not configured");

  const env = { GH_TOKEN: token };
  const names = publishRelease({ tag, dir, runCmd: (c, a) => run(c, a, env) });
  console.log(`Published ${tag} → ${names.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
