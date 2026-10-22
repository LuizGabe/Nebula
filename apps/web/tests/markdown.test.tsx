import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AudioLinkedText } from '../src/components/AudioLinkedText'

function render(content: string) {
  return renderToStaticMarkup(<AudioLinkedText content={content} />)
}
const table = render(`| Item | Valor | Referência |
| :--- | ---: | :---: |
| **Plano** | 42 | [audio:01:23] |
| a\\|b | ~~antigo~~ | [site](https://example.com) |`)
assert.match(table, /<table>/)
assert.match(table, /text-align:right/)
assert.match(table, /text-align:center/)
assert.match(table, /<strong>Plano<\/strong>/)
assert.match(table, /a\|b/)
assert.match(table, /<del>antigo<\/del>/)
assert.equal((table.match(/<button/g) ?? []).length, 1)
assert.match(table, /Tocar em 01:23/)
assert.match(table, /href="https:\/\/example.com"/)
const inlineReference = render('Antes *Referência:* `[audio:01:53]` a `[audio:07:44]` depois.')
assert.equal((inlineReference.match(/<button/g) ?? []).length, 2)
assert.match(inlineReference, /Tocar em 01:53/)
assert.match(inlineReference, /Tocar em 07:44/)
assert.equal((render('| Referência |\n| --- |\n| `[audio:08:12]` |').match(/<button/g) ?? []).length, 1)
const code = render('`exemplo [audio:01:23]`\n\n```ts\n[audio:01:23]\n```')
assert.doesNotMatch(code, /<button/)
assert.match(code, /<pre><code class="language-ts">/)
const nested = render('**Antes [audio:01:23] depois**\n\n- [x] Feito\n- [ ] Pendente\n\n3. Terceiro')
assert.equal((nested.match(/<button/g) ?? []).length, 1)
assert.match(nested, /type="checkbox"/)
assert.match(nested, /checked=""/)
assert.match(nested, /<ol start="3">/)
assert.doesNotMatch(render('[ouvir [audio:01:23]](https://example.com)'), /<button/)
assert.doesNotMatch(render('<script>alert(1)</script>\n\n[x](javascript:alert%281%29)'), /<script>|href="javascript:/)
console.log('Markdown: tabelas, alinhamento, GFM, timestamps, código, listas e segurança verificados.')
