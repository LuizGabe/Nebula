const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const Fastify = require('fastify')
function transpile(file, overrides = {}) {
  const exports = {}
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(output, { exports, require: id => id in overrides ? overrides[id] : require(id) })
  return exports
}
exports.folderApp = async function folderApp(prisma) {
  const route = transpile('routes/folders.ts', {
    '@/lib/prisma': { prisma }, '@/lib/folderColors': transpile('lib/folderColors.ts'),
    '@/hooks/requireAuth': { requireAuth: async (request, reply) => {
      const owner = request.headers['x-test-owner']
      if (!owner) return reply.status(401).send({ error: 'Unauthorized' })
      request.session = { get: () => owner }
    } },
  }).default
  const app = Fastify()
  await app.register(route)
  return app
}
exports.checkFolders = async function checkFolders(prisma, owners) {
  const fallback = await exports.folderApp({ folder: { findMany: async () => [
    { id: 'old', name: 'Legacy' }, { id: 'invalid', name: 'Unknown', color: '#fff' },
  ] } })
  try {
    const response = await fallback.inject({ method: 'GET', url: '/folders', headers: { 'x-test-owner': owners[0] } })
    assert.deepEqual(response.json().folders.map(folder => folder.color), ['neutral', 'neutral'])
  } finally { await fallback.close() }
  const app = await exports.folderApp(prisma)
  const call = (method, url, payload, owner = owners[0]) => app.inject({ method, url, payload, headers: owner ? { 'x-test-owner': owner } : {} })
  try {
    assert.equal((await call('GET', '/folders', undefined, null)).statusCode, 401)
    const create = await call('POST', '/folders', { name: 'QA parent', color: 'violet' })
    assert.equal(create.statusCode, 201)
    const parent = create.json().folder
    assert.equal(parent.color, 'violet')
    const child = (await call('POST', '/folders', { name: 'QA child', parentId: parent.id })).json().folder
    assert.equal(child.color, 'neutral', 'child must not inherit parent color')
    const grandchild = (await call('POST', '/folders', { name: 'QA descendant', parentId: child.id, color: 'sage' })).json().folder
    assert.equal((await call('PUT', `/folders/${child.id}`, { color: 'blue' })).json().folder.color, 'blue')
    const listed = (await call('GET', '/folders')).json().folders
    assert.equal(listed.find(item => item.id === parent.id).color, 'violet')
    assert.equal(listed.find(item => item.id === child.id).color, 'blue', 'color persists across reads')
    for (const color of ['#fff', 'red', 'var(--danger)', '', null]) {
      assert.equal((await call('PUT', `/folders/${child.id}`, { color })).statusCode, 400)
      assert.equal((await call('POST', '/folders', { name: 'invalid', color })).statusCode, 400)
    }
    assert.equal((await call('POST', '/folders', { name: '   ' })).statusCode, 400)
    assert.equal((await call('PUT', `/folders/${parent.id}`, { color: 'sand' }, owners[1])).statusCode, 404)
    assert.equal((await call('POST', '/folders', { name: 'foreign parent', parentId: parent.id }, owners[1])).statusCode, 404)
    assert.equal((await call('DELETE', `/folders/${parent.id}`, {}, owners[1])).statusCode, 404)
    assert.equal((await call('GET', '/folders', undefined, owners[1])).json().folders.length, 0)
    const preserved = await prisma.recordingSession.create({ data: { ownerId: owners[0], folderId: grandchild.id, title: 'QA preserved' } })
    assert.equal((await call('DELETE', `/folders/${parent.id}`, { sessionAction: 'moveToRoot' })).statusCode, 204)
    const after = await prisma.recordingSession.findFirst({ where: { id: preserved.id } })
    assert.equal(after.folderId, null); assert.equal(after.isDeleted, false)
    assert.ok(!(await call('GET', '/folders')).json().folders.some(item => [parent.id, child.id, grandchild.id].includes(item.id)))
    const deletedParent = (await call('POST', '/folders', { name: 'QA delete' })).json().folder
    const deletedChild = (await call('POST', '/folders', { name: 'QA delete child', parentId: deletedParent.id })).json().folder
    const removed = await prisma.recordingSession.create({ data: { ownerId: owners[0], folderId: deletedChild.id, title: 'QA removed' } })
    assert.equal((await call('DELETE', `/folders/${deletedParent.id}`, { sessionAction: 'delete' })).statusCode, 204)
    assert.equal((await prisma.recordingSession.findFirst({ where: { id: removed.id } })).isDeleted, true)
    console.log('Folder routes: colors persist; validation, ownership, independent colors and both recursive deletion intents passed')
  } finally { await app.close() }
}
