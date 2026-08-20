// Probe: does the Kimi CLI composer draw its caret as an inverse-video cell?
// Spawns kimi in a PTY, captures the frame, looks for SGR inverse (7) runs.
const pty = require('node-pty')

const p = pty.spawn('cmd.exe', ['/c', 'kimi'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: process.cwd(),
  useConpty: true
})

let out = Buffer.alloc(0)
p.onData((d) => {
  out = Buffer.concat([out, Buffer.from(d, 'utf8')])
})

setTimeout(() => {
  const text = out.toString('utf8')
  // find SGR sequences containing 7 (inverse on) and show what follows
  const runs = [...text.matchAll(/(?:\x1b\[[0-9;]*7[0-9;]*m)(.{0,12})/gs)]
  console.log('inverse SGR runs:', runs.length)
  for (const r of runs.slice(0, 20)) {
    console.log('  ', JSON.stringify(r[0]).slice(0, 120))
  }
  p.kill()
  process.exit(0)
}, 12000)
