import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function loadWhitelist(){
 const whitelistPath = process.env.RGB_WHITELIST_PATH || path.join(root,'whitelist.json');
 const data=JSON.parse(fs.readFileSync(whitelistPath,'utf8'));
 if(!Array.isArray(data.users))throw new Error('whitelist.json must contain users');
 return data.users;
}
