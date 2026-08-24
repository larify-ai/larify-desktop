import { pathToFileURL } from "node:url";

const CNB_REPOSITORY = "larify-ai/larify-desktop";
const CNB_API_URL = `https://api.cnb.cool/${CNB_REPOSITORY}/-/build/start`;
const CNB_RELEASE_URL = `https://cnb.cool/${CNB_REPOSITORY}/-/releases`;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const request = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });

export function validateReleaseTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
}

export function releaseAssets(tag) {
  const version = tag.replace(/^v/, "");
  const channel = version.includes("-")
    ? version.split("-", 2)[1].split(".", 1)[0]
    : "latest";
  return [
    `larify-${version}-setup.exe`,
    `larify-${version}-setup.exe.blockmap`,
    `${channel}.yml`,
  ];
}

const manifestHasVersion = (manifest, version) =>
  new RegExp(`^version:\\s*${version.replace(/\./g, "\\.")}\\s*$`, "m").test(
    manifest,
  );

export async function releaseIsComplete(tag, send = request) {
  const version = tag.replace(/^v/, "");
  const baseUrl = `${CNB_RELEASE_URL}/download/${encodeURIComponent(tag)}`;

  try {
    const assets = releaseAssets(tag);
    for (const asset of assets) {
      const response = await send(`${baseUrl}/${asset}`, {
        method: "HEAD",
        redirect: "follow",
      });
      if (!response.ok) return false;
    }

    const manifest = await send(`${baseUrl}/${assets.at(-1)}`, {
      redirect: "follow",
    });
    if (!manifest.ok) return false;
    return manifestHasVersion(await manifest.text(), version);
  } catch {
    return false;
  }
}

export async function triggerReleaseSync(tag, token, send = request) {
  const response = await send(CNB_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: "api_trigger_release_sync",
      env: { RELEASE_TAG: tag },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `CNB release sync trigger failed with HTTP ${response.status}`,
    );
  }
}

export async function syncCnbRelease({
  tag,
  token,
  request: send = request,
  wait = delay,
  attempts = 40,
  intervalMs = 15_000,
}) {
  validateReleaseTag(tag);
  if (await releaseIsComplete(tag, send)) return "already-complete";

  await triggerReleaseSync(tag, token, send);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await releaseIsComplete(tag, send)) return "published";
    if (attempt < attempts) await wait(intervalMs);
  }

  throw new Error(`CNB release ${tag} is incomplete after ${attempts} checks`);
}

async function main() {
  const tag = process.env.RELEASE_TAG;
  const token = process.env.CNB_TOKEN;
  if (!tag) throw new Error("RELEASE_TAG is not configured");
  if (!token) throw new Error("CNB_TOKEN is not configured");

  console.log(`::add-mask::${token}`);
  const result = await syncCnbRelease({ tag, token });
  console.log(`CNB release ${tag}: ${result}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
