// Fingerprinted static URLs: /static/style.css?v=<hash>. A changed file gets a new URL, so the server can let
// browsers and CDNs cache static files for a year.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../public/', import.meta.url);
const hashes = new Map();

export function assetHash(name) {
  if (!hashes.has(name)) {
    try {
      hashes.set(name, createHash('sha256').update(readFileSync(new URL(name, DIR))).digest('hex').slice(0, 10));
    } catch {
      hashes.set(name, '');
    }
  }
  return hashes.get(name);
}

export const asset = (name) => `/static/${name}${assetHash(name) ? `?v=${assetHash(name)}` : ''}`;
