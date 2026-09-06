import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../config/db';

async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`⏳ Running migration: ${file}`);
    await pool.query(sql);
    console.log(`✅ ${file} complete`);
  }

  await pool.end();
  console.log('\n🎉 All migrations complete.');
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
