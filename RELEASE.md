# Larify 桌面端发版流程（SOP）

> 更新于 2026-09-01（v0.0.7 实测全链路跑通后沉淀）

## 一、架构速览（先理解再发版）

```
InfAGI/larify-desktop（源码开发库 ← 日常提交/推代码/tag 的地方）
        │  push tag v*.*.*
        ▼
GitHub Actions（release-windows.yml，Windows runner）
        ├─ 校验 tag == apps/larify/package.json version（不一致直接失败）
        ├─ npm ci → release:win（typecheck → electron-vite build → electron-builder --win）
        ├─ electron-builder 发布资产到 larify-ai/larify-desktop 的 GitHub Releases
        │    （owner/repo 在 electron-builder.yml 的 publish 段，token 用 RELEASE_TOKEN）
        ├─ 在 larify-ai 上补 tag（Ensure public release tag 步骤）
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
| `RELEASE_TOKEN` | InfAGI 仓库 Secrets | GitHub 发布用（electron-builder publish 到 larify-ai） |
| `CNB_TOKEN` | InfAGI 仓库 Secrets | CNB 同步触发用 |
| 仓库 push 权限 | InfAGI | 推 master 和 tag |

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
gh run list --repo InfAGI/larify-desktop --limit 1
gh run watch <run-id> --repo InfAGI/larify-desktop --exit-status --interval 45
```

约 11 分钟。**注意：Build 步骤显示 ✓ 不代表发布成功**（见踩坑 #1），务必核对步骤 5。

### 5. 校验 GitHub 资产完整性（防 electron-builder 丢资产）

```bash
curl -s "https://api.github.com/repos/larify-ai/larify-desktop/releases/tags/v0.0.8" \
  | grep -E '"name"|"size"'
```

**必须同时看到 3 个资产**：
- `larify-0.0.8-setup.exe`（约 280~300 MB）
- `larify-0.0.8-setup.exe.blockmap`
- `latest.yml`

**如果只有 blockmap**：说明 electron-builder 异步发布又丢了大文件 → `gh run rerun <run-id> --repo InfAGI/larify-desktop --failed` 重跑（通常第二次就完整）。

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

## 四、回滚

- **发布错了版本**：在 CNB 把上一个版本设为 latest（步骤 6 反向操作）
- **代码有问题**：修复后 bump 到下一个版本重新发（版本号只增不减）
- **删除 release**：GitHub 侧 `gh release delete larify-ai/larify-desktop vX.Y.Z`（保留 tag）；CNB 侧在 Releases 列表删除

## 五、踩坑记录（2026-09-01 v0.0.7 实测）

### 坑 #1：electron-builder 异步发布丢资产（已踩两次）

- **现象**：CI Build 步骤 ✓，但 GitHub release 只有 `blockmap`（304KB），`setup.exe`（300MB）和 `latest.yml` 缺失；CNB 流水线下载 setup.exe 时 404
- **原因**：electron-builder 发布是异步的，大文件上传未 await 完成进程就退出，退出码却是 0
- **对策**：发版后**必须核对资产完整性**（步骤 5），缺失就 `gh run rerun --failed`

### 坑 #2：CNB latest 指针不自动

- **现象**：CNB 资产同步成功（`download/v0.0.7/latest.yml` 可访问），但 `download/latest/` 一直返回旧版本
- **原因**：CI 自动创建的 release 不参与 latest 竞选，需要手动勾「设置为最新」
- **对策**：步骤 6 不可省略

### 坑 #3：larify-ai 仓库是空壳（不是 bug，是架构）

- `larify-ai/larify-desktop` 只有初始化提交、没有代码——**不要**往它推代码
- 它只承载 GitHub Releases 资产 + 被 CNB 引用；代码永远在 InfAGI

## 六、本地手动发版（替代 CI，不推荐）

```bash
cd apps/larify
npm run release:win   # = build + electron-builder --win --publish always
```

需要环境变量 `GH_TOKEN`（发布 GitHub）、`CNB_TOKEN`（同步 CNB）。本地构建 300MB 产物耗时且依赖网络，**优先走 CI**。

## 七、下载入口（官网）

- 官网（larify.ai）目前**没有下载按钮**——规划中：`/api/download` 动态重定向到 CNB latest 安装包（发版零改动，见 larify-website 仓库）
- 临时入口：
  - CNB 发布页：`https://cnb.cool/larify-ai/larify-desktop/-/releases`
  - GitHub Releases：`https://github.com/larify-ai/larify-desktop/releases/latest`
