import { prismaClient, type DbClient } from '#shared/prisma/index';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const select = { id: true, email: true, passwordHash: true, createdAt: true } as const;

export default class UsersRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  async create(email: string, passwordHash: string, tx?: DbClient): Promise<UserRow> {
    return (tx ?? this.prisma).user.create({ data: { email, passwordHash }, select });
  }

  async findById(id: string, tx?: DbClient): Promise<UserRow | null> {
    return (tx ?? this.prisma).user.findUnique({ where: { id }, select });
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { email }, select });
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash, updatedAt: new Date() } });
  }

  async updateEmail(id: string, email: string): Promise<UserRow> {
    return this.prisma.user.update({ where: { id }, data: { email, updatedAt: new Date() }, select });
  }

  // RG_52/RT_70 : suppression immédiate et totale — les ON DELETE CASCADE
  // emportent device_tokens, records et idempotency_keys dans la même
  // instruction, donc la même transaction.
  async delete(id: string, tx?: DbClient): Promise<void> {
    await (tx ?? this.prisma).user.deleteMany({ where: { id } });
  }
}
