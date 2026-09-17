# Larify 桌面端发版流程（SOP）

> 更新于 2026-09-17（v0.0.17 实测后校准：发布已改为显式 gh 上传、`rerun` 对策失效、实测耗时约 14 分钟）

## 一、架构速览（先理解再发版）

```
InfAGI/larify-desktop（源码开发库 ← 日常提交/推代码/tag 的地方）
        │  push tag v*.*.*
        ▼
GitHub Actions（release-windows.yml，Windows runner）
        ├─ 校验 tag == apps/larify/package.json version（不一致直接失败）
        ├─ npm ci → release:win（typecheck → electron-vite build → electron-builder --win --publish never）
        │    └─ electron-builder **只产出 dist/ 三件套，不碰远端**
        ├─ 在 larify-ai 上补 tag（Ensure public release tag 步骤）
        ├─ 用 gh 显式上传资产到 larify-ai/larify-desktop 的 GitHub Releases
        │    （publish-release.mjs：resolve → create → upload --clobber → verify，缺失即抛错）
        └─ 触发 CNB 同步（sync-cnb-release.mjs，token 用 CNB_TOKEN）
                │
                ▼
CNB 平台（cnb.cool/larify-ai/larify-desktop）
        ├─ 流水线从 GitHub Releases 下载 3 个资产：setup.exe / blockmap / latest.yml
        └─ 上传为 CNB release（供国内直连分发）
                │
                ▼
用户端自动更新（electron-updater）
        读 https://cnb.cool/larify-ai/larify-desktop/-/releases/latest/download/latest.yml
        → 发现新版本 → 下载安装
```

**关键事实**：
- 源码仓库 = **InfAGI**（开发），发布出口 = **larify-ai**（GitHub Releases + CNB 都指向它）
- 用户端自动更新源 = **CNB**（国内 CDN，asset.cnb.cool），不是 GitHub
- CNB 的 latest 指针 **不自动切换**，需要发版后手动设置（见步骤 6）

## 二、前置条件（一次性确认）

| 项 | 位置 | 说明 |
|---|---|---|
| `RELEASE_TOKEN` | InfAGI 仓库 Secrets | GitHub 发布用（`gh release upload` 到 larify-ai） |
| `CNB_TOKEN` | InfAGI 仓库 Secrets | CNB 同步触发用 |
| 仓库 push 权限 | InfAGI | 推 master 和 tag |

> 发布出口 `owner/repo` 在 `apps/larify/electron-builder.yml` 的 `publish` 段（`larify-ai/larify-desktop`），但**仅作为元数据**——实际上传由 `publish-release.mjs` 用 `gh` 完成。

## 三、发版步骤（每次发版照此执行）

### 1. bump 版本

编辑 `apps/larify/package.json`：

```json
"version": "0.0.8"
```

### 2. 提交并推送代码

```bash
git add apps/larify/package.json
git commit -m "chore: bump version to 0.0.8"
git push origin master
```

### 3. 打 tag 并推送（触发 CI）

```bash
git tag -a v0.0.8 -m "Release v0.0.8"   # 必须与 package.json version 完全一致（v 前缀）
git push origin v0.0.8
```

### 4. 监控 CI

```bash
gh run list --repo InfAGI/larify-desktop --workflow release-windows.yml --limit 1
gh run watch <run-id> --repo InfAGI/larify-desktop --exit-status --interval 45
```

**实测约 14 分钟**（v0.0.16 13m57s、v0.0.17 13m40s；早先「约 11 分钟」的估计偏乐观）。分步耗时参考：

| 步骤 | 耗时 |
|---|---|
| `Verify release version` | 1s |
| `Install dependencies`（`npm ci`） | ~1m53s |
| `Build Windows release` | ~8m24s |
| `Publish to GitHub Releases` | ~14s |
| `Trigger CNB release sync` | ~1m11s |

注意：CI 有多个独立失败点，任一步红都不会产出 release。**typecheck 失败**（在 `Build` 内）是最常见的一种，且不会创建任何资产——详见踩坑 #4。

### 5. 校验 GitHub 资产完整性

