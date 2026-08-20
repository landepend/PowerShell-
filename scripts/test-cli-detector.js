// Functional test for RunningCliDetector:
//  1. shell running a fake "claude.exe" (ping copy)            -> 'claude'
//  2. shell running node …/@moonshot-ai/kimi-code/dist/main.mjs -> 'kimi'
//  3. shell whose command line merely mentions kimi-notes.txt   -> no match
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { detectRunningClis } = require('./detector-test-bundle.cjs')

const tmp = path.join(os.tmpdir(), 'pss-detector-test')
fs.mkdirSync(tmp, { recursive: true })

const fakeClaude = path.join(tmp, 'claude.exe')
fs.copyFileSync('C:\\Windows\\System32\\ping.exe', fakeClaude)

const fakePkg = path.join(tmp, '@moonshot-ai', 'kimi-code', 'dist')
fs.mkdirSync(fakePkg, { recursive: true })
fs.writeFileSync(path.join(fakePkg, 'main.mjs'), 'setInterval(() => {}, 1000)')

const logger = { log: () => {}, error: (...a) => console.error('[log]', ...a) }
const kids = []

function shell(args) {
  const p = spawn('powershell.exe', ['-NoProfile', '-Command', ...args], { stdio: 'ignore' })
  kids.push(p)
  return p
}

const shClaude = shell([`& '${fakeClaude}' -t 127.0.0.1`])
const shKimi = shell([`& node '${path.join(fakePkg, 'main.mjs')}'`])
const shLookalike = shell([`cmd /c ping -t 127.0.0.1 > '${path.join(tmp, 'kimi-notes.txt')}'`])

function killTree(pid) {
  return new Promise((r) => {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }).on('close', r)
  })
}

async function main() {
  await new Promise((r) => setTimeout(r, 2000)) // let children start
  const found = await detectRunningClis([shClaude.pid, shKimi.pid, shLookalike.pid], logger)
  console.log('detected:', Object.fromEntries(found))
  const checks = [
    ['claude.exe child -> claude', found.get(shClaude.pid) === 'claude'],
    ['node kimi-code path -> kimi', found.get(shKimi.pid) === 'kimi'],
    ['kimi-notes.txt lookalike -> clean', !found.has(shLookalike.pid)]
  ]
  for (const [name, ok] of checks) console.log(ok ? 'ok  ' + name : 'FAIL ' + name)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
}

main()
  .then(async () => {
    for (const k of kids) await killTree(k.pid)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
  .catch(() => {
    process.exitCode = 1
  })
