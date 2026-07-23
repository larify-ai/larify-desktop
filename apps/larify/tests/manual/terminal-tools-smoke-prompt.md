# terminal 工具全量冒烟测试 Prompt

把下面「PROMPT」整段发给 larify 的 agent。它会逐个跑 `terminal` 工具（list / create / write / read / close）和各种边界，并在最后打一张通过/失败表。

> 覆盖范围：所有工具的正常路径 + create 的 cwd 边界 + shell-integration 完成检测 + 大输出溢出 log_path + 原始输入/控制字符 + 交互式 stdin + 运行中等待 + not-found 报错 + shell 退出清理。
>
> 命令以 **Windows PowerShell** 为主（larify 在 Windows 上的默认 shell），括号里给 bash/zsh 等价写法。agent 应先看 `create` 返回的 `shell` 字段判断当前是哪种 shell，再选对应命令。
>
> **不在本 prompt 覆盖**（agent 层难以构造，已由单元测试覆盖）：
> - **run-log 标记重复**（takeAllRemaining）：需要一次运行内多次 flush + 输出无结尾换行；tool 接口一次调用只跑一条命令，造不出来。见 `terminal.test.ts`。
> - **read 竞争退出丢最终快照 / 跨命令完成误判**：依赖毫秒级时序。见 `tools.test.ts`。
> - **dispose / 资源泄漏 / 并发写序列化 / batcher 清理**：内部状态，agent 不可观测。见 `terminal.test.ts`、`terminal-manager.test.ts`、`ipc.test.ts`。
> - **非当前平台的 bash/zsh live shell-integration**（Windows 上跑的是 PowerShell）。
>
> 这些看 `tests/extensions/terminal/**/*.test.ts`。

---

## PROMPT

你在测试 `terminal` 工具集（list、create、write、read、close）。

规则：
- 每一步先**声明预期**，再调用工具，然后报 ✅（符合预期）或 ❌（附实际结果）。
- 标注「预期报错」的步骤，**只有真的报错才算通过**；成功了反而是 ❌。
- 先看 `create` 返回的 `shell` 字段：含 `powershell`/`pwsh` → 用 PowerShell 命令；含 `bash`/`zsh` → 用括号里的 POSIX 命令。
- 用变量记住每个终端的 `id`（如 A、B），后续步骤引用它们。
- 需要发控制字符时，在 write 的 `input` 里传对应的 Unicode 控制字符本身（用 JSON 字符串的 unicode 转义写法）。
- 全部做完，打印一张表：步骤 | 预期 | 实际 | ✅/❌，并给出总通过数。任何 ❌ 都要贴出实际输出。

### 0. 基线
0.1 list → 记录当前已有的终端（作为基线，不要动它们）。

### 1. create —— 正常 + cwd 边界
1.1 create（不带 cwd）→ 记为**终端 A**。预期返回 state：`id` 为正整数、`pid` > 0、`shell` 非空、`cwd` 为默认工作目录、`exitCode` 为 null。
1.2 稍等片刻后 read 终端 A（idle=1）→ 预期能看到 shell 提示符；此后 A 的 state 里 `shellIntegration` 预期为 true（说明 OSC 633 集成脚本已注入）。
1.3 create（cwd = 一个**确实存在**的目录，例如仓库根 `D:\Workspace\larify-desktop`）→ 记为**终端 B**。预期 state.cwd 为该目录。
1.4 create（cwd = `D:\definitely\no\such\dir\zzz`，一个**不存在**的目录）→ **预期报错**（工作目录不存在）。
1.5 list → 预期在基线之外多出 A、B 两个终端。

### 2. write —— 提交命令（submit=true）
2.1 终端 A：write `echo hello-larify`（bash 同）、submit=true、idle=2 → 预期 snapshot.screen 含 `hello-larify`。若 A 的 `shellIntegration=true`，`status` 预期为 `shell integration command finish event received`；否则为 `command may still be running or waiting for input`。
2.2 终端 A：write 多行输出。PowerShell：`1..20 | ForEach-Object { "row $_" }`（bash：`for i in $(seq 1 20); do echo "row $i"; done`）、submit=true → 预期 snapshot 里能看到 `row 1` … `row 20`。
2.3 终端 A：write 大输出（超过 1000 行）。PowerShell：`1..2000 | ForEach-Object { "N$_" }`（bash：`seq 1 2000 | sed 's/^/N/'`）、submit=true、timeout=30 → **预期返回里带 `log_path`**，且 snapshot.screen 以 `(Earlier output in log_path)` 开头、尾部是最近的行（如 `N2000`）。
2.4 用 `fs` 的 read 打开 2.3 返回的 `log_path` → 预期是这次运行的日志，能看到较早的行（如 `N1`）。**顺带检查：随便挑一行（如 `N1500`）在文件里只出现一次，不应重复。**

