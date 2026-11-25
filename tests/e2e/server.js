import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';

const dir = mkdtempSync(path.join(tmpdir(), 'rgb-playwright-'));
const salt = randomBytes(16);
const hash = scryptSync('playwright-test-password', salt, 64);
writeFileSync(path.join(dir, 'whitelist.json'), JSON.stringify({
  users: [{
    username: 'playwright-admin',
    role: 'admin',
    passwordHash: {
      algorithm: 'scrypt',
      salt: salt.toString('base64'),
      hash: hash.toString('base64')
    }
  }]
}));

process.env.RGB_WHITELIST_PATH = path.join(dir, 'whitelist.json');
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';
process.env.HOST = '127.0.0.1';

await import('../../server/index.js');
