import assert from "node:assert/strict";

import {
  buildDocumentGenerationMessages,
  resolveDocumentGenerationConfig,
} from "../src/lib/prompts";

const template = {
  name: "Ata executiva",
  description: "Template de reuniao",
  instructions: "Priorize decisoes e proximos passos.",
  formality: "formal",
  detailLevel: "balanced",
  useTitle: true,
  useHeadings: true,
  useSubheadings: true,
  preferLists: true,
  preferTables: false,
  includeAudioCitations: true,
  transcriptionMode: "MEETING",
};

{
  const config = resolveDocumentGenerationConfig(template, {
    includeAudioCitationsOverride: null,
  });

  assert.equal(config.includeAudioCitations, true);
}

{
  const config = resolveDocumentGenerationConfig(template, {
    detailLevelOverride: "detailed",
    includeAudioCitationsOverride: false,
  });

  assert.equal(config.detailLevel, "detailed");
  assert.equal(config.includeAudioCitations, false);
}

{
  const messages = buildDocumentGenerationMessages({
    template,
    session: {
      title: "Planejamento Q3",
      sessionContext: "Cliente XPTO. Phoenix e o nome interno do produto.",
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
    },
    transcript: "[audio:00:00] Discutimos cronograma.\n[audio:00:12] Ana ficou com o orcamento.",
  });

  const joined = messages.map((message) => message.content).join("\n");

  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(joined, /Markdown valido/);
  assert.match(joined, /Discutimos cronograma/);
  assert.match(joined, /Cliente XPTO/);
  assert.match(joined, /Formality: formal/);
  assert.match(joined, /Use apenas identificadores/);
  assert.doesNotMatch(joined, /\{\{transcricao\}\}/);
  assert.doesNotMatch(joined, /availableVariables/);
}

{
  const messages = buildDocumentGenerationMessages({
    template,
    session: { includeAudioCitationsOverride: false },
    transcript: "[audio:00:00] Texto.",
  });

  assert.match(messages[0].content, /Nao inclua timestamps/);
}

console.log("documentGeneration tests passed");
