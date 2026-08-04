/**
 * events/payloads.ts — Factory de payloads para eventos de pós-processamento.
 *
 * Centraliza a construção de cada payload para evitar espalhamento de dicts
 * avulsos pelo código. Quando um payload evoluir ou for tipado, a mudança
 * fica aqui e somente aqui.
 *
 * Nomenclatura Redis:
 *   PUBLISH session:status:<sessionId> '{"status":"<EVENT>", "payload": "<json>"}'
 */

// ── helper interno ────────────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

/** Remove chaves com valor undefined/null e retorna o objeto limpo. */
function build(data: Payload): Payload {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined && v !== null),
  );
}


// ── pós-processamento (LLM) ───────────────────────────────────────────────────

export function documentGenerating(
  triggeredBy: string = "session_end",
  version?: number,
): Payload {
  return build({ triggeredBy, version });
}

export function documentReady(
  version: number,
  chars: number,
  tokens: number,
  modelId: string,
): Payload {
  return build({ version, chars, tokens, modelId });
}

export function documentFailed(reason: string, version?: number): Payload {
  return build({ reason, version });
}

export function documentSkipped(reason: string): Payload {
  return build({ reason });
}