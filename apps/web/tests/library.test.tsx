import assert from 'node:assert/strict'
import { act } from 'react'
import { Window } from 'happy-dom'
import type { Folder, Session } from '../src/api/client'
import { folderPath, librarySessions, notebookColor, sessionLabels, sessionPending } from '../src/utils/library'
const folders: Folder[] = [
  { id: 'parent', name: 'Reuniões', color: 'violet', parentId: null },
  { id: 'child', name: 'Cliente', color: 'blue', parentId: 'parent' },
  { id: 'empty', name: 'Vazio', parentId: null },
] as Folder[]
let data = [
  { id: 'root', folderId: null, title: 'Sessão solta', createdAt: '2026-10-20T12:00:00Z', status: 'ENDED', prompt: { name: 'Ata' } },
  { id: 'nested', folderId: 'child', title: 'Revisão da reunião com título longo identificável até o final', createdAt: '2026-10-22T12:00:00Z', status: 'ENDED', prompt: { name: 'Briefing' }, processing: { hasDocument: false, hasTranscript: true, pendingAudio: 0, failedAudio: 0, documentEvent: 'DOCUMENT_SKIPPED' } },
  { id: 'processing', folderId: 'parent', title: 'Planejamento', createdAt: '2026-10-21T12:00:00Z', status: 'IN_PROGRESS' },
] as Session[]
assert.deepEqual(librarySessions(data, folders, null).map(item => item.id), ['nested', 'processing', 'root'])
assert.deepEqual(librarySessions(data, folders, 'parent').map(item => item.id), ['nested', 'processing'])
assert.deepEqual(librarySessions(data, folders, 'root').map(item => item.id), ['root'])
assert.deepEqual(librarySessions(data, folders, 'parent', 'reuniao').map(item => item.id), ['nested'])
assert.equal(librarySessions(data, folders, 'root', 'Briefing').length, 0)
assert.equal(librarySessions(data, folders, null, 'briefing').length, 1)
assert.equal(librarySessions(data, folders, 'unknown').length, 0)
assert.deepEqual(folderPath('child', folders).map(item => item.id), ['parent', 'child'])
assert.equal(folderPath('x', [{ id: 'x', parentId: 'x' } as Folder]).length, 1)
assert.equal(notebookColor('#ff0000'), notebookColor('neutral'))
assert.equal(sessionLabels(data[0]).document, 'Sem documento confirmado')
assert.equal(sessionLabels(data[1]).document, 'Documento não gerado')
assert.equal(sessionPending(data[0]), false)
assert.equal(sessionPending({ ...data[0], status: 'ACTIVE' }), false, 'an open session alone does not prove processing work')
assert.equal(sessionPending(data[2]), true)
for (const event of ['DOCUMENT_GENERATING','DOCUMENT_QUEUED','DOCUMENT_FAILED','DOCUMENT_SKIPPED']) {
  const session = { ...data[1], processing: { ...data[1].processing!, hasDocument: true, documentEvent: event } }
  assert.notEqual(sessionLabels(session).document, 'Documento disponível')
  assert.equal(sessionPending(session), ['DOCUMENT_GENERATING','DOCUMENT_QUEUED'].includes(event))
}
const browser = new Window({ url: 'http://localhost:5173' })
for (const [key,value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Event: browser.Event, CustomEvent: browser.CustomEvent, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
const timers = new Map<number, () => void>()
let timerId = 0
browser.setInterval = ((callback: () => void) => { timers.set(++timerId, callback); return timerId }) as typeof browser.setInterval
browser.clearInterval = ((id: number) => { timers.delete(id) }) as typeof browser.clearInterval
const { createRoot } = await import('react-dom/client')
const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom')
const { sessions: api, folders: folderApi } = await import('../src/api/client')
const { DashboardPage } = await import('../src/pages/Dashboard')
const { NotebookDialog } = await import('../src/components/NotebookDialog')
let calls = 0, fail = false, held: (() => void) | null = null, hold = false
api.list = async () => { calls++; if (hold) await new Promise<void>(resolve => { held = resolve }); if (fail) throw Error('Offline'); return { sessions: [...data] } }
folderApi.list = async () => ({ folders })
const moves: unknown[] = []
api.update = async (id, update) => { moves.push([id, update]); data = data.map(item => item.id === id ? { ...item, ...update } as Session : item); return { session: data.find(item => item.id === id)! } }
const created: (string | null)[] = []
const router = createMemoryRouter([{ element: <Outlet context={{ openNewSession: (id: string | null) => created.push(id) }} />, children: [{ path: '/', element: <DashboardPage /> }] }])
const host = document.createElement('main'); document.body.append(host)
const root = createRoot(host)
const text = () => host.textContent ?? ''
const click = async (element: Element | null | undefined) => { assert.ok(element); await act(async () => { element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true })) }) }
const button = (name: string) => [...host.querySelectorAll('button')].find(item => item.textContent === name)
const navigate = async (url: string) => { await act(async () => { await router.navigate(url) }) }
const search = async (value: string) => {
  const input = host.querySelector<HTMLInputElement>('#library-search')!
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new browser.Event('input', { bubbles: true })) })
}
try {
  await act(async () => { root.render(<RouterProvider router={router} />) })
  assert.equal(host.querySelectorAll('h3').length, 3, 'one row per session')
  assert.ok(text().includes('Todas as sessões'))
  assert.ok(!text().includes('Pontos que merecem'))
  assert.equal(host.querySelector('a button'), null)
  await navigate('/?folder=child')
  assert.equal(host.querySelectorAll('h3').length, 1)
  assert.equal(host.querySelectorAll('nav[aria-label="Caminho do caderno"] a').length, 3)
  await click(button('Nova sessão')); assert.equal(created.at(-1), 'child')
  await navigate('/?folder=root'); assert.equal(host.querySelectorAll('h3').length, 1)
  await act(async () => { await router.navigate(-1) })
  assert.ok(text().includes('Cliente e subcadernos'))
  await act(async () => { await router.navigate(1) })
  assert.ok(text().includes('Sessões sem caderno'))
  await click(button('Nova sessão')); assert.equal(created.at(-1), null)
  await navigate('/?folder=parent'); await search('reuniao')
  assert.equal(host.querySelectorAll('h3').length, 1)
  assert.equal(host.querySelector('#notebooks-heading'), null, 'search prioritizes results')
  const input = host.querySelector<HTMLInputElement>('#library-search')!; input.focus()
  const row = host.querySelector('h3')
  host.scrollTop = 300
  hold = true
  await act(async () => { [...timers.values()].forEach(callback => callback()) })
  const started = calls
  await act(async () => { [...timers.values()].forEach(callback => callback()) })
  assert.equal(calls, started, 'no overlapping polls')
  assert.equal(host.querySelector('[aria-label="Carregando biblioteca"]'), null)
  hold = false
  await act(async () => { held!() })
  assert.equal(host.querySelector('h3'), row, 'refresh preserves row nodes')
  assert.equal(document.activeElement, input); assert.equal(input.value, 'reuniao'); assert.equal(host.scrollTop, 300)
  fail = true
  await act(async () => { window.dispatchEvent(new Event('nebula:sessions-changed')) })
  assert.ok(host.querySelector('[role="alert"]'))
  assert.equal(host.querySelector('h3'), row)
  fail = false
  await click(button('Tentar novamente'))
  assert.equal(host.querySelector('[role="alert"]'), null)
  await search('nonexistent'); assert.ok(text().includes('Nenhuma sessão encontrada'))
  await search(''); await navigate('/?folder=empty'); assert.ok(text().includes('Este caderno ainda está vazio'))
  await navigate('/?folder=unknown'); assert.ok(text().includes('Caderno indisponível')); assert.equal(button('Nova sessão'), undefined)
  await navigate('/'); await click(host.querySelector('summary'))
  const select = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.deepEqual(moves.at(-1), ['nested', { folderId: null }])
  data = []
  await act(async () => { window.dispatchEvent(new Event('nebula:sessions-changed')) })
  assert.ok(text().includes('Sua biblioteca ainda está vazia'))
  assert.equal(timers.size, 0, 'polling stops without pending work')
  // Exercise the actual palette and save request; no browser data is created.
  const saves: unknown[] = []
  folderApi.create = async update => { saves.push(update); return { folder: { ...folders[0], ...update } } }
  await act(async () => { root.render(<NotebookDialog target={{ parentId: 'parent' }} onClose={() => {}} />) })
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const name = dialog.querySelector<HTMLInputElement>('input')!
  await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(name, 'Subcaderno'); name.dispatchEvent(new Event('input', { bubbles: true })) })
  await click([...dialog.querySelectorAll('button')].find(item => item.textContent === 'Azul'))
  assert.equal(dialog.querySelectorAll('[aria-pressed="true"]').length, 1)
  await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  assert.deepEqual(saves, [{ name: 'Subcaderno', parentId: 'parent', color: 'blue' }])
  await act(async () => { document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  console.log('Library: scope, order, breadcrumbs, destination, conservative states, move action, palette, refresh/focus, errors and empty states passed')
} finally { await act(async () => root.unmount()); browser.happyDOM.abort() }
