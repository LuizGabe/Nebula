import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExportService, subtitleCues } from '../src/lib/ExportService';
import { validateInsights } from '../src/lib/insights';

const blocks = [{ id: 's1', text: 'Olá mundo. Ação com responsável.', timestampStart: 1500, timestampEnd: 6500, speakerId: 'SPEAKER_00', words: [
  { text: 'Olá', start_ms: 1500, end_ms: 2000, confidence: 0.9 },
  { text: 'mundo.', start_ms: 2200, end_ms: 3000, confidence: 0.8 },
] }];
test('exports preserve integer timing and speaker names in all seven formats', async () => {
  for (const format of ['srt','vtt','pdf','docx','json','md','txt'] as const) {
    const result = await ExportService.compile({ title: 'Reunião', blocks, speakerNames: { SPEAKER_00: 'Carlos' } }, format);
    assert.ok(result.data.length > 20);
    if (format === 'srt') assert.match(result.data.toString(), /00:00:01,500 --> 00:00:03,000/);
    if (format === 'vtt') assert.ok(result.data.toString().startsWith('WEBVTT'));
    if (format === 'pdf') assert.equal(result.data.subarray(0,4).toString(), '%PDF');
    if (format === 'docx') assert.equal(result.data.subarray(0,2).toString(), 'PK');
    if (format === 'json') { const data = JSON.parse(result.data.toString()); assert.equal(data.timeUnit, 'ms'); assert.equal(data.segments[0].words[0].start_ms, 1500) }
    if (format === 'md' || format === 'txt') assert.match(result.data.toString(), /Carlos/);
  }
});
test('legacy and edited subtitles have at most two lines of 42 characters, finite positive timing', () => {
  const cues = subtitleCues([{ ...blocks[0], edited: true, text: 'palavra '.repeat(100), timestampEnd: 50000 }]);
  for(const cue of cues) {
    assert.ok(cue.end > cue.start && cue.end - cue.start <= 6000);
    assert.ok(cue.text.split('\n').length <= 2);
    assert.ok(cue.text.split('\n').every(line => line.length <= 42));
  }
});
test('insights reject missing source references and invalid model output', () => {
  const valid = { summary: ['Resumo'], actionItems: [{ text: 'Enviar relatório', owner: null, dueDate: null, transcriptReferenceId: 's1' }], tags: ['reunião'], sentiment: 'neutral' };
  assert.equal(validateInsights(JSON.stringify(valid), blocks).actionItems[0].owner, null);
  assert.throws(() => validateInsights(JSON.stringify({ ...valid, actionItems: [{ ...valid.actionItems[0], transcriptReferenceId: 'inventado' }] }), blocks), /referência inexistente/);
  assert.throws(() => validateInsights('{}', blocks));
  assert.throws(() => validateInsights('texto inválido', blocks));
});
