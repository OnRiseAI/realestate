import FirecrawlApp from "@mendable/firecrawl-js";
import { after } from "next/server";
import { getCatalog, saveCatalog, catalogId, normalizeDomain } from "../../lib/catalog";
import { extractListingsFromPage, runFullCrawl } from "./crawl";

export const runtime = "nodejs";
export const maxDuration = 60;

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;
const BRIEF_CHAR_CAP = 6000;
const PAGE_CHAR_CAP = 2500;
const CACHE_FRESH_SECONDS = 60 * 60 * 24; // 24h

const LISTING_PATH_HINTS = [
  "/properties", "/property", "/listings", "/listing",
  "/for-sale", "/for-rent", "/homes", "/real-estate",
  "/propiedades", "/propiedad", "/en-venta", "/inmuebles",
  "/immobilier", "/immobilien", "/vendita",
];

function findListingsPageUrl(homepageMarkdown, origin) {
  if (!homepageMarkdown) return null;
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const m of homepageMarkdown.matchAll(linkRegex)) {
    const href = m[2].trim();
    if (!href) continue;
    const lower = href.toLowerCase();
    if (LISTING_PATH_HINTS.some((hint) => lower.includes(hint))) {
      try {
        return new URL(href, origin).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

function isFresh(record) {
  if (!record?.indexedAt) return false;
  const age = (Date.now() - new Date(record.indexedAt).getTime()) / 1000;
  return age < CACHE_FRESH_SECONDS;
}

export async function POST(req) {
  if (!FIRECRAWL_KEY) {
    return Response.json({ error: "FIRECRAWL_API_KEY not configured on server" }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  let rawUrl = (body?.url || "").trim();
  if (!rawUrl) return Response.json({ error: "website URL required" }, { status: 400 });
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = "https://" + rawUrl;

  let domain;
  try {
    domain = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return Response.json({ error: "invalid URL" }, { status: 400 });
  }

  const catId = catalogId(domain);

  // 1. Cache check — return fast if fresh.
  const cached = await getCatalog(domain);
  if (cached && isFresh(cached) && cached.brief) {
    return Response.json({
      ok: true,
      cached: true,
      brand: cached.brand,
      catalogId: catId,
      brief: cached.brief,
      lightCount: (cached.lightCatalog || []).length,
      fullCount: (cached.fullCatalog || []).length,
      fullCatalogStatus: cached.fullCatalogStatus || "pending",
    });
  }

  const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_KEY });
  const origin = `https://${normalizeDomain(domain)}`;

  // 2. Sync path: homepage scrape + brand brief + discover listings page + extract top listings.
  let homepageMd = "";
  let homepageTitle = "";
  let homepageDescription = "";
  try {
    const res = await firecrawl.scrapeUrl(origin, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 20000,
    });
    const data = res?.data || res;
    homepageMd = (data?.markdown || "").slice(0, PAGE_CHAR_CAP);
    const meta = data?.metadata || {};
    homepageTitle = meta.title || meta.ogTitle || "";
    homepageDescription = meta.description || meta.ogDescription || "";
  } catch (err) {
    return Response.json(
      { error: `Couldn't read the site: ${err?.message || "unknown error"}` },
      { status: 502 }
    );
  }

  const brand = homepageTitle || domain;

  const brief = [
    `BRAND: ${brand}`,
    `WEBSITE: ${origin}`,
    homepageDescription ? `DESCRIPTION: ${homepageDescription}` : null,
    "",
    "HOMEPAGE EXCERPT:",
    homepageMd,
  ].filter(Boolean).join("\n").slice(0, BRIEF_CHAR_CAP);

  // Try to find and extract listings from the index page.
  let lightCatalog = [];
  const listingsUrl = findListingsPageUrl(homepageMd, origin);
  if (listingsUrl) {
    const listings = await extractListingsFromPage(firecrawl, listingsUrl);
    lightCatalog = listings.slice(0, 8);
  }

  // Save sync data to KV with fullCatalogStatus: pending.
  await saveCatalog(domain, {
    domain: normalizeDomain(domain),
    brand,
    brief,
    lightCatalog,
    fullCatalogStatus: "pending",
    indexedAt: new Date().toISOString(),
  });

  // 3. Async path: kick off full crawl (fire-and-forget).
  after(async () => {
    await runFullCrawl({ domain, firecrawlKey: FIRECRAWL_KEY });
  });

  return Response.json({
    ok: true,
    cached: false,
    brand,
    catalogId: catId,
    brief,
    lightCount: lightCatalog.length,
    fullCount: 0,
    fullCatalogStatus: "pending",
  });
}
