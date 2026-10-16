import { describe, expect, it } from 'vitest'
import { isBinaryContent } from '../../../../src/extensions/workspace/shared/binary-content'

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('isBinaryContent', () => {
  it('treats plain text as text regardless of extension-less content', () => {
    expect(isBinaryContent(bytes('#!/bin/bash\necho hello\n'))).toBe(false)
  })

  it('treats an XML declaration as text', () => {
    expect(isBinaryContent(bytes('<?xml version="1.0"?>\n<robot name="demo"/>'))).toBe(false)
  })

  it('treats an empty payload as text', () => {
    expect(isBinaryContent(new Uint8Array())).toBe(false)
  })

  it('detects a NUL byte as binary', () => {
    expect(isBinaryContent(new Uint8Array([104, 105, 0, 105]))).toBe(true)
  })

  it('detects a real PNG header as binary', () => {
    const png = new Uint8Array(16)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    expect(isBinaryContent(png)).toBe(true)
  })

  it('only samples the leading window, matching Git buffer_is_binary', () => {
    const late = new Uint8Array(9000)
    late.fill(65)
    late[8500] = 0
    expect(isBinaryContent(late)).toBe(false)
  })
})
