const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const exportsUnderTest = {}
const timers = new Set()
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/utils/audioDuration.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, {
  exports: exportsUnderTest, DOMException,
  setTimeout: callback => { timers.add(callback); return callback },
  clearTimeout: callback => timers.delete(callback),
})
const { resolveAudioDuration } = exportsUnderTest

class Audio extends EventTarget {
  duration = Infinity
  currentTime = 0
  seeking = false
}

async function main() {
  // Indexed files need no seek or extra loading.
  const indexed = new Audio()
  indexed.duration = 120
  indexed.currentTime = 30
  assert.equal(await resolveAudioDuration(indexed, new AbortController().signal), 120)
  assert.equal(indexed.currentTime, 30)

  // Missing WebM Duration must be discovered before returning, then restore position.
  const recording = new Audio()
  recording.currentTime = 12
  const resolved = resolveAudioDuration(recording, new AbortController().signal)
  assert.equal(recording.currentTime, Number.MAX_SAFE_INTEGER)
  recording.duration = 60
  recording.seeking = true
  recording.dispatchEvent(new Event('durationchange'))
  assert.equal(recording.currentTime, Number.MAX_SAFE_INTEGER)
  recording.seeking = false
  recording.dispatchEvent(new Event('seeked'))
  assert.equal(await resolved, 60)
  assert.equal(recording.currentTime, 12)

  // Switching sources cancels discovery without seeking in the new source.
  const controller = new AbortController()
  const cancelledAudio = new Audio()
  const cancelled = resolveAudioDuration(cancelledAudio, controller.signal)
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  cancelledAudio.currentTime = 10
  cancelledAudio.duration = 80
  cancelledAudio.dispatchEvent(new Event('durationchange'))
  assert.equal(cancelledAudio.currentTime, 10)
  await assert.rejects(resolveAudioDuration(indexed, controller.signal), { name: 'AbortError' })

  // Failed downloads and timeouts must recover and leave no pending listeners/timers.
  const broken = new Audio()
  const failure = resolveAudioDuration(broken, new AbortController().signal)
  broken.dispatchEvent(new Event('error'))
  await assert.rejects(failure, /duracao/)
  assert.equal(broken.currentTime, 0)
  const stalled = resolveAudioDuration(new Audio(), new AbortController().signal)
  for (const timeout of timers) timeout()
  await assert.rejects(stalled, /duracao/)
  assert.equal(timers.size, 0)
  console.log('Audio duration regression tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