```bash
gh api "repos/larify-ai/larify-desktop/releases/tags/vX.Y.Z" \
  --jq '.assets[] | "\(.name) \(.size) \(.state)"'
```

**必须同时看到 3 个资产且 `state=uploaded`**：
- `larify-X.Y.Z-setup.exe`（约 280~300 MB）
- `larify-X.Y.Z-setup.exe.blockmap`
- `latest.yml`（内容 `version: X.Y.Z`）

> CI 的 `Publish to GitHub Releases` 步骤本身就会校验三资产齐全并在缺失时**直接抛错**，所以「CI 绿 = 资产齐全」的置信度已很高。此处复核是为了防止「脚本被改坏」「CI 绿但资产被后续动作覆盖」等边界情况，成本极低，仍然保留。

### 6. CNB 设置 latest（关键一步，容易忘！）

登录 **cnb.cool** → `larify-ai/larify-desktop` → **Releases** 列表：

1. 确认 v0.0.8 出现在列表、资产完整
2. 点 v0.0.8 的**编辑** → 勾选 **「设置为最新」** → **更新**
3. 确认 v0.0.8 卡片出现绿色「最新版」徽标

> CNB 的 latest 指针不会因为出现新版本自动切换，必须手动标记。漏掉这步 = 用户端永远收不到更新。

### 7. 最终验证

```bash
# 用户端自动更新读的就是这个，version 必须是最新版
curl -sL "https://cnb.cool/larify-ai/larify-desktop/-/releases/latest/download/latest.yml"
# → version: 0.0.8
```

验证通过 = 用户打开应用（旧版本）会自动检测并更新。

**加固判据（推荐一并做）**：把上面 `latest.yml` 的 `sha512` / `size` 与 `releases/download/vX.Y.Z/latest.yml` 的对应值比对——**一致即证明 latest 指向的就是那一份已发布文件**，排除「latest 指向了另一个构建产物」的隐忧：

```bash
curl -sL "https://cnb.cool/larify-ai/larify-desktop/-/releases/download/vX.Y.Z/latest.yml" | grep -E 'sha512|size'
```

## 四、回滚

- **发布错了版本**：在 CNB 把上一个版本设为 latest（步骤 6 反向操作）
- **代码有问题**：修复后 bump 到下一个版本重新发（版本号只增不减）
- **删除 release**：GitHub 侧 `gh release delete larify-ai/larify-desktop vX.Y.Z`（保留 tag）；CNB 侧在 Releases 列表删除

## 五、踩坑记录

### 坑 #1：electron-builder 异步发布丢资产 —— **已结构性消除（2026-09-17 校准）**

- **历史现象**（2026-09-01 / v0.0.7 时期）：CI Build 步骤 ✓，但 GitHub release 只有 `blockmap`（304KB），`setup.exe`（300MB）和 `latest.yml` 缺失；CNB 流水线下载 setup.exe 时 404
- **当时原因**：electron-builder 直接发布是异步的，大文件上传未 await 完成进程就退出，退出码却是 0
- **现状**：发布路径已重构，**该坑不可能再复现**——
  - `release:win` = `... electron-builder --win --publish never`，构建产物只落在 `dist/`，不触碰远端；
  - 发布改由 `publish-release.mjs` 用 `gh` 同步完成：`resolve`（缺文件即抛 `Missing artifact`）→ `ensureRelease` → `upload --clobber` → `verifyAssets`（三资产名任一缺失即抛 `Missing assets on GitHub release`）。
  - v0.0.16、v0.0.17 连续两次实测均在 ~14s 内三资产齐全。
- ⚠️ **旧对策已失效**：不要再照搬「缺失就 `gh run rerun --failed`」——`rerun` 会**重新构建整个流程**而非重发布，且若失败根因是源码问题（如 typecheck 报错）重跑多少次都不会好。若确需补发，应单独重跑 publish 步骤，或本地 `gh release upload <tag> <files> --repo larify-ai/larify-desktop --clobber`。

### 坑 #2：CNB latest 指针不自动

