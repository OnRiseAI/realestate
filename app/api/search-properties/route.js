import { getCatalog } from "../../lib/catalog";

export const runtime = "nodejs";

function matchesLocation(listing, locationQuery) {
  if (!locationQuery) return true;
  const q = locationQuery.toLowerCase();
  const hay = `${listing.location || ""} ${listing.title || ""} ${listing.description || ""}`.toLowerCase();
  return hay.includes(q);
}

function matchesPrice(listing, minPrice, maxPrice) {
  const p = Number(listing.price);
  if (!Number.isFinite(p)) return minPrice == null && maxPrice == null;
  if (minPrice != null && p < minPrice) return false;
  if (maxPrice != null && p > maxPrice) return false;
  return true;
}

function matchesBedrooms(listing, bedrooms) {
  if (bedrooms == null) return true;
  const b = Number(listing.bedrooms);
  return Number.isFinite(b) && b >= bedrooms;
}

function fmtPrice(n, currency) {
  if (!Number.isFinite(Number(n))) return "";
  const symbol = { EUR: "€", USD: "$", GBP: "£", AED: "AED " }[currency] || (currency ? `${currency} ` : "");
  return `${symbol}${Math.round(Number(n)).toLocaleString("en-US")}`;
}

function formatListingProse(listing) {
  const parts = [];
  if (listing.title) parts.push(listing.title);
  if (listing.location) parts.push(`in ${listing.location}`);
  const priceStr = fmtPrice(listing.price, listing.currency);
  if (priceStr) parts.push(`at ${priceStr}`);
  if (listing.bedrooms) parts.push(`${listing.bedrooms} bed${listing.bedrooms > 1 ? "s" : ""}`);
  if (listing.bathrooms) parts.push(`${listing.bathrooms} bath${Number(listing.bathrooms) > 1 ? "s" : ""}`);
  if (listing.areaSqm) parts.push(`${Math.round(Number(listing.areaSqm))} sqm`);
  return parts.join(", ");
}

function buildProse(matches, query) {
  if (!matches.length) {
    const bits = [];
    if (query.location) bits.push(query.location);
    if (query.maxPrice) bits.push(`under ${fmtPrice(query.maxPrice, query.currency || "EUR")}`);
    const qStr = bits.length ? ` matching ${bits.join(" ")}` : "";
    return `No listings${qStr} in our current inventory. Offer to take a message and let the team reach out when something comes up.`;
  }
  const lines = matches.slice(0, 3).map((l, i) => `${i + 1}. ${formatListingProse(l)}`);
  const intro = matches.length === 1 ? "Found one close match:" : `Found ${matches.length} close matches. Top ${Math.min(3, matches.length)}:`;
  return `${intro}\n${lines.join("\n")}\n\nWhen describing these aloud, pick the best-fit one to mention first and offer to book a viewing.`;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const { catalogId: _unused, domain, location, minPrice, maxPrice, bedrooms, currency } = body || {};

  // Allow either domain or catalogId input. The agent will typically pass domain from room metadata.
  const lookupKey = domain || body?.catalogId;
  if (!lookupKey) return Response.json({ error: "domain required" }, { status: 400 });

  const record = await getCatalog(lookupKey);
  if (!record) {
    return Response.json({
      prose: "I don't have inventory for that brokerage indexed yet. Offer to take a message.",
      matches: [],
    });
  }

  const catalog = (record.fullCatalogStatus === "ready" ? record.fullCatalog : record.lightCatalog) || [];
  if (catalog.length === 0) {
    return Response.json({
      prose: "The brokerage's inventory is still indexing. Offer to take their details and have someone follow up.",
      matches: [],
    });
  }

  const min = minPrice != null ? Number(minPrice) : null;
  const max = maxPrice != null ? Number(maxPrice) : null;
  const beds = bedrooms != null ? Number(bedrooms) : null;

  let matches = catalog.filter((l) =>
    matchesLocation(l, location) &&
    matchesPrice(l, min, max) &&
    matchesBedrooms(l, beds)
  );

  // Rank: closest to midpoint if price range given, else ascending price.
  if (min != null && max != null) {
    const mid = (min + max) / 2;
    matches.sort((a, b) => Math.abs(Number(a.price || 0) - mid) - Math.abs(Number(b.price || 0) - mid));
  } else {
    matches.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  }

  const prose = buildProse(matches, { location, minPrice: min, maxPrice: max, currency });

  return Response.json({
    prose,
    matches: matches.slice(0, 3),
    totalMatched: matches.length,
    catalogSource: record.fullCatalogStatus === "ready" ? "full" : "light",
  });
}
