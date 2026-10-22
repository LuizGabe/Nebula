import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer, PageNumber } from 'docx';
import { parseWords, type TranscriptWord } from '@/lib/transcriptWords';

export type ExportFormat = 'srt' | 'vtt' | 'pdf' | 'docx' | 'json' | 'md' | 'txt';
export interface ExportBlock { id: string; text: string; timestampStart: number; timestampEnd: number; words?: unknown; speakerId?: string | null; edited?: boolean }
interface ExportInput { title: string; blocks: ExportBlock[]; speakerNames: Record<string, string> }
const timestamp = (ms: number, comma = false) => {
  const rounded = Math.max(0, Math.round(ms));
  return [Math.floor(rounded / 3600000), Math.floor(rounded / 60000) % 60, Math.floor(rounded / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':') + (comma ? ',' : '.') + String(rounded % 1000).padStart(3, '0');
};
const label = (b: ExportBlock, names: Record<string, string>) => b.speakerId ? names[b.speakerId] ?? `Palestrante ${Number(b.speakerId.replace('SPEAKER_', '')) + 1}` : '';
function wrap(text: string, limit = 42) {
  const lines: string[] = []; let line = '';
  for (const token of text.trim().split(/\s+/)) {
    for (let offset = 0; offset < token.length; offset += limit) {
      const word = token.slice(offset, offset + limit);
      if (line && line.length + 1 + word.length > limit) { lines.push(line); line = '' }
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
export function subtitleCues(blocks: ExportBlock[]) {
  const cues: { text: string; start: number; end: number }[] = [];
  for (const block of blocks) {
    const words = !block.edited ? parseWords(block.words) : [];
    if (words.length && words.every(w => w.end_ms > w.start_ms)) {
      let group: TranscriptWord[] = [];
      const flush = () => { if (group.length) cues.push({ text: wrap(group.map(w => w.text.trim()).join(' ')).join('\n'), start: group[0].start_ms, end: group[group.length - 1].end_ms }); group = [] };
      for (const word of words) {
        const next = [...group, word];
        if (group.length && (wrap(next.map(w => w.text.trim()).join(' ')).length > 2 || word.end_ms - group[0].start_ms > 6000)) flush();
        group.push(word);
      }
      flush();
    } else {
      const lines = wrap(block.text);
      const groups = Math.ceil(lines.length / 2);
      const total = Math.max(1, Math.round(block.timestampEnd - block.timestampStart));
      // Legacy/edited text has only segment timing: preserve it proportionally.
      for (let i = 0; i < groups; i++) cues.push({ text: lines.slice(i * 2, i * 2 + 2).join('\n'), start: Math.round(block.timestampStart + total * i / groups), end: Math.round(block.timestampStart + total * (i + 1) / groups) });
    }
  }
  return cues.sort((a,b) => a.start - b.start).map((cue, i, all) => {
    const next = all[i + 1]?.start;
    // Prefer 1–6 seconds without extending into a following cue.
    const end = Math.min(cue.start + 6000, Math.max(cue.end, cue.start + 1000), next != null && next > cue.start ? next : Infinity);
    return { ...cue, end: Math.max(cue.start + 1, end) };
  });
}
export class ExportService {
  static async compile(input: ExportInput, format: ExportFormat): Promise<{ data: Buffer; mimeType: string; extension: string }> {
    const { title, blocks, speakerNames } = input;
    let content = ''; let mimeType = 'text/plain; charset=utf-8'; let extension: string = format;
    if (format === 'json') {
      content = JSON.stringify({ schemaVersion: 1, timeUnit: 'ms', title, speakerNames, segments: blocks.map(b => ({ ...b, timestampStart: Math.round(b.timestampStart), timestampEnd: Math.round(b.timestampEnd), words: parseWords(b.words) })) }, null, 2);
      mimeType = 'application/json';
    } else if (format === 'srt' || format === 'vtt') {
      content = (format === 'vtt' ? 'WEBVTT\n\n' : '') + subtitleCues(blocks).map((c,i) => `${i + 1}\n${timestamp(c.start, format === 'srt')} --> ${timestamp(c.end, format === 'srt')}\n${format === 'vtt' ? c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : c.text}\n`).join('\n');
      mimeType = format === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8';
    } else if (format === 'docx') {
      const doc = new Document({ title, creator: 'Nebula', sections: [{
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: ['Nebula · ', PageNumber.CURRENT] })] })] }) },
        children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...blocks.flatMap(b => [
          new Paragraph({ text: [timestamp(b.timestampStart).slice(0,-4), label(b,speakerNames)].filter(Boolean).join(' · '), heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: b.text, spacing: { after: 180 } }),
        ])],
      }] });
      return { data: await Packer.toBuffer(doc), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' };
    } else if (format === 'pdf') {
      const doc = new PDFDocument({ margin: 48, size: 'A4', info: { Title: title, Author: 'Nebula' }, bufferPages: true });
      const chunks: Buffer[] = [];
      const completed = new Promise<Buffer>((resolve,reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject) });
      doc.font('Helvetica-Bold').fontSize(22).text(title); doc.moveDown();
      for (const block of blocks) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#23846a').text([timestamp(block.timestampStart).slice(0,-4),label(block,speakerNames)].filter(Boolean).join(' · '));
        doc.moveDown(0.3); doc.font('Helvetica').fontSize(11).fillColor('#24332f').text(block.text, { lineGap: 4 }); doc.moveDown();
      }
      const range = doc.bufferedPageRange();
      for(let i = range.start; i < range.start + range.count; i++) { doc.switchToPage(i); doc.fontSize(9).fillColor('#6b7280').text(`Nebula · ${i + 1}`,48,doc.page.height - 36,{lineBreak:false}) }
      doc.end(); return { data: await completed, mimeType: 'application/pdf', extension: 'pdf' };
    } else {
      content = (format === 'md' ? '# ' : '') + title + '\n\n' + blocks.map(b => {
        const heading = [timestamp(b.timestampStart).slice(0,-4),label(b,speakerNames)].filter(Boolean).join(' · ');
        return (format === 'md' ? '## ' : '') + heading + '\n\n' + b.text;
      }).join('\n\n');
      if (format === 'md') mimeType = 'text/markdown; charset=utf-8';
    }
    return { data: Buffer.from(content, 'utf8'), mimeType, extension };
  }
}
