import assert from 'node:assert/strict'
import { act } from 'react'
import { Window } from 'happy-dom'
import type { Prompt } from '../src/api/client'
const browser = new Window({url:'http://localhost:5173/settings?section=templates'})
for(const [key,value] of Object.entries({window:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,Element:browser.Element,Event:browser.Event,CustomEvent:browser.CustomEvent,getComputedStyle:browser.getComputedStyle.bind(browser),IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})
const {createRoot}=await import('react-dom/client')
const {BrowserRouter,Routes,Route,useNavigate,useLocation}=await import('react-router-dom')
const {SettingsPage}=await import('../src/pages/Settings')
const {prompts,llm}=await import('../src/api/client')
const {defaultOptions}=await import('../src/utils/templates')
const {useAuthStore}=await import('../src/store/auth')
useAuthStore.getState().setUser({id:'owner',username:'qa',config:{}})
llm.models=async()=>({models:[]})
llm.status=(()=>({addEventListener(){},close(){}})) as typeof llm.status
const readonly={canUse:true,canDuplicate:true,canSetDefault:true,canEdit:false,canDelete:false}
let list=[
 {...defaultOptions,id:'native',name:'Nativo',description:'Da plataforma',instructions:'Platform instructions',origin:'platform',isDefault:true,isPublic:true,capabilities:readonly},
 {...defaultOptions,id:'own',name:'Meu template',description:'Próprio',instructions:'Own instructions',origin:'own',isPublic:false,capabilities:{...readonly,canEdit:true,canDelete:true}},
 {...defaultOptions,id:'shared',name:'Terceiro',description:'Compartilhado',instructions:'Shared instructions',origin:'shared',isPublic:true,capabilities:readonly},
] as Prompt[]
let failed=false,failList=false
prompts.list=async()=>{if(failList)throw Error('offline');return{prompts:[...list]}}
const defaults:string[]=[],saves:any[]=[],duplicates:string[]=[],deletes:string[]=[]
prompts.setDefault=async id=>{defaults.push(id!);list=list.map(item=>({...item,isDefault:item.id===id}));return{defaultPromptId:id}}
prompts.update=async(id,data)=>{saves.push([id,data]);if(failed)throw Error('Falha ao salvar');list=list.map(item=>item.id===id?{...item,...data} as Prompt:item);return{prompt:list.find(item=>item.id===id)!}}
prompts.create=async data=>{throw Error('not needed')}
prompts.duplicate=async id=>{duplicates.push(id);const copy={...list.find(item=>item.id===id)!,id:`copy-${duplicates.length}`,name:'Cópia',origin:'own' as const,isPublic:false,capabilities:{...readonly,canEdit:true,canDelete:true}};list.push(copy);return{prompt:copy}}
prompts.delete=async id=>{deletes.push(id);list=list.filter(item=>item.id!==id)}
const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
let navigate:ReturnType<typeof useNavigate>,path=''
function Probe(){navigate=useNavigate();path=useLocation().pathname+useLocation().search;return null}
const render=async()=>act(async()=>{root.render(<BrowserRouter><Probe/><Routes><Route path="/settings" element={<SettingsPage/>}/><Route path="/other" element={<p>Outside</p>}/></Routes></BrowserRouter>)})
const text=()=>document.body.textContent??''
const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===name)
const template=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('aside[aria-label="Templates disponíveis"] button')].find(item=>item.textContent?.startsWith(name))
const click=async(element:Element|null|undefined)=>{assert.ok(element);await act(async()=>{element.dispatchEvent(new browser.MouseEvent('click',{bubbles:true}))})}
const fill=async(label:string,value:string)=>{const field=[...document.querySelectorAll('label')].find(item=>item.textContent?.startsWith(label))!.querySelector<HTMLInputElement|HTMLTextAreaElement>('input,textarea')!;await act(async()=>{const proto=field.tagName==='TEXTAREA'?browser.HTMLTextAreaElement.prototype:browser.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}))})}
try{
 await render();assert.ok(text().includes('Da plataforma'));assert.ok(text().includes('Meus templates'));assert.ok(text().includes('Compartilhados'))
 await click(template('Nativo'));assert.ok(text().includes('Template somente leitura'));assert.equal(button('Excluir'),undefined);assert.equal(button('Salvar template'),undefined)
 await click(template('Terceiro'));assert.equal(button('Excluir'),undefined)
 await click(button('Usar como padrão'));assert.equal(defaults.at(-1),'shared')
 await click(button('Duplicar'));assert.equal(duplicates.at(-1),'shared');assert.ok(button('Salvar template'))
 await act(async()=>{navigate('/settings?section=docs')});await act(async()=>{navigate('/settings?section=templates')})
 await click(template('Meu template'));await fill('Nome','Meu rascunho')
 const beforeBack=path
 await act(async()=>{window.history.back();await new Promise(resolve=>setTimeout(resolve,20))})
 assert.ok(text().includes('Descartar alterações?'));assert.equal(path,beforeBack)
 await click(button('Cancelar'));assert.equal((document.querySelector('input') as HTMLInputElement).value,'Meu rascunho')
 await click(template('Nativo'));assert.ok(text().includes('Descartar alterações?'));await click(button('Cancelar'));assert.equal((document.querySelector('input') as HTMLInputElement).value,'Meu rascunho')
 await click(button('Modelo'));assert.ok(text().includes('Descartar alterações?'));await click(button('Cancelar'));assert.ok(path.includes('section=templates'))
 await act(async()=>{navigate('/other')});assert.ok(text().includes('Descartar alterações?'));await click(button('Cancelar'));assert.ok(path.startsWith('/settings'))
 failed=true;await act(async()=>{document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});assert.ok(text().includes('Falha ao salvar'));assert.equal((document.querySelector('input') as HTMLInputElement).value,'Meu rascunho')
 failed=false;await act(async()=>{document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});assert.equal(saves.at(-1)[1].name,'Meu rascunho');assert.ok(!text().includes('Alterações não salvas'))
 await click(button('Excluir'));assert.ok(text().includes('Excluir template?'));assert.ok(text().includes('vínculos existentes serão preservados'));await click(button('Cancelar'));assert.equal(deletes.length,0)
 await fill('Descrição','Alteração não salva');await click(button('Guia'));await click(button('Descartar alterações'));assert.ok(path.includes('section=docs'))
 await act(async()=>{navigate('/settings?section=templates')});await click(template('Nativo'));await click(button('Duplicar'));assert.equal(duplicates.at(-1),'native')
 await fill('Nome','Outro rascunho');await act(async()=>{navigate('/other')});await click(button('Descartar alterações'));assert.equal(path,'/other');assert.ok(text().includes('Outside'))
 failList=true;await act(async()=>{navigate('/settings?section=templates')});assert.ok(text().includes('Não foi possível carregar os templates'));failList=false;await click(button('Tentar novamente'));assert.ok(template('Nativo'))
 console.log('Management: effective capabilities, personal default, duplication, unsaved template/section/navigation guards, failed-save draft, deletion dialog and load retry passed')
}finally{await act(async()=>root.unmount());browser.happyDOM.abort()}
