const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function setup() {
  const states = [], cleanups = [], timers = new Map(), statusCalls = []
  let job = { status: 'active' }
  let rejectRequest = false
  const jsx = (type, props) => ({ type, props })
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/DocumentEditor.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, Error,
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react') return {
        useState: initial => {
          const index = states.length
          if (index === 3) initial = false
          states.push(initial)
          return [initial, value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
        },
        useRef: current => ({ current }), useCallback: callback => callback,
        useEffect: callback => cleanups.push(callback()),
      }
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '../api/client') return { documents: {
        listVersions: async () => ({ documents: [] }),
        getContent: async () => ({ document: { id: 'doc', version: 2, content: 'Documento novo' } }),
        reprocess: async () => { if (rejectRequest) throw new Error('Ja existe uma geracao em andamento'); return { jobId: 'actual-job' } },
        jobStatus: async (...args) => { statusCalls.push(args); return job },
      } }
      if (id === './ui/Button') return { Button: 'button' }
      return {}
    },
  })
  const tree = exports.DocumentEditor({ sessionId: 's1' })
  function find(node) {
    if (!node || typeof node !== 'object') return null
    if (node.props?.['aria-label'] === 'Gerar nova versão do documento') return node
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = find(child)
      if (found) return found
    }
    return null
  }
  return { states, cleanups, timers, statusCalls, click: () => find(tree).props.onClick(), setJob: value => { job = value }, reject: () => { rejectRequest = true } }
}

async function tick(harness) {
  const [id, callback] = [...harness.timers.entries()][0]
  harness.timers.delete(id)
  callback()
  await new Promise(resolve => setImmediate(resolve))
}

async function main() {
  const failure = setup()
  await failure.click()
  assert.equal(failure.states[6], true)
  assert.deepEqual(failure.statusCalls[0], ['s1', 'actual-job'])
  failure.setJob({ status: 'failed', error: 'Limite do provedor excedido' })
  await tick(failure)
  assert.equal(failure.states[6], false)
  assert.equal(failure.states[10], 'Limite do provedor excedido')
  assert.equal(failure.timers.size, 0)

  const success = setup()
  await success.click()
  success.setJob({ status: 'completed', result: { version: 2 } })
  await tick(success)
  assert.equal(success.states[6], false)
  assert.equal(success.states[1].content, 'Documento novo')
  assert.equal(success.states[10], '')

  const rejected = setup()
  rejected.reject()
  await rejected.click()
  assert.equal(rejected.states[6], false)
  assert.match(rejected.states[10], /andamento/)

  const unmount = setup()
  await unmount.click()
  unmount.cleanups.forEach(cleanup => cleanup?.())
  assert.equal(unmount.timers.size, 0)
  console.log('Document reprocess frontend tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
