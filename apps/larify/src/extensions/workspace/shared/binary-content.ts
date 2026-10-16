/**
 * 判断一段文件内容是否为二进制，供工作台预览与变更视图统一使用。
 *
 * 判据与 Git 的 `buffer_is_binary` 同源：**扫描头部字节，出现 NUL 字节即视为二进制**。
 * 之所以不看 MIME / 扩展名——因为「这是什么格式」与「能不能当文本读」是两件不相干的事：
 * - `file-type` 会把 `<?xml ...?>` 开头的纯文本认成 `application/xml`；
 * - `mime-types` 会把 `.sh` 查成 `application/x-sh`、`.ts` 查成 `video/mp2t`、`.js` 查成
 *   `application/javascript`、`.toml` 查成 `application/toml`……
 * 这些都**不以 `text/` 开头**，若按 MIME 白名单判定会被误判为二进制 ⇒ 预览退化。
 * 而按内容判定与扩展名/MIME 表无关，一次修好整族文本文件（`.sh/.js/.ts/.toml/.sql/.bat/.pem` 等）。
 *
 * 代价：需要读一小段头部字节（调用方读，本函数只做纯判定）。
 */
const sampleSize = 8192

export function isBinaryContent(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.length, sampleSize)
  for (let index = 0; index < length; index++) {
    if (bytes[index] === 0) return true
  }
  return false
}
