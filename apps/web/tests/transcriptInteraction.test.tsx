import assert from 'node:assert/strict'
import { act } from 'react'
import { Window } from 'happy-dom'
import { SyncedTranscript } from '../src/components/SyncedTranscript'
import { transcripts, type TranscriptBlock } from '../src/api/client'
import { usePlaybackStore } from '../src/store/playback'
import { useDialogFocus } from '../src/hooks/useDialogFocus'

const browser = new Window({ url: 'http://localhost:5173' })
for (const [key, value] of Object.entries({
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
const { createRoot } = await import('react-dom/client')
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
globalThis.cancelAnimationFrame = id => { frames.delete(id) }
const flushFrames = async () => act(async () => {
  const pending = [...frames.values()]; frames.clear()
  pending.forEach(callback => callback(performance.now()))
})

// 2h20 of segments: enough to put the current audio far outside the viewport.
let blocks: TranscriptBlock[] = Array.from({ length: 840 }, (_, index) => ({
  id: `block-${index}`, chunkIndex: index, text: `Trecho ${index}: pauta da reunião`,
  timestampStart: index * 10_000, timestampEnd: (index + 1) * 10_000,
  speakerId: `SPEAKER_${index % 4}`, revision: 0,
}))
transcripts.list = async () => ({ transcripts: blocks, speakerNames: {} })
const edits: { id: string; text: string; revision: number }[][] = []
transcripts.edit = async (_id, changes) => { edits.push(changes); return { updated: changes.length } }
const host = document.createElement('div')
document.body.append(host)
const root = createRoot(host)
const sought: number[] = []
const props = { sessionId: 'test-session', transcriptionComplete: true, onSeekTo: (seconds: number) => { sought.push(seconds) } }
const render = async (extra = {}) => {
  await act(async () => { root.render(<SyncedTranscript {...props} {...extra} />) })
}
const click = async (element: Element | null) => {
  assert.ok(element, 'Expected the control to exist')
  await act(async () => { element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true })) })
}
const byText = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent === text)!
const follow = () => host.querySelector('[role="switch"][aria-label="Acompanhar transcrição"]')!
const scroll = () => host.querySelector<HTMLElement>('[aria-label="Trechos da transcrição"]')!

