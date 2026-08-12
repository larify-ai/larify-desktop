# Manual acceptance tests

Start Larify with CDP enabled:

```powershell
npm run dev:debug
```

Run one prompt in a fresh task and print the persisted conversation:

```powershell
node tests/manual/run-prompt.cdp.mjs tests/manual/browser-interactions-smoke-prompt.md
```

Browser prompt order and coverage are listed in `browser-tools-prompts.md`. Run each prompt in a
fresh task. The prompts intentionally create their fixtures and output files under the active
workspace's `browser-smoke/` directory so the products can be inspected after the run.

Run the browser session isolation check only when at least two tasks are visible in the sidebar:

```powershell
node tests/manual/browser-session-isolation.cdp.mjs
```

`cdp-client.mjs` is the shared connection helper for manual scripts. Automated Electron-level
browser regressions live under `tests/extensions/browser/live` and run with:

```powershell
npm run test:browser-live
```
