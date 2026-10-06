import IdempotencyRepository from '#repositories/idempotency';
import type { TransactionClient } from '#repositories/transaction';
import { IdempotencyKeyReusedError } from '#errors/app-error';
import type { IdempotencyContext } from '#middlewares/idempotency';

export interface HttpOutcome<T = unknown> {
  status: number;
  body: T;
}

const repository = new IdempotencyRepository();

// RT_68 : à appeler sous le verrou du compte, dans la transaction qui écrit.
// La clé est revérifiée (une tentative concurrente avec la même clé a pu
// passer entre-temps), puis la réponse est enregistrée avec les écritures :
// une réponse perdue après le commit est toujours rejouable.
export async function withIdempotency<T>(
  tx: TransactionClient,
  userId: string,
  idempotency: IdempotencyContext | undefined,
  compute: () => Promise<HttpOutcome<T>>,
): Promise<HttpOutcome<T>> {
  if (idempotency) {
    const stored = await repository.find(userId, idempotency.key, tx);
    if (stored) {
      if (!stored.requestHash.equals(idempotency.requestHash)) throw new IdempotencyKeyReusedError();
      return { status: stored.status, body: stored.body as T };
    }
  }
  const outcome = await compute();
  if (idempotency) {
    await repository.create(
      userId,
      idempotency.key,
      { requestHash: idempotency.requestHash, status: outcome.status, body: outcome.body },
      tx,
    );
  }
  return outcome;
}
