/**
 * User row CRUD.
 *
 * Second link in the composition chain — see the note in storage.ts for why these are
 * `extends` rather than independent modules.
 */
import { pgPool, type Queryable } from './client';
import { StorageService } from './storage';

export class UsersService extends StorageService {
  // Database Methods using direct PostgreSQL connection
  // Accepts a transaction client so signup can create the user and their personal squad
  // atomically — a user without a personal squad has no resolvable scope.
  async createLocalUser(
    userData: { email: string; name: string | null; passwordHash: string },
    db: Queryable = pgPool,
  ) {
    const query = `
      INSERT INTO users (id, email, name, role, "passwordHash", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, LOWER($1), $2, 'USER', $3, NOW(), NOW())
      RETURNING *
    `;
    const result = await db.query(query, [userData.email, userData.name, userData.passwordHash]);
    return result.rows[0];
  }

  async findUserByEmail(email: string) {
    const result = await pgPool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return result.rows[0] || null;
  }

  async findUserById(userId: string) {
    const result = await pgPool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await pgPool.query(
      'UPDATE users SET "passwordHash" = $2, "updatedAt" = NOW() WHERE id = $1',
      [userId, passwordHash],
    );
  }
}
