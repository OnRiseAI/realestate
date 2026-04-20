import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";

const TTL_SECONDS = 60 * 60 * 24; // 24 hours

let _redis = null;
function redis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash KV env missing (KV_REST_API_URL / KV_REST_API_TOKEN)");
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export function normalizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/\/.*$/, "");
  s = s.replace(/[^a-z0-9.\-]/g, "");
  return s || null;
}

export function catalogKey(domain) {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const hash = createHash("sha1").update(d).digest("hex").slice(0, 16);
  return `site:${hash}`;
}

export async function getCatalog(domain) {
  const key = catalogKey(domain);
  if (!key) return null;
  const record = await redis().get(key);
  return record || null;
}

export async function saveCatalog(domain, partial) {
  const key = catalogKey(domain);
  if (!key) throw new Error("invalid domain");
  const existing = (await redis().get(key)) || {};
  const merged = {
    ...existing,
    ...partial,
    domain: normalizeDomain(domain),
    indexedAt: partial.indexedAt || existing.indexedAt || new Date().toISOString(),
  };
  await redis().set(key, merged, { ex: TTL_SECONDS });
  return merged;
}

export function catalogId(domain) {
  // public identifier passed to the client + agent — same as the KV key
  return catalogKey(domain);
}
