import iconv from "iconv-lite"
import { describe, expect, it } from "vitest"
import {
  createStreamDecoder,
  decodeLossy,
  decodeText,
} from "../../../../src/extensions/fs/main/encoding"

const feed = (buffer: Buffer, sizes: number[]): string => {
  const decode = createStreamDecoder()
  let out = ""
  let at = 0
  for (const size of sizes) {
    if (at >= buffer.length) break
    out += decode(buffer.subarray(at, at + size))
    at += size
  }
  if (at < buffer.length) out += decode(buffer.subarray(at))
  return out
}

const everySplit = (buffer: Buffer): string[] => {
  const results: string[] = []
  for (let cut = 1; cut < buffer.length; cut++) {
    const decode = createStreamDecoder()
    results.push(decode(buffer.subarray(0, cut)) + decode(buffer.subarray(cut)))
  }
  return results
}

const repeat = (line: string, count: number) =>
  Array.from({ length: count }, (_, i) => line.replace("%d", String(i))).join("\n") + "\n"

describe("UTF-8: 在每一个字节位置切开都与一次性解码相同", () => {
  const samples: Array<[string, string]> = [
    ["纯 ASCII", "hello world\nsecond line\n"],
    ["中文 (3 字节)", "第一行内容\n第二行内容\n"],
    ["emoji (4 字节)", "a🎉b🚀c\nd🌟e\n"],
    ["混合宽度", "a中🎉b\né\n"],
    ["组合字符与代理对", "é\n👨‍👩‍👧\n"],
  ]

  for (const [name, text] of samples) {
    it(name, () => {
      const buffer = Buffer.from(text, "utf8")
      const oneShot = decodeText(buffer)

      for (const [index, got] of everySplit(buffer).entries()) {
        expect(got, `${name} 切在第 ${index + 1} 字节`).toBe(oneShot)
      }
    })
  }

  it("多字节字符被切成三段也能拼回来", () => {
    const buffer = Buffer.from("前🎉后", "utf8")

    expect(feed(buffer, [3, 1, 1, 1, 1])).toBe(decodeText(buffer))
  })

  it("每次只喂一个字节", () => {
    const buffer = Buffer.from("中文 mixed 🎉 内容", "utf8")

    expect(feed(buffer, Array(buffer.length).fill(1))).toBe(decodeText(buffer))
  })
})

describe("非 UTF-8: 第一块足够判定之后, 后续怎么切都一致", () => {
  const samples: Array<[string, string, string]> = [
    ["GBK", "第%d行的中文内容测试", "gbk"],
    ["Big5", "第%d行的中文內容測試", "big5"],
    ["Shift_JIS", "%d行目の日本語テキスト", "shift_jis"],
    ["EUC-KR", "%d번째 줄 한국어 텍스트", "euc-kr"],
  ]

  for (const [name, line, encoding] of samples) {
    it(`${name}: 判定后逐字节喂入`, () => {
      const buffer = iconv.encode(repeat(line, 30), encoding)
      const head = 400
      const oneShot = decodeText(buffer)

      const decode = createStreamDecoder()
      let got = decode(buffer.subarray(0, head))
      for (let at = head; at < buffer.length; at++) got += decode(buffer.subarray(at, at + 1))

      expect(got).toBe(oneShot)
    })
  }
})

describe("编码只在第一块判定", () => {
  it("第一块太小就拒绝, 哪怕整个文件足够判定", () => {
    const buffer = iconv.encode(repeat("第%d行的中文内容测试", 30), "gbk")
    expect(decodeText(buffer)).toContain("第0行")

    const decode = createStreamDecoder()

    expect(() => decode(buffer.subarray(0, 8))).toThrow(/^Not UTF-8; encoding undetermined/)
  })

  it("第一块足够大就正常解码", () => {
    const buffer = iconv.encode(repeat("第%d行的中文内容测试", 30), "gbk")
    const decode = createStreamDecoder()

    expect(decode(buffer.subarray(0, 400))).toContain("第0行")
  })
})

