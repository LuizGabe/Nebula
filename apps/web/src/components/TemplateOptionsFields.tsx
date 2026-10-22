import type { TemplateOptions } from '../utils/templates'
import { Segmented } from './ui/Segmented'
import { Toggle } from './ui/Toggle'

export function TemplateOptionsFields({ value, onChange }: { value: TemplateOptions; onChange: <K extends keyof TemplateOptions>(key: K, value: TemplateOptions[K]) => void }) {
  return <div className="space-y-5">
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Estilo</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-secondary">Formalidade</p>
          <Segmented value={value.formality} options={[{ value: 'informal', label: 'Informal' }, { value: 'neutral', label: 'Neutra' }, { value: 'formal', label: 'Formal' }]} onChange={next => onChange('formality', next)} />
        </div>
        <div>
          <p className="mb-1 text-xs text-secondary">Detalhamento</p>
          <Segmented value={value.detailLevel} options={[{ value: 'concise', label: 'Conciso' }, { value: 'balanced', label: 'Equilibrado' }, { value: 'detailed', label: 'Detalhado' }]} onChange={next => onChange('detailLevel', next)} />
        </div>
      </div>
    </fieldset>
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Estrutura</legend>
      <div className="grid gap-2 sm:grid-cols-2">{([
        ['useTitle', 'Título principal'], ['useHeadings', 'Seções'], ['useSubheadings', 'Subseções'], ['preferLists', 'Preferir listas'], ['preferTables', 'Preferir tabelas'],
      ] as const).map(([key, label]) => <Toggle key={key} label={label} checked={value[key]} onChange={next => onChange(key, next)} />)}</div>
    </fieldset>
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Referências de áudio</legend>
      <Toggle label="Referenciar momentos do áudio" checked={value.includeAudioCitations} onChange={next => onChange('includeAudioCitations', next)} />
    </fieldset>
    <label className="block text-sm">Tipo de transcrição<select value={value.transcriptionMode} onChange={event => onChange('transcriptionMode', event.target.value as TemplateOptions['transcriptionMode'])} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface p-2 text-primary">
      <option value="MEETING">Reunião</option>
      <option value="CLASS">Aula</option>
    </select>
    </label>
  </div>
}
