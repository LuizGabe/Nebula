const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

let create
const delays = []
class FakeGroq { chat = { completions: { create: options => create(options) } } }
const exportsUnderTest = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/llm/adapters/groq.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, {
  exports: exportsUnderTest, Error, console,
  setTimeout: (callback, delay) => { delays.push(delay); callback() },
  require: id => {
    if (id === 'groq-sdk') return FakeGroq
    if (id === '@/config') return { config: { GROQ_API_KEY: 'test' } }
    throw new Error(`Unexpected import: ${id}`)
  },
})

async function main() {
  const adapter = new exportsUnderTest.GroqAdapter('groq/openai/gpt-oss-20b')
  let calls = 0
  create = async () => {
    if (++calls === 1) throw Object.assign(new Error('Rate limit'), { status: 429, headers: new Headers({ 'retry-after': '1' }) })
    return (async function* () { yield { choices: [{ delta: { content: 'Documento' }, finish_reason: null }] }; yield { choices: [{ delta: {}, finish_reason: 'stop' }] } })()
  }
  let content = ''
  for await (const token of adapter.stream([])) content += token
  assert.equal(content, 'Documento')
  assert.equal(calls, 2)
  assert.deepEqual(delays, [2000])

  create = async () => ({ choices: [{ finish_reason: 'length', message: { content: 'Partial' } }] })
  await assert.rejects(adapter.complete([]), /limite da resposta/)
  create = async () => (async function* () { yield { choices: [{ delta: { content: 'Partial' }, finish_reason: 'length' }] } })()
  await assert.rejects(async () => { for await (const token of adapter.stream([])) {} }, /limite da resposta/)
  console.log('Groq generation retry and truncation tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
