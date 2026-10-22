import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { act, useEffect, useState } from 'react'
import { Window } from 'happy-dom'

// Exercise the pre-paint script independently of React, including unavailable storage.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1]
for (const [stored, expected] of [[null, 'dark'], ['invalid', 'dark'], ['light', 'light'], ['dark', 'dark'], ['throws', 'dark']]) {
  const element = { dataset: {} as Record<string,string>, style: {} as Record<string,string> }
  vm.runInNewContext(bootstrap, { document: { documentElement: element }, localStorage: { getItem: () => { if (stored === 'throws') throw Error('denied'); return stored } } })
  assert.equal(element.dataset.theme, expected)
  assert.equal(element.style.colorScheme, expected)
  assert.ok(element.style.background)
}
// Numerical contrast catches unreadable semantic combinations before visual QA.
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
const themes = [...css.matchAll(/(?:^|\n)(:root, \[data-theme='dark'\]|\[data-theme='light'\]) \{([\s\S]*?)\n\}/g)]
assert.equal(themes.length, 2)
for (const theme of themes) {
  const colors = Object.fromEntries([...theme[2].matchAll(/--([\w-]+): (\d+) (\d+) (\d+)/g)].map(match => [match[1], match.slice(2).map(Number)]))
  const pairs = ['primary', 'secondary', 'text-muted'].flatMap(text => ['canvas','sidebar','surface','muted','hover','selection'].map(background => [text,background]))
  pairs.push(['on-action','action'], ['on-action','action-hover'], ['danger-ink','danger-fill'])
  for (const palette of ['jade','amber','rose','blue','sky','orange']) pairs.push([palette + '-text',palette + '-surface'])
  for (const [text, background] of pairs) assert.ok(contrast(colors[text],colors[background]) >= 4.5, theme[1] + ': ' + text + '/' + background)
  for (const background of ['surface','muted']) assert.ok(contrast(colors['control-line'],colors[background]) >= 3, 'Control boundaries must remain visible')
}
const browser = new Window({ url: 'http://localhost:5173/sessions/capture' })
for (const [key,value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, getComputedStyle: browser.getComputedStyle.bind(browser), localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
browser.happyDOM.setWindowSize({ width: 1200, height: 900 })
document.documentElement.dataset.theme = 'dark'
const { createRoot } = await import('react-dom/client')
const { BrowserRouter, useNavigate, useLocation } = await import('react-router-dom')
const { useAppearanceStore } = await import('../src/store/appearance')
const { useAuthStore } = await import('../src/store/auth')
const { folders, sessions } = await import('../src/api/client')
const { Sidebar } = await import('../src/components/ui/Sidebar')
const { CaptureNavigationGuard } = await import('../src/components/CaptureNavigationGuard')
const { useDialogFocus } = await import('../src/hooks/useDialogFocus')
const { MenuSurface } = await import('../src/components/ui/MenuSurface')
const { getRecorder } = await import('../src/services/AudioRecorderService')
folders.list = async () => ({ folders: [] })
sessions.list = async () => ({ sessions: [] })
useAuthStore.getState().setUser({ id: 'owner', username: 'fixture', config: {} })
const recorder = getRecorder('capture', 'owner', async () => {})
recorder.usesBrowserTranscription = true
recorder.isActive = () => true
recorder.snapshot = { ...recorder.snapshot, state: 'recording' }
let mounts = 0
let navigate: ReturnType<typeof useNavigate>
let currentPath = ''
function Workspace() {
  const [draft, setDraft] = useState('Rascunho preservado')
  useEffect(() => { mounts++; return () => { mounts-- } }, [])
  return <textarea aria-label="Rascunho" value={draft} onChange={event => setDraft(event.target.value)} />
}
function Shell() {
  const collapsed = useAppearanceStore(state => state.collapsed)
  navigate = useNavigate(); currentPath = useLocation().pathname
  return <div className="nebula-shell" data-collapsed={collapsed}><CaptureNavigationGuard /><Sidebar /><main id="nebula-main"><Workspace /></main></div>
}
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const click = async (label: string) => {
  const target = host.querySelector<HTMLElement>('[aria-label="' + label + '"]')
  assert.ok(target, label)
  await act(async () => target.click())
}
try {
  await act(async () => root.render(<BrowserRouter><Shell /></BrowserRouter>))
  const draft = host.querySelector('textarea')
  const snapshot = recorder.snapshot
  await click('Ativar tema claro')
  assert.equal(document.documentElement.dataset.theme, 'light')
  assert.equal(localStorage.getItem('nebula:theme'), 'light')
  await click('Recolher navegação')
  assert.equal(localStorage.getItem('nebula:sidebar-collapsed'), 'true')
  assert.equal(host.querySelector('.nebula-shell')?.getAttribute('data-collapsed'), 'true')
  assert.equal(host.querySelector('textarea'), draft, 'Theme/collapse preserve the editor node')
  assert.equal(recorder.snapshot, snapshot, 'Theme/collapse never stop or restart capture')
  assert.equal(mounts, 1)
  await click('Expandir cadernos')
  assert.equal(localStorage.getItem('nebula:sidebar-collapsed'), 'false')

  let questions = 0
  browser.confirm = () => { questions++; return false }
  await act(async () => navigate!('/settings'))
  assert.equal(currentPath, '/sessions/capture', 'Declining departure keeps recognition mounted')
  assert.equal(questions, 1)
  browser.confirm = () => true
  await act(async () => navigate!('/settings'))
  assert.equal(currentPath, '/settings')
  assert.equal(recorder.snapshot, snapshot, 'Confirmed navigation does not stop audio')

  await act(async () => { browser.happyDOM.setWindowSize({ width: 390, height: 844 }); browser.dispatchEvent(new browser.Event('resize')) })
  const opener = host.querySelector<HTMLButtonElement>('[aria-label="Abrir navegação"]')!
  opener.focus()
  await click('Abrir navegação')
  assert.equal(host.querySelector('#nebula-navigation')?.getAttribute('data-mobile-open'), 'true')
  assert.equal((host.querySelector('main') as HTMLElement).inert, true)
  await act(async () => document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.equal(host.querySelector('#nebula-navigation')?.getAttribute('data-mobile-open'), 'false')
  assert.equal(document.activeElement, opener)
  assert.equal((host.querySelector('main') as HTMLElement).inert, false)
  assert.equal(document.body.style.overflow, '')
  await click('Abrir navegação')
  await click('Ativar tema escuro')
  assert.equal(document.documentElement.dataset.theme, 'dark', 'Theme control is available in mobile navigation')
  assert.equal(host.querySelector('textarea'), draft)
  // Concurrent overlays only dismiss the top layer and release the scroll lock last.
  await click('Fechar navegação')
  const outerTrigger = document.createElement('button'); document.body.append(outerTrigger); outerTrigger.focus()
  let outerClosed = 0; let innerClosed = 0
  function Layers({ inner }: { inner: boolean }) {
    const outer = useDialogFocus(() => { outerClosed++ })
    return <div ref={outer} tabIndex={-1}><button>Outer</button>{inner && <Inner />}</div>
  }
  function Inner() {
    const inner = useDialogFocus(() => { innerClosed++ })
    return <div ref={inner} tabIndex={-1}><button>Inner</button></div>
  }
  await act(async () => root.render(<Layers inner />))
  document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(innerClosed, 1); assert.equal(outerClosed, 0)
  await act(async () => root.render(<Layers inner={false} />))
  assert.equal(document.body.style.overflow, 'hidden')
  document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(outerClosed, 1)
  await act(async () => root.render(null))
  assert.equal(document.body.style.overflow, '')
  assert.equal(document.activeElement, outerTrigger, 'Closing nested overlays returns to the original opener')
  outerTrigger.remove()
  const menuTrigger = document.createElement('button'); document.body.append(menuTrigger); menuTrigger.focus()
  let menuClosed = false
  await act(async () => root.render(<MenuSurface label="Menu de teste" onClose={() => { menuClosed = true }}><button>One</button><button>Two</button></MenuSurface>))
  const menu = host.querySelector('[role="group"]')!
  menu.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
  assert.equal(document.activeElement?.textContent, 'Two')
  menu.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(menuClosed, true); assert.equal(document.activeElement, menuTrigger)
  menuTrigger.remove()
  console.log('Appearance/navigation: pre-paint defaults, denied storage, persistence, stable drafts/capture, guarded navigation and mobile Escape/focus verified.')
} finally {
  recorder.isActive = () => false
  await act(async () => root.unmount())
  await browser.happyDOM.close()
}
