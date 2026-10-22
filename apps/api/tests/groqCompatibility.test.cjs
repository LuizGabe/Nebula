const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const requestedModels = []
class FakeGroq {
  chat = { completions: { create: async options => {
    requestedModels.push(options.model)
    return { choices: [{ message: { content: 'summary' } }] }
  } } }
}
const exportsUnderTest = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/llm/adapters/groq.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, {
  exports: exportsUnderTest,
  require: id => {
    if (id === 'groq-sdk') return FakeGroq
    if (id === '@/config') return { config: { GROQ_API_KEY: 'test' } }
    throw new Error(`Unexpected import ${id}`)
  },
})
async function main() {
  for (const [id, expected] of [
    ['groq/compound-mini', 'openai/gpt-oss-20b'],
    ['groq/compound', 'openai/gpt-oss-120b'],
    ['groq/openai/gpt-oss-20b', 'openai/gpt-oss-20b'],
    ['groq/openai/gpt-oss-120b', 'openai/gpt-oss-120b'],
  ]) {
    assert.equal(await new exportsUnderTest.GroqAdapter(id).complete([]), 'summary')
    assert.equal(requestedModels.at(-1), expected)
  }
  console.log('Groq saved-profile compatibility tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
