const pty = require('node-pty')
const path = require('path')

const script = path.resolve(__dirname, 'test-shell-integration.ps1')
const p = pty.spawn(
  'powershell.exe',
  ['-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', script],
  { name: 'xterm-256color', cols: 100, rows: 20, cwd: process.cwd(), useConpty: true }
)

let out = Buffer.alloc(0)
p.onData((d) => {
  out = Buffer.concat([out, Buffer.from(d, 'utf8')])
})

setTimeout(() => p.write('cd src\r'), 3000)

setTimeout(() => {
  const text = out.toString('utf8')
  const matches = [...text.matchAll(/\x1b\]9;9;([^\x1b\x07]+)\x1b\\/g)].map((m) => m[1])
  console.log('OSC 9;9 reports:', matches.length)
  for (const m of matches) console.log('  cwd =', m)
  const sawInitial = matches.some((m) => m.replace(/\\\\/g, '\\') === process.cwd())
  const sawCd = matches.some((m) => m.replace(/\\\\/g, '\\').endsWith('\\src'))
  console.log('initial cwd reported:', sawInitial, '| cd src reported:', sawCd)
  p.kill()
  process.exit(sawInitial && sawCd ? 0 : 1)
}, 9000)