describe("编码只决定一次", () => {
  it("认定 UTF-8 之后遇到非法字节报错, 不改判成别的编码", () => {
    const decode = createStreamDecoder()
    expect(decode(Buffer.from("clean utf8 text\n".repeat(50), "utf8"))).toContain("clean utf8")

    expect(() => decode(iconv.encode("第一行的中文内容测试".repeat(20), "gbk"))).toThrow(
      /^Not UTF-8; encoding undetermined/,
    )
  })

  it("认定 GBK 之后继续按 GBK 解, 不因为后面像 UTF-8 就改判", () => {
    const decode = createStreamDecoder()
    const head = repeat("第%d行的中文内容测试", 30)
    expect(decode(iconv.encode(head, "gbk"))).toBe(head)

    expect(decode(Buffer.from("plain ascii tail\n", "utf8"))).toBe("plain ascii tail\n")
    expect(decode(iconv.encode("再来一行中文\n", "gbk"))).toBe("再来一行中文\n")
  })

  it("第一块就不是 UTF-8 时, 这一块本身也要解出来而不是被丢掉", () => {
    const decode = createStreamDecoder()
    const text = repeat("第%d行的中文内容测试", 30)

    expect(decode(iconv.encode(text, "gbk"))).toBe(text)
  })
})

describe("认不出编码时拒绝", () => {
  it("过短的非 UTF-8 片段", () => {
    const decode = createStreamDecoder()

    expect(() => decode(iconv.encode("目标", "gbk"))).toThrow(
      /^Not UTF-8; encoding undetermined \(best guess .+, confidence \d+\)\.$/,
    )
  })

  it("KOI8-R 即使内容够长", () => {
    const decode = createStreamDecoder()
    const text = Array.from({ length: 50 }, (_, i) => `строка ${i} русский текст`).join("\n")

    expect(() => decode(iconv.encode(text, "koi8-r"))).toThrow(/^Not UTF-8; encoding undetermined/)
  })

  it("和 decodeText 报同一条信息", () => {
    const tiny = iconv.encode("目标", "gbk")
    const decode = createStreamDecoder()
    let streamed = ""
    let oneShot = ""
    try {
      decode(tiny)
    } catch (error) {
      streamed = (error as Error).message
    }
    try {
      decodeText(tiny)
    } catch (error) {
      oneShot = (error as Error).message
    }

    expect(streamed).toBe(oneShot)
  })
})

describe("边界输入", () => {
  it("空 buffer 解成空串", () => {
    expect(createStreamDecoder()(Buffer.alloc(0))).toBe("")
  })

  it("整块都是半个字符时先不产出, 补齐后再产出", () => {
    const buffer = Buffer.from("中", "utf8")
    const decode = createStreamDecoder()

    expect(decode(buffer.subarray(0, 2))).toBe("")
    expect(decode(buffer.subarray(2))).toBe("中")
  })

  it("BOM 被保留", () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("abc", "utf8")])

    expect(createStreamDecoder()(buffer)).toBe("﻿abc")
    expect(decodeText(buffer)).toBe("﻿abc")
  })
})

describe("末尾残缺的多字节序列不再被静默丢弃", () => {
  it("end() 在半个字符残留时抛错", () => {
    const decode = createStreamDecoder()

    expect(decode(Buffer.from([0x61, 0x62, 0x63, 0xe4, 0xb8]))).toBe("abc")
    expect(() => decode.end()).toThrow()
  })

  it("end() 在干净结尾返回空串", () => {
    const decode = createStreamDecoder()
    decode(Buffer.from("完整内容\n", "utf8"))

    expect(decode.end()).toBe("")
  })
})

describe("decodeLossy 永不抛错", () => {
  it("合法 UTF-8 结果与 decodeText 相同", () => {
    const buffer = Buffer.from("中文 hello 🎉\n", "utf8")

    expect(decodeLossy(buffer)).toBe(decodeText(buffer))
  })

  it("非法字节变成替换符而不是抛错", () => {
    const buffer = Buffer.concat([Buffer.from("ok "), Buffer.from([0xff, 0xfe]), Buffer.from(" end")])

    const shown = decodeLossy(buffer)

    expect(shown).toContain("ok ")
    expect(shown).toContain(" end")
    expect(shown).toContain("�")
  })

  it("GBK 字节不抛错, ASCII 部分仍然可读", () => {
    const buffer = iconv.encode("配置项 needle here", "gbk")

    expect(decodeLossy(buffer)).toContain("needle here")
  })
})