### 3. write —— 原始输入（submit=false）与控制字符
3.1 终端 A：write 一个慢命令。PowerShell：`Start-Sleep -Seconds 20`（bash：`sleep 20`）、submit=true、**timeout=2** → 预期很快超时返回，`status` = `command may still be running or waiting for input`（命令仍在跑）。
3.2 紧接着终端 A：write **原始 Ctrl-C**（`input` 为单个控制字符，Unicode 码点 **U+0003**）、submit=false、idle=2 → 预期打断上面的 sleep，终端回到提示符（snapshot 里不再卡在 sleep）。
3.3 终端 A：write **原始方向键上**（`input` 为三个字符 ESC `[` A，Unicode 码点 **U+001B U+005B U+0041**）、submit=false、idle=1 → 预期**不追加回车**；多数 shell 会把上一条历史命令回填到当前行（能观察到"没有执行、只是回显/补全"即算通过）。之后再发一次 Ctrl-C（U+0003）清掉当前行。

### 4. write —— 交互式 stdin
> 说明：提交命令（submit=true）时，若命令**开始后静默 `idle` 秒仍没结束**（典型如在等输入），write 会按 idle 窗口返回，而不是死等到 timeout。所以交互式命令给一个较小的 `idle` 就能快速探到提示。
4.1 终端 A：write 一个会读输入的命令。PowerShell：`$n = Read-Host "Name"; "Hi $n"`（bash：`read -p "Name: " n; echo "Hi $n"`）、submit=true、**idle=2**、timeout=30 → 预期约 2 秒后返回：snapshot 显示提示（含 `Name`），`status` = `command may still be running or waiting for input`（命令在等输入，**不应**卡到 timeout）。
4.2 终端 A：write `Larify`、submit=true、idle=2、timeout=30 → 预期命令收到输入后完成：snapshot 里出现 `Hi Larify`，`status` = `shell integration command finish event received`。

### 5. read —— 空闲 / 运行中等待 / TUI
5.1 终端 A：read、idle=0 → 预期**立即**返回当前屏幕快照（不等待）。
5.2 终端 A：先 write 慢命令（PowerShell：`Start-Sleep -Seconds 4; "slept"`；bash：`sleep 4; echo slept`）、submit=true、**timeout=1**（让 write 先超时返回，命令仍在跑）。随后 **read 终端 A、timeout=15** → 预期 read **会等到命令结束**再返回（snapshot 含 `slept`，`status` = `shell integration command finish event received`），而不是立刻返回。
5.3 （TUI / 备用缓冲区，可选）如果环境里有全屏程序就测：bash 下用 `less`（write 打开 `seq 1 100 | less`，read 看整屏，再 write `q` 退出）。PowerShell 下通常没有内置全屏程序，**没有合适程序就跳过并注明"当前平台无 TUI 程序，跳过"**。若测了，预期 read 能拿到整屏 TUI 快照，退出后能回到普通 shell。

### 6. close 与 not-found 报错
6.1 read 一个**不存在**的 id（如 `99999`）→ **预期报错** `Terminal "99999" not found.`。
6.2 write 到同一个不存在的 id → **预期同样报错** not found。
6.3 close **终端 B** → 预期成功，返回 `Closed terminal <B>.`。
6.4 再次 close 终端 B（同一个 id）→ **预期报错** not found。
6.5 list → 预期终端 B 已不在列表里；终端 A 仍在。

### 7. shell 退出即清理
7.1 终端 A：write `exit`、submit=true、idle=2 → 预期 shell 退出。
7.2 稍等后 list → 预期**终端 A 已从列表消失**（退出即被清理）。再 read 终端 A → **预期报错** not found。

### 8. 汇总
打印步骤表（步骤 | 预期 | 实际 | ✅/❌）和总通过数。任何 ❌ 都要贴出实际的工具返回。最后顺带报告：当前 shell 类型、shellIntegration 是否为 true、是否测了 5.3 的 TUI。
