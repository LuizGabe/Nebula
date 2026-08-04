/**
 * events/publisher.ts — Emissão centralizada de eventos de sessão.
 *
 * Cada evento é:
 *   1. Inserido na tabela SessionEvent via Prisma
 *   2. Publicado via Redis pub/sub no canal session:status:<sessionId>
 *
 * Formato do canal:
 *   PUBLISH session:status:<sessionId> '{"status":"<EVENT>", "payload":"<json>"}'
 *
 * O campo `payload` é serializado duas vezes (string JSON dentro do JSON)
 * para manter compatibilidade com o contrato do frontend.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ATENÇÃO: a dupla escrita (banco + Redis) é intencional e temporária.
 * Para centralizar a persistência em outro serviço, substitua somente o
 * método _persist() sem alterar nenhum outro módulo.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Redis, type Redis as RedisInterface } from "ioredis";

import { prisma } from "@/lib/prisma";
import { config } from "@/config";


// ── tipos ─────────────────────────────────────────────────────────────────────

export type EventType =
  | "DOCUMENT_GENERATING"
  | "DOCUMENT_READY"
  | "DOCUMENT_SKIPPED"
  | "DOCUMENT_FAILED"

type Payload = Record<string, unknown>;


// ── publisher ─────────────────────────────────────────────────────────────────

export class EventPublisher {
  private readonly redis: RedisInterface;

  constructor(redis: RedisInterface) {
    this.redis = redis;
  }

  /**
   * Emite um evento: persiste no banco E publica no Redis.
   *
   * Falhas em qualquer etapa são logadas mas não propagadas —
   * um evento perdido não deve derrubar o processamento do job.
   */
  async emit(
    sessionId: string,
    eventType: EventType,
    payload: Payload,
  ): Promise<void> {
    await Promise.allSettled([
      this._persist(sessionId, eventType, payload),
      this._publish(sessionId, eventType, payload),
    ]);
  }

  // ── etapas internas ─────────────────────────────────────────────────────────

  /**
   * Insere o evento na tabela SessionEvent via Prisma.
   *
   * PONTO DE MUDANÇA FUTURO: quando a inserção for centralizada em outro
   * serviço, remova ou substitua somente este método.
   */
  private async _persist(
    sessionId: string,
    eventType: EventType,
    payload: Payload,
  ): Promise<void> {
    try {
      await prisma.sessionEvent.create({
        data: {
          sessionId,
          type:    eventType,
          payload: payload as never,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[publisher] falha ao persistir evento session=${sessionId} type=${eventType}: ${msg}`,
      );
    }
  }

  /** Publica no canal Redis pub/sub da sessão. */
  private async _publish(
    sessionId: string,
    eventType: EventType,
    payload: Payload,
  ): Promise<void> {
    const channel = `session:status:${sessionId}`;
    const message = JSON.stringify({
      status:  eventType,
      payload: JSON.stringify(payload),
    });

    try {
      await this.redis.publish(channel, message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[publisher] falha ao publicar evento session=${sessionId} type=${eventType}: ${msg}`,
      );
    }
  }
}


// ── factory de instância ──────────────────────────────────────────────────────

/**
 * Cria um EventPublisher com uma conexão Redis dedicada para PUBLISH.
 *
 * O Redis não permite usar o mesmo cliente para pub/sub e comandos normais,
 * portanto esta conexão é exclusiva para publicação de eventos.
 */
export function createEventPublisher(): EventPublisher { 
  const subscriber = new Redis(config.REDIS_URL);
  return new EventPublisher(subscriber);
}