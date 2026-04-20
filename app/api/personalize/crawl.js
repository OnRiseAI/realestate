import FirecrawlApp from "@mendable/firecrawl-js";
import { saveCatalog, normalizeDomain } from "../../lib/catalog";

export const MAX_FULL_CATALOG = 100;

const PROPERTY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    location: { type: "string", description: "City + neighborhood if available" },
    price: { type: "number", description: "Numeric price only, no currency symbol" },
    currency: { type: "string", description: "Three-letter code (EUR, USD, GBP, AED, etc.)" },
    bedrooms: { type: "integer" },
    bathrooms: { type: "number" },
    areaSqm: { type: "number", description: "Area in square metres" },
    propertyType: { type: "string", description: "villa | apartment | house | townhouse | penthouse | land | commercial | other" },
    features: { type: "array", items: { type: "string" }, description: "Notable features: pool, garden, sea view, garage, etc." },
    description: { type: "string", description: "One-sentence summary, max 240 chars" },
    imageUrl: { type: "string", description: "Primary image URL if present" },
  },
  required: ["title", "price"],
};

const LISTING_URL_PATTERNS = [
  /\/property\//i,
  /\/properties\//i,
  /\/listing\//i,
  /\/listings\//i,
  /\/for-sale\//i,
  /\/for-rent\//i,
  /\/homes?\//i,
  /\/propiedad/i,
  /\/propiedades/i,
  /\/en-venta/i,
  /\/inmuebles/i,
  /\/immobilier/i,
  /\/immobilien/i,
  /\/vendita/i,
  /\/real-estate\//i,
];

export function isListingUrl(url) {
  return LISTING_URL_PATTERNS.some((re) => re.test(url));
}

export async function extractListingsFromPage(firecrawl, url) {
  try {
    const res = await firecrawl.scrapeUrl(url, {
      formats: [
        "markdown",
        {
          type: "json",
          schema: {
            type: "object",
            properties: {
              listings: {
                type: "array",
                items: PROPERTY_SCHEMA,
                description: "Property listings shown on this page. Empty array if none.",
              },
            },
          },
        },
      ],
      onlyMainContent: true,
      timeout: 25000,
    });
    const data = res?.data || res;
    const listings = data?.json?.listings || data?.extract?.listings || [];
    return Array.isArray(listings) ? listings : [];
  } catch (err) {
    console.error(`extractListings failed for ${url}:`, err?.message);
    return [];
  }
}

async function extractOneListing(firecrawl, url) {
  try {
    const res = await firecrawl.scrapeUrl(url, {
      formats: [
        {
          type: "json",
          schema: PROPERTY_SCHEMA,
        },
      ],
      onlyMainContent: true,
      timeout: 20000,
    });
    const data = res?.data || res;
    const listing = data?.json || data?.extract || null;
    if (!listing || !listing.title || !listing.price) return null;
    return { ...listing, url };
  } catch (err) {
    console.error(`extractOneListing failed for ${url}:`, err?.message);
    return null;
  }
}

export async function runFullCrawl({ domain, firecrawlKey }) {
  const firecrawl = new FirecrawlApp({ apiKey: firecrawlKey });
  const origin = `https://${normalizeDomain(domain)}`;

  try {
    // Step 1: crawl to discover listing URLs.
    const crawlRes = await firecrawl.crawlUrl(origin, {
      limit: 120,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      maxDepth: 3,
    });
    const crawlData = crawlRes?.data || [];
    const listingUrls = crawlData
      .map((p) => p?.metadata?.sourceURL || p?.url)
      .filter(Boolean)
      .filter(isListingUrl)
      .slice(0, MAX_FULL_CATALOG);

    if (listingUrls.length === 0) {
      await saveCatalog(domain, {
        fullCatalogStatus: "ready",
        fullCatalog: [],
        fullCatalogError: "No listing-shaped URLs discovered on the domain.",
      });
      return;
    }

    // Step 2: extract structured data from each listing URL (parallelized in batches of 5).
    const results = [];
    const batchSize = 5;
    for (let i = 0; i < listingUrls.length; i += batchSize) {
      const batch = listingUrls.slice(i, i + batchSize);
      const extracted = await Promise.all(batch.map((u) => extractOneListing(firecrawl, u)));
      for (const r of extracted) if (r) results.push(r);
    }

    await saveCatalog(domain, {
      fullCatalogStatus: "ready",
      fullCatalog: results,
    });
  } catch (err) {
    await saveCatalog(domain, {
      fullCatalogStatus: "failed",
      fullCatalogError: (err?.message || "unknown error").slice(0, 300),
    });
  }
}
