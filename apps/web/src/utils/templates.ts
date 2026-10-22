import type { Prompt, Session } from '../api/client'
export const originLabel = (prompt: Prompt) => ({ platform: 'Da plataforma', own: 'Meus templates', shared: 'Compartilhados', legacy: 'Legado sem proprietário · somente leitura' }[prompt.origin ?? 'legacy'])
export const overrideKeys = ['instructionsOverride', 'formalityOverride', 'detailLevelOverride', 'useTitleOverride', 'useHeadingsOverride', 'useSubheadingsOverride', 'preferListsOverride', 'preferTablesOverride', 'includeAudioCitationsOverride', 'transcriptionModeOverride'] as const
export type SessionOverrides = Pick<Session, typeof overrideKeys[number]>
export const emptyOverrides: SessionOverrides = { instructionsOverride: null, formalityOverride: null, detailLevelOverride: null, useTitleOverride: null, useHeadingsOverride: null, useSubheadingsOverride: null, preferListsOverride: null, preferTablesOverride: null, includeAudioCitationsOverride: null, transcriptionModeOverride: null }
export const hasOverrides = (value: Partial<SessionOverrides>) => overrideKeys.some(key => value[key] !== null && value[key] !== undefined)
export type TemplateOptions = Pick<Prompt, 'formality' | 'detailLevel' | 'transcriptionMode' | 'useTitle' | 'useHeadings' | 'useSubheadings' | 'preferLists' | 'preferTables' | 'includeAudioCitations'>
export const defaultOptions: TemplateOptions = { formality: 'neutral', detailLevel: 'balanced', transcriptionMode: 'MEETING', useTitle: true, useHeadings: true, useSubheadings: true, preferLists: true, preferTables: false, includeAudioCitations: true }
export function effectiveOptions(template: Prompt | undefined, overrides: SessionOverrides): TemplateOptions {
  const values = { ...defaultOptions }
  for (const key of Object.keys(values) as (keyof TemplateOptions)[]) {
    Object.assign(values, { [key]: overrides[`${key}Override` as keyof SessionOverrides] ?? template?.[key] ?? defaultOptions[key] })
  }
  return values
}
