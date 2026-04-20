import { getCatalog } from "../../../lib/catalog";

export const runtime = "nodejs";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");
  if (!domain) return Response.json({ error: "domain required" }, { status: 400 });

  const record = await getCatalog(domain);
  if (!record) {
    return Response.json({ status: "unknown", lightCount: 0, fullCount: 0 });
  }

  return Response.json({
    status: record.fullCatalogStatus || "pending",
    error: record.fullCatalogError || null,
    brand: record.brand || "",
    lightCount: (record.lightCatalog || []).length,
    fullCount: (record.fullCatalog || []).length,
    indexedAt: record.indexedAt,
  });
}