- **现象**：CNB 资产同步成功（`download/v0.0.7/latest.yml` 可访问），但 `download/latest/` 一直返回旧版本
- **原因**：CI 自动创建的 release 不参与 latest 竞选，需要手动勾「设置为最新」
- **对策**：步骤 6 不可省略

### 坑 #3：larify-ai 仓库是空壳（不是 bug，是架构）

- `larify-ai/larify-desktop` 只有初始化提交、没有代码——**不要**往它推代码
- 它只承载 GitHub Releases 资产 + 被 CNB 引用；代码永远在 InfAGI

### 坑 #4：CI 在 `typecheck` 阶段挂掉 —— 最常见的发版失败（2026-09-17 补）

- **现象**：run 在约 2~3 分钟就红（而非正常的 14 分钟），错误形如
  `src/renderer/src/components/ai-elements/message.tsx(335,3): error TS2353: ... 'resetView' does not exist in type 'StreamdownTranslations'`
- **后果**：`Build Windows release` 未完成 → **不产出任何资产、不创建 GitHub/CNB release、不推送任何 tag 到 larify-ai**。线上完全无痕，`rerun` 也没用。
- **根因**：第三方 UI 库（`streamdown`）的**翻译键类型契约**变了，而源码用 `satisfies StreamdownTranslations` 穷举约束一张中文翻译表——库增键（我缺键）或删/改键（我多键）都会编译报错。属于「双向脆弱」。
- **排查判据**：判断"CI 会装到哪个版本"**必须看根 `package-lock.json`**（CI 用 `npm ci` 严格按 lockfile 还原），**不要**看 `node_modules`（可能被手工改过），更**不要**看 commit message（本问题历史上出现过 `Reapply`/`Revert` 反复横跳，描述与最终状态可能相反）。
- **对策**：修好源码使其与锁定版本的库自洽，然后 **bump 到下一个版本重新发**（版本号只增不减；失败的版本没有 release 可修）。发版前若动过 `node_modules`，请先本地 `npm ci && npm run typecheck` 再推 tag——本地的"绿"不等于 CI 的"绿"。

## 六、本地手动发版（替代 CI，不推荐）

```bash
cd apps/larify
npm run release:win   # = typecheck + electron-vite build + electron-builder --win --publish never
```

注意 `release:win` 现已带 `--publish never`，**只产出 `dist/`，不会自动发布**。本地要真正发出去，还需自行：

```bash
gh release upload vX.Y.Z apps/larify/dist/larify-X.Y.Z-setup.exe \
  apps/larify/dist/larify-X.Y.Z-setup.exe.blockmap apps/larify/dist/latest.yml \
  --repo larify-ai/larify-desktop --clobber
```

需要环境变量 `GH_TOKEN`（发布 GitHub）、`CNB_TOKEN`（同步 CNB）。本地构建 300MB 产物耗时且依赖网络，**优先走 CI**。

### 发版前的最低成本自检

推 tag 前先本地跑一遍构建第一步，避免白等 14 分钟：

```bash
npm ci --workspace apps/larify
npm run typecheck --workspace apps/larify
```

## 七、版本号语义（2026-09-17 补）

- 版本**唯一真源** = `apps/larify/package.json` 的 `version`；CI 首步强校验 `v$version == tag`，不一致直接失败。
- **判断"线上到底有哪些版本"必须以 `larify-ai/larify-desktop` 的 Releases 为准**，不能看本地 tag 或 git log：
  - 仓库里存在 `v0.0.15` 的 tag 与 CI run，但那次 CI 失败，线上**没有** 0.0.15 release；
  - 历史 commit 中还出现过 `chore: bump v0.0.21` 空提交、`git tag v0.0.22` 等痕迹，**这些版本从未被构建发布过**。
- 版本号只增不减；发布错了就 bump 到下一个版本重发。

## 八、下载入口（官网）

- 官网（larify.ai）目前**没有下载按钮**——规划中：`/api/download` 动态重定向到 CNB latest 安装包（发版零改动，见 larify-website 仓库）
- 临时入口：
  - CNB 发布页：`https://cnb.cool/larify-ai/larify-desktop/-/releases`
  - GitHub Releases：`https://github.com/larify-ai/larify-desktop/releases/latest`
