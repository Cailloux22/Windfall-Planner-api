import { randomUUID } from 'node:crypto';

// Enregistrements conformes au contrat (ArmyList, Deployment).

export function listId(): string {
  return `list_${randomUUID()}`;
}

export function deploymentId(): string {
  return `depl_${randomUUID()}`;
}

export function armyList(id = listId(), overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Skitarii — 2000 pts',
    forceDispositionId: 'disposition-a',
    units: [
      {
        id: `unit_${randomUUID()}`,
        name: 'Skitarii Rangers',
        modelCount: 10,
        modelGroups: [{ id: `grp_${randomUUID()}`, name: 'Ranger', count: 10, baseShapeId: 'round-25' }],
        color: '#A1B2C3',
      },
    ],
    importedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  };
}

export function deployment(list: string, id = deploymentId(), overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Plan A',
    listId: list,
    opponentDispositionId: 'disposition-b',
    boardId: 'board-1',
    placements: [{ idUnite: 'unit_1', idModele: 'grp_1#1', x: 120.5, y: 300, rotation: 45 }],
    reservedUnitIds: [],
    note: '',
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:05:00.000Z',
    ...overrides,
  };
}
