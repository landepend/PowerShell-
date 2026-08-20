import { mkdirSync, writeFileSync } from 'fs'
import { basename, extname, isAbsolute, join, resolve } from 'path'
import type { ChatAttachment } from '../../shared/types/chat'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(extname(path).toLowerCase())
}

function attachmentKind(path: string): ChatAttachment['kind'] {
  return isImagePath(path) ? 'image' : 'file'
}

/** Strip path separators / illegal filename chars from an untrusted name. */
function sanitizeName(name: string): string {
  const base = (typeof name === 'string' && name ? name : 'attachment').split(/[\\/]/).pop()!
  return base.replace(/[\\/:*?"<>|]/g, '_') || 'attachment'
}

/** Persist pasted bytes under <dataDir>/attachments/ and describe them. */
export function saveAttachment(dataDir: string, name: string, data: Uint8Array): ChatAttachment {
  const dir = join(dataDir, 'attachments')
  mkdirSync(dir, { recursive: true })
  const safe = sanitizeName(name)
  const file = join(dir, `${Date.now()}-${safe}`)
  writeFileSync(file, Buffer.from(data))
  return { kind: attachmentKind(file), name: safe, path: file }
}

/** Wrap an existing path as an attachment (no copy; it may not exist). */
export function attachmentForPath(path: string): ChatAttachment {
  const abs = isAbsolute(path) ? path : resolve(path)
  return { kind: attachmentKind(abs), name: basename(abs), path: abs }
}