// Happy DOM has no layout engine. Give it scroll geometry and exercise the real
// component, events and effects; browser layout itself needs separate visual QA.
const installGeometry = () => {
  const container = scroll()
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 300 },
    clientTop: { configurable: true, value: 1 },
    scrollHeight: { configurable: true, get: () => Math.max(1000, blocks.length * 60) },
  })
  container.getBoundingClientRect = () => ({ top: 100, bottom: 400, height: 300 } as DOMRect)
  host.querySelectorAll<HTMLElement>('article').forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: 101 + index * 60 - container.scrollTop, height: 40 } as DOMRect)
  })
}
try {
  await render()
  installGeometry()
  await flushFrames()
  assert.equal(host.querySelector('input'), null, 'Search fields start collapsed')
  assert.equal(host.querySelectorAll('article').length, 840)
  assert.equal(scroll().scrollTop, 0, 'A completed transcript opens at the beginning before audio playback')
  assert.equal(follow().getAttribute('aria-checked'), 'true')

  await act(async () => usePlaybackStore.getState().setTime(4_200_000))
  await flushFrames()
  const current = host.querySelector<HTMLElement>('[data-active="true"]')!
  assert.equal(current.dataset.blockId, 'block-420')
  assert.ok(current.getBoundingClientRect().top >= 100 && current.getBoundingClientRect().top < 400, 'Current segment is visible')

  await click(follow())
  scroll().scrollTop = 0
  await act(async () => usePlaybackStore.getState().setTime(4_300_000))
  await flushFrames()
  assert.equal(scroll().scrollTop, 0, 'Off keeps the chosen reading position')
  await click(follow())
  await flushFrames()
  assert.ok(scroll().scrollTop > 20_000, 'On immediately returns to the current segment, even without a new clock tick')

  await act(async () => scroll().dispatchEvent(new browser.WheelEvent('wheel', { bubbles: true, deltaY: -100 })))
  assert.equal(follow().getAttribute('aria-checked'), 'false', 'Manual scrolling switches to free reading')
  scroll().scrollTop = 500
  await act(async () => usePlaybackStore.getState().setTime(4_400_000))
  await flushFrames()
  assert.equal(scroll().scrollTop, 500)

  await click(byText('Buscar e editar'))
  assert.ok(host.querySelector('input[placeholder="Buscar texto…"]'))
  const input = async (label: string, value: string) => {
    const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new browser.Event('input', { bubbles: true }))
    })
  }
  await input('Buscar na transcrição (diferencia maiúsculas)', 'Trecho 0:')
  await input('Substituir por', 'Abertura:')
  await click(host.querySelector('[aria-label="Próxima ocorrência"]'))
  assert.equal(sought[sought.length - 1], 0, 'First navigation selects the first match')
  assert.equal(follow().getAttribute('aria-checked'), 'false', 'Searching does not fight automatic scrolling')
  await click(byText('Revisar substituições'))
  assert.equal(edits.length, 0, 'Preview never writes changes')
  await click(byText('Confirmar substituição'))
  assert.equal(edits[0][0].text, 'Abertura: pauta da reunião')
  assert.equal(edits[0][0].revision, 0)
  const edit = host.querySelector('[aria-label="Editar trecho em 00:00:00"]')
  await click(edit)
  assert.ok(host.querySelector('textarea[aria-label="Texto do segmento"]'))
  await click(byText('Salvar'))
  assert.equal(edits[1][0].id, 'block-0')
  assert.equal(edits[1][0].revision, 0, 'Editing keeps the server revision contract')
  await click(byText('Fechar ferramentas'))
  assert.equal(host.querySelector('input'), null)

  // Incoming live text follows the tail; off stops it; on resumes immediately.
  blocks = []
  await act(async () => usePlaybackStore.getState().setTime(-1))
  await render({ sessionId: 'live-session', transcriptionComplete: false, liveText: [{ text: 'Ao vivo', timestamp_start_ms: 0 }] })
  installGeometry()
  await flushFrames()
  assert.equal(scroll().scrollTop, scroll().scrollHeight)
  await click(follow())
  scroll().scrollTop = 10
  await render({ sessionId: 'live-session', transcriptionComplete: false, liveText: [{ text: 'Novo trecho', timestamp_start_ms: 1000 }] })
  await flushFrames()
  assert.equal(scroll().scrollTop, 10)
  await click(follow())
  await flushFrames()
  assert.equal(scroll().scrollTop, scroll().scrollHeight)

  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  let dismissals = 0
  function Dialog() {
    const ref = useDialogFocus(() => { dismissals++ })
    return <div ref={ref} tabIndex={-1}><button>Primeiro</button><button>Último</button></div>
  }
  await act(async () => root.render(<Dialog />))
  const dialogButtons = host.querySelectorAll('button')
  assert.equal(document.activeElement, dialogButtons[0])
  dialogButtons[1].focus()
  document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  assert.equal(document.activeElement, dialogButtons[0], 'Tab stays inside the dialog')
  document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  assert.equal(document.activeElement, dialogButtons[1])
  document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(dismissals, 1)
  await act(async () => root.render(null))
  assert.equal(document.activeElement, trigger, 'Closing returns focus to the opener')
  trigger.remove()
  console.log('Transcrição: busca recolhível, edição e substituição com prévia, 2h20 de trechos, acompanhar on/off, retomada imediata e texto ao vivo verificados. Diálogos: foco, Tab e Escape verificados.')
} finally {
  await act(async () => root.unmount())
  await browser.happyDOM.close()
}
