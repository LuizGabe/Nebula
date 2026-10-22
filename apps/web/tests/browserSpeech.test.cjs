const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function setup(persist = async () => {}, rejectTrack = false) {
  const saves = []
  const errors = []
  const instances = []
  const timers = new Map()
  const cleanups = []
  class Recognition {
    starts = 0
    start(track) {
      if (track && rejectTrack) throw Object.assign(new Error('invalid track'), { name: 'InvalidStateError' })
      this.starts++; this.track = track
    }
    stop() {
      queueMicrotask(() => {
        this.finalOnStop?.()
        this.onend()
      })
    }
    abort() { this.onend() }
    constructor() { instances.push(this) }
    result(text, isFinal) {
      this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] })
    }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/hooks/useBrowserSpeechTranscription.ts'), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports, window: { webkitSpeechRecognition: Recognition },
    setTimeout: (callback, delay) => { const id = Math.max(0, ...timers.keys()) + 1; callback.delay = delay; timers.set(id, callback); return id },
    clearTimeout: (id) => timers.delete(id),
    require: (id) => {
      if (id === 'react') return {
        useRef: (current) => ({ current }),
        useState: (value) => [value, () => {}],
        useMemo: (callback) => callback(),
        useCallback: (callback) => callback,
        useEffect: (callback) => cleanups.push(callback()),
      }
      if (id === '@/api/client') return { transcripts: { browserStatus: async () => {}, createManual: async (sessionId, segment) => {
        saves.push({ sessionId, ...segment })
        return persist()
      } } }
      throw new Error(`Unexpected import: ${id}`)
    },
  })
  const hook = exports.useBrowserSpeechTranscription({ sessionId: 'session', enabled: true, onError: (error) => errors.push(error) })
  return { hook, instances, saves, timers, cleanups, errors }
}

async function main() {
  // stop must wait for the asynchronous final result and never save the interim twice.
  {
    const { hook, instances, saves } = setup()
    assert.equal(hook.start(), true)
    assert.equal(hook.start(), false)
    instances[0].result('texto parcial', false)
    instances[0].finalOnStop = () => instances[0].result('texto final', true)
    await hook.stop()
    assert.deepEqual(saves.map((s) => s.text), ['texto final'])
  }
  // Browser time limits and silence must restart listening, but explicit stop must not.
  {
    const { hook, instances, timers, errors } = setup()
    hook.start()
    instances[0].onerror({ error: 'no-speech' })
    instances[0].onend()
    const restart = [...timers.entries()].find(([, callback]) => callback.delay === 300)
    timers.delete(restart[0])
    restart[1]()
    assert.equal(instances[0].starts, 2)
    await hook.stop()
    assert.equal(timers.size, 0)
    assert.equal(errors.length, 0)
  }
  // Pause/resume and unmount must not leave an automatic restart running.
  {
    const { hook, instances, timers, cleanups } = setup()
    hook.start()
    hook.pause()
    assert.equal(await hook.resume(), true)
    assert.equal(instances.length, 2)
    cleanups.forEach((cleanup) => cleanup())
    assert.equal(timers.size, 0)
  }
  // Failed persistence must prevent finalization and retry with the original chunk id.
  {
    let failing = true
    const { hook, instances, saves } = setup(async () => { if (failing) throw new Error('offline') })
    hook.start()
    instances[0].result('preservar texto', true)
    await assert.rejects(hook.stop(), /salvar a transcricao/)
    failing = false
    await hook.stop()
    assert.equal(saves.length, 3)
    assert.equal(new Set(saves.map((s) => s.chunkIndex)).size, 1)
  }
  // Fatal service errors must be visible and must not trigger an endless retry loop.
  {
    const { hook, instances, errors, timers } = setup()
    hook.start()
    instances[0].onerror({ error: 'network' })
    instances[0].onend()
    await hook.stop()
    assert.match(errors[0].message, /conexao/)
    assert.equal(timers.size, 0)
  }
  // Recognition must consume the recorder track, including after silence/restart.
  {
    const { hook, instances, timers } = setup()
    const track = { kind: 'audio', readyState: 'live' }
    hook.start(true, track)
    assert.equal(instances[0].track, track)
    instances[0].onend()
    const restart = [...timers.entries()].find(([, callback]) => callback.delay === 300)
    timers.delete(restart[0])
    restart[1]()
    assert.equal(instances[0].track, track)
    await hook.stop()
  }
  // A service that never returns a result must report a visible timeout.
  {
    const { hook, timers, errors } = setup()
    hook.start()
    const timeout = [...timers.entries()].find(([, callback]) => callback.delay === 15000)
    timers.delete(timeout[0])
    timeout[1]()
    assert.match(errors[0].message, /nao retornou texto/)
    await hook.stop()
  }
  // Chrome rejecting the track overload must fall back to microphone recognition.
  {
    const { hook, instances, errors } = setup(async () => {}, true)
    assert.equal(hook.start(true, { kind: 'audio', readyState: 'live' }), true)
    assert.equal(instances[0].starts, 1)
    assert.equal(instances[0].track, undefined)
    assert.equal(errors.length, 0)
    await hook.stop()
  }
  console.log('Browser speech regression tests passed (8 scenarios)')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
