import 'dotenv/config';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { dbPath, openDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './server.js';
import { scanExistingUploads } from './boot-scan.js';
import { backfillItemDerivations } from './boot-backfill.js';

async function main(): Promise<void> {
  const configPath = process.env.CONFIG_PATH ?? 'config.yaml';
  if (!existsSync(configPath)) {
    console.error(`Config file not found at ${configPath}. Copy config.example.yaml → ${configPath} to get started.`);
    process.exit(1);
  }
  const config = loadConfig(configPath);

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    console.error(
      'SESSION_SECRET must be set to a random string of at least 32 chars.\n' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\"",
    );
    process.exit(1);
  }

  const dataDir = process.env.DATA_DIR ?? './data';
  const db = openDb(dbPath(dataDir));
  const applied = migrate(db);
  if (applied.length > 0) {
    console.log(`Applied ${applied.length} migration(s):`, applied.join(', '));
  }

  const created = scanExistingUploads(db, dataDir);
  if (created > 0) {
    console.log(`Queued ${created} existing upload(s) for parsing.`);
  }

  const backfill = backfillItemDerivations(db);
  if (backfill.updated > 0) {
    console.log(`Backfilled derived fields on ${backfill.updated} item(s).`);
  }

  const app = buildServer({ db, config, dataDir, sessionSecret });
  app.listen(config.port, () => {
    console.log(`tripsheet listening on http://localhost:${config.port}`);
  });
}

void main();
