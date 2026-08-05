# fs 工具全量冒烟测试 Prompt

把下面「PROMPT」整段发给 larify 的 agent。它会在一个沙盒目录里逐个跑 `fs` 工具（read / write / edit / ls / glob / grep）和各种边界，并在最后打一张通过/失败表。

> 覆盖范围：所有工具的正常路径 + 全部错误 gate + 多字节编码 + 多行 / replace_all / 删除 + 分页窗口 + 目录/文件类型校验。
>
> **不在本 prompt 覆盖**（agent 层难以构造，已由单元测试覆盖）：
> - **read-before-write / read-before-edit 门禁**：agent 建的每个文件都会被自动标记为"已读"，所以在一个会话里无法制造"存在但未读"的文件来触发这两个门禁。见 write.test.ts / edit.test.ts。
> - 大文件流式（write 内容受模型输出长度限制，造不出几十 MB）。
> - GBK 等非 UTF-8（write 一律写 UTF-8）、CRLF 保留（write 新建一律 LF）。
> - modified-since-read 竞态（需带外修改文件）。
>
> 这些看 `tests/extensions/fs/main/*.test.ts`。

---

## PROMPT

你在测试 `fs` 工具集（read、write、edit、ls、glob、grep）。全程只在你新建的沙盒目录里操作。

规则：
- 每一步先**声明预期**，再调用工具，然后报 ✅（符合预期）或 ❌（附实际结果）。
- 标注「预期报错」的步骤，**只有真的报错才算通过**；成功了反而是 ❌。
- 所有路径都放在 `fs-smoke/` 下。
- 全部做完，打印一张表：步骤 | 预期 | 实际 | ✅/❌，并给出总通过数。

### 0. 准备
0.1 用 write 在 `fs-smoke/hello.txt` 写入 `hello world\n`（这会顺便建出 `fs-smoke/` 目录）。

### 1. write —— 创建
1.1 write `fs-smoke/unicode.txt` = `中文 café 🚀\n` → 预期成功。
1.2 write `fs-smoke/nested/deep/note.txt` = `nested\n` → 预期成功（父目录自动创建）。
1.3 write `fs-smoke/empty.txt` = 空字符串 → 预期成功（0 字节文件）。
1.4 write `fs-smoke/many.txt` = 30 行文本，内容为 `line 1` 到 `line 30` 每行一个 → 预期成功。

### 2. read —— 基本 + 窗口 + 编码
2.1 read `fs-smoke/hello.txt` → 预期正好是 `hello world`。
2.2 read `fs-smoke/unicode.txt` → 预期多字节字符完好：`中文 café 🚀`，不得乱码。
2.3 read `fs-smoke/many.txt`，limit=20（字符）→ 预期结尾出现 `(Continue from ...)` 标记。
2.4 read `fs-smoke/many.txt`，line=10 → 预期从第 10 行附近开始。
2.5 read `fs-smoke/many.txt`，scroll="up" → 预期看到文件尾部。
2.6 read `fs-smoke/`（一个目录）→ **预期报错**（read 只读文件）。

### 3. write —— 覆盖 + 幂等门禁
3.1 先 read `fs-smoke/hello.txt`，再 write 它 = `hello again\n` → 预期成功（更新）。
3.2 再次 read `fs-smoke/hello.txt`，再 write **完全相同**的 `hello again\n` → **预期报错**：identical … Nothing to write.

### 4. edit —— 核心 + 门禁
4.1 read `fs-smoke/hello.txt` 后，edit：old=`again` new=`AGAIN` → 预期成功，文件变成 `hello AGAIN`。
4.2 edit `fs-smoke/hello.txt`：old=`zzz-not-here` new=`x` → **预期报错**：not found。
4.3 edit `fs-smoke/hello.txt`：old=`hello` new=`hello` → **预期报错**：identical。
4.4 write `fs-smoke/dup.txt` = `a a a\n`；read 它；edit old=`a` new=`b`（不带 replace_all）→ **预期报错**：appears 3 times。
4.5 edit `fs-smoke/dup.txt`：old=`a` new=`b`，replace_all=true → 预期成功，文件变成 `b b b`。
4.6 多行：write `fs-smoke/ml.txt` = `A\nB\nC\n`；read；edit old=`A\nB` new=`X` → 预期成功，文件变成 `X\nC`。
4.7 删除：read `fs-smoke/ml.txt`；edit old=`X\n` new=空 → 预期成功，文件变成 `C`。

### 5. ls
5.1 ls `fs-smoke/` → 预期看到 hello.txt、unicode.txt、many.txt、dup.txt、ml.txt、empty.txt、nested/。
5.2 ls `fs-smoke/`，limit=2 → 预期只 2 项 + 省略提示。
5.3 ls `fs-smoke/hello.txt`（一个文件）→ **预期报错**（ls 只列目录）。

### 6. glob
6.1 glob pattern=`*.txt`，path=`fs-smoke/` → 预期列出各 .txt 文件。
6.2 glob pattern=`**/*.txt`，path=`fs-smoke/` → 预期还包含 `nested/deep/note.txt`。
6.3 glob pattern=`*.nonexistent`，path=`fs-smoke/` → 预期 `No files found.`。

### 7. grep
7.1 grep pattern=`line 1`，path=`fs-smoke/` → 预期在 many.txt 命中。
7.2 grep pattern=`hello`，glob=`*.txt`，path=`fs-smoke/` → 预期命中 hello.txt。
7.3 grep pattern=`wontmatch12345`，path=`fs-smoke/` → 预期 `No matches found.`。

### 8. 汇总
打印步骤表（步骤 | 预期 | 实际 | ✅/❌）和总通过数。任何 ❌ 都要贴出实际输出。
