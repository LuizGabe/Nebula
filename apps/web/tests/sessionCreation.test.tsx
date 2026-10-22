import assert from 'node:assert/strict'
import { act } from 'react'
import { Window } from 'happy-dom'
import type { Folder, Prompt, Session } from '../src/api/client'
const browser = new Window({ url: 'http://localhost:5173' })
for (const [key,value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Element: browser.Element, Event: browser.Event, CustomEvent: browser.CustomEvent, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis,key,{ configurable:true,writable:true,value })
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const { NewSessionModal } = await import('../src/components/NewSessionModal')
const { sessions, prompts, folders, ApiError } = await import('../src/api/client')
const { defaultOptions } = await import('../src/utils/templates')
const capabilities = { canUse:true,canEdit:false,canDelete:false,canDuplicate:true,canSetDefault:true }
let templates = [
  { ...defaultOptions,id:'a',name:'Ata',instructions:'Template A',description:'Decisões e ações',origin:'platform',isDefault:true,capabilities },
  { ...defaultOptions,id:'b',name:'Aula',instructions:'Template B',description:'Material de estudo',origin:'shared',formality:'formal',preferTables:true,capabilities },
] as Prompt[]
let templateFailure = false, folderFailure = false
prompts.list = async () => { if(templateFailure) throw Error('templates offline'); return {prompts:templates,defaultPromptId:'a'} }
folders.list = async () => { if(folderFailure) throw Error('folders offline'); return {folders:[{id:'parent',name:'Trabalho',parentId:null},{id:'child',name:'Cliente',parentId:'parent',color:'blue'}] as Folder[]} }
sessions.creationOptions = async () => ({youtubeMaxDurationMinutes:45})
let failure: Error | null = null, release: (()=>void) | null = null, hold = false
const payloads: any[] = [], created: any[] = [], opened: string[] = []
let closed = 0
sessions.create = async payload => { payloads.push(payload); if(hold) await new Promise<void>(resolve=>{release=resolve}); if(failure) throw failure; return {session:{id:'saved'} as Session} }
const host = document.createElement('div');document.body.append(host)
const root = createRoot(host)
let instance = 0
const props = { initialFolderId:'child',onClose:()=>{closed++},onCreate:(session:Session,source:string)=>{created.push([session.id,source])},onOpenSession:(id:string)=>opened.push(id),onManageTemplates:()=>{} }
const render = async (suspended=false) => act(async()=>{root.render(<MemoryRouter><NewSessionModal key={instance} {...props} suspended={suspended}/></MemoryRouter>)})
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
const button = (label:string) => buttons().filter(item=>item.textContent?.trim()===label).at(-1)
const click = async (element:Element|null|undefined) => {assert.ok(element); await act(async()=>{element.dispatchEvent(new browser.MouseEvent('click',{bubbles:true}))})}
const field = (label:string) => [...document.querySelectorAll('label')].find(item=>item.textContent?.startsWith(label))?.querySelector<HTMLInputElement|HTMLTextAreaElement>('input,textarea')!
const fill = async (input:HTMLInputElement|HTMLTextAreaElement,value:string) => {assert.ok(input);await act(async()=>{const proto=input.tagName==='TEXTAREA'?browser.HTMLTextAreaElement.prototype:browser.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
const selectTemplate = async (id:string) => act(async()=>{const select=document.getElementById('new-session-template') as HTMLSelectElement;select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}))})
const submit = async () => act(async()=>{document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
const text=()=>document.body.textContent??''
try {
  await render()
  assert.equal((document.getElementById('new-session-folder') as HTMLSelectElement).value,'child')
  assert.equal((document.getElementById('new-session-template') as HTMLSelectElement).value,'a')
  assert.ok(text().includes('Trabalho / Cliente')); assert.ok(button('Continuar para gravação'))
  assert.equal(document.querySelectorAll('details[open]').length,0)
  await fill(field('Título'),'Rascunho importante')
  await fill(field('Instruções específicas'),'Mantenha estas instruções')
  await selectTemplate('b'); assert.ok(text().includes('Trocar template?'))
  await click(button('Cancelar')); assert.equal((document.getElementById('new-session-template') as HTMLSelectElement).value,'a')
  assert.equal(field('Instruções específicas').value,'Mantenha estas instruções')
  await selectTemplate('b'); await click(button('Manter ajustes'))
  assert.equal(field('Instruções específicas').value,'Mantenha estas instruções')
  assert.equal((document.querySelector('select:not([id])') as HTMLSelectElement).value,'MEETING')
  await selectTemplate('a'); await click(button('Usar valores do novo template'))
  assert.equal(field('Instruções específicas').value,'')
  await selectTemplate('b'); assert.ok(!text().includes('Trocar template?'),'no overrides switches directly')
  await fill(field('Instruções específicas'),'Draft retained')
  await render(true); assert.equal(Boolean(document.querySelector('[role="dialog"]')),false)
  let logoutCalls=0
  const logout=document.createElement('button');logout.setAttribute('aria-label','Sair');logout.textContent='Sair';logout.addEventListener('click',()=>{logoutCalls++});document.body.append(logout)
  await click(logout);assert.ok(text().includes('Descartar alterações?'));assert.equal(logoutCalls,0);await click(button('Cancelar'))
  await click(logout);await click(button('Descartar alterações'));assert.equal(logoutCalls,1,'suspended draft also guards logout without recursive confirmation');logout.remove()
  templates=templates.map(item=>({...item,description:'Atualizado no gerenciamento'}))
  await render(false)
  assert.equal(field('Título').value,'Rascunho importante');assert.equal(field('Instruções específicas').value,'Draft retained')
  assert.equal((document.getElementById('new-session-template') as HTMLSelectElement).value,'b')
  assert.ok(text().includes('Atualizado no gerenciamento'))
  await click(button('Cancelar'));assert.equal(closed,0);assert.ok(text().includes('Descartar alterações?'))
  await click(button('Cancelar'));assert.equal(field('Título').value,'Rascunho importante')
  failure=new Error('Falha de criação');await submit();assert.ok(text().includes('Falha de criação'));assert.equal(field('Título').value,'Rascunho importante')
  failure=null;hold=true;await submit();const count=payloads.length
  await submit();assert.equal(payloads.length,count,'synchronous submission lock prevents duplicates')
  await act(async()=>{document.dispatchEvent(new browser.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))})
  assert.equal(closed,0); assert.equal(document.querySelector('fieldset')!.disabled,true)
  hold=false;await act(async()=>{release!()})
  assert.deepEqual(created.at(-1),['saved','microphone'])
  assert.equal(payloads.at(-1).folderId,'child');assert.equal(payloads.at(-1).formalityOverride,null,'keep preserves only explicit overrides')
  instance++;await render();await click(button('Arquivo'));await submit();assert.deepEqual(created.at(-1),['saved','upload'])
  instance++;await render();await click(button('YouTube'));assert.ok(text().includes('45 minutos'))
  await fill(field('Link do vídeo'),'https://evil.test/video');const before=payloads.length;await submit();assert.equal(payloads.length,before)
  await fill(field('Link do vídeo'),'https://youtu.be/jNQXAC9IVRw?t=2');failure=new ApiError('Importação falhou',503,'created-before-error');await submit()
  assert.ok(button('Abrir sessão existente'));assert.equal(payloads.at(-1).youtubeUrl,'https://www.youtube.com/watch?v=jNQXAC9IVRw')
  await submit();assert.equal(payloads.length,before+1,'an existing failed import is never resubmitted')
  await click(button('Abrir sessão existente'));assert.equal(opened.at(-1),'created-before-error')
  failure=null;instance++;await render();await click(button('YouTube'));await fill(field('Link do vídeo'),'https://youtu.be/jNQXAC9IVRw');await submit();assert.deepEqual(created.at(-1),['saved','youtube'])
  failure=null;instance++;folderFailure=true;templateFailure=true;await render();await fill(field('Título'),'Preservar erros')
  assert.ok(text().includes('Não foi possível carregar os templates'));assert.equal((document.getElementById('new-session-folder') as HTMLSelectElement).value,'child')
  folderFailure=false;templateFailure=false;await click(button('Tentar carregar novamente'));assert.equal(field('Título').value,'Preservar erros')
  const usableTemplates=templates
  instance++;templates=[];await render();assert.ok(text().includes('Nenhum template disponível'));assert.equal(button('Continuar para gravação')!.disabled,true)
  templates=usableTemplates;folders.list=async()=>({folders:[]});instance++;await render();assert.ok(text().includes('O caderno recebido não está disponível'));assert.equal(button('Continuar para gravação')!.disabled,true)
  console.log('Creation: inherited destination/default, three override-switch choices, suspended draft, retries, submission lock, pending close protection, source flows and existing failed import passed')
} finally {await act(async()=>root.unmount());browser.happyDOM.abort()}
