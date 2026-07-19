// ═══════════════════════════════════════════════════════════
// StoneBreaking — Database Connection (Graceful Fallback)
// ═══════════════════════════════════════════════════════════
// If DATABASE_URL is not set, exports a mock pool that
// returns empty results instead of crashing.
// ═══════════════════════════════════════════════════════════

const logger = require('../utils/logger');

let pool = null;

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected DB pool error:', err);
    });

    logger.info('✅ PostgreSQL pool created');
  } catch (err) {
    logger.warn('⚠️  pg module failed, using mock pool:', err.message);
    pool = createMockPool();
  }
} else {
  logger.warn('⚠️  No DATABASE_URL set — using mock pool (demo mode)');
  pool = createMockPool();
}

function createMockPool() {
  // Mock pool that returns empty results instead of crashing
  const mockQuery = async () => ({ rows: [], rowCount: 0 });
  return {
    query: mockQuery,
    connect: async () => ({
      query: mockQuery,
      release: () => {},
    }),
    end: async () => {},
    on: () => {},
  };
}

module.exports = { pool };
