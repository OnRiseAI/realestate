import FirecrawlApp from "@mendable/firecrawl-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

const PAGE_CHAR_CAP = 2500;   // per page, keeps distilled brief compact
const BRIEF_CHAR_CAP = 6000;  // ~4-6KB once JSON-encoded, under LiveKit room-metadata limit

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

  let url = (body?.url || "").trim();
  if (!url) {
    return Response.json({ error: "website URL required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return Response.json({ error: "invalid URL" }, { status: 400 });
  }

  const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_KEY });

  // Scrape homepage only for the demo. (Crawl gives more context but is slower + more credits.)
  let homepageMd = "";
  let homepageTitle = "";
  let homepageDescription = "";
  try {
    const res = await firecrawl.scrapeUrl(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 20000,
    });
    // Firecrawl SDK v1 returns { success, data: { markdown, metadata } } OR { markdown, metadata }
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

  // Build a compact brief Mia can use as a cheat sheet during the demo.
  // Distill to: brand name (best guess), one-line pitch, first few listings/services visible in markdown.
  const brief = [
    `BRAND: ${homepageTitle || hostname}`,
    `WEBSITE: ${url}`,
    homepageDescription ? `DESCRIPTION: ${homepageDescription}` : null,
    "",
    "HOMEPAGE EXCERPT:",
    homepageMd,
  ].filter(Boolean).join("\n").slice(0, BRIEF_CHAR_CAP);

  return Response.json({
    ok: true,
    brand: homepageTitle || hostname,
    hostname,
    briefLength: brief.length,
    brief,
  });
}
