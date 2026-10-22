const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
exports.loadSource = (file, overrides = {}) => {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, console, process, require: id => id in overrides ? overrides[id] : require(id) })
  return exports
}
exports.loadPolicy = prisma => exports.loadSource('lib/prompts.ts', { '@/lib/prisma': { prisma }, '@/lib/audioTimestamps': {} })
