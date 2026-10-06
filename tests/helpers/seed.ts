import RecordsRepository from '#repositories/records';
import { runInTransaction } from '#repositories/transaction';
import type { RecordContent, ResourceType } from '#models/record';
import type { Session } from './api.js';

const records = new RecordsRepository();

// Écritures directes par le repository, sous le verrou du compte comme le
// ferait une poussée. Renvoie la révision attribuée.
export async function seedWrite(session: Session, resourceType: ResourceType, content: Record<string, unknown>): Promise<bigint> {
  return runInTransaction(async (tx) => {
    const account = await records.lockAccount(tx, session.userId);
    const revision = account!.revision + 1n;
    const typed = content as RecordContent;
    await records.write(
      tx,
      session.userId,
      {
        resourceType,
        id: typed.id,
        content: typed,
        listId: resourceType === 'deployment' ? (content.listId as string) : null,
        opponentDispositionId: resourceType === 'deployment' ? (content.opponentDispositionId as string) : null,
        boardId: resourceType === 'deployment' ? (content.boardId as string) : null,
      },
      revision,
      session.device,
    );
    await records.setAccountRevision(tx, session.userId, revision);
    return revision;
  });
}

export async function seedDelete(session: Session, resourceType: ResourceType, id: string): Promise<bigint> {
  return runInTransaction(async (tx) => {
    const account = await records.lockAccount(tx, session.userId);
    const revision = account!.revision + 1n;
    await records.markDeleted(tx, session.userId, resourceType, id, revision, session.device, null);
    await records.setAccountRevision(tx, session.userId, revision);
    return revision;
  });
}
