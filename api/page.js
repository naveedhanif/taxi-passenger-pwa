// Serves the SPA's index.html for /<driver-slug>, with the manifest link
// already pointing at that driver. Some iPhone/WebKit paths read the
// manifest link as it appears in the served HTML and ignore a link that
// a script rewrites afterwards, which made the installed app open "/"
// ("No driver specified"). Putting the right link in the HTML itself
// removes that dependency.
import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadIndexHtml(req) {
  try {
    return await readFile(path.join(process.cwd(), "dist", "index.html"), "utf8");
  } catch (err) {
    console.error("api/page: couldn't read bundled dist/index.html, falling back to fetching it:", err?.message);
  }
  const proto = req.headers["x-forwarded-proto"] || "https";
  const r = await fetch(`${proto}://${req.headers.host}/index.html`, { headers: { "x-page-internal": "1" } });
  if (!r.ok) throw new Error(`fetching /index.html failed: ${r.status}`);
  return await r.text();
}

export default async function handler(req, res) {
  const raw = String(req.query?.slug || "");
  const slug = /^[a-z0-9-]{1,80}$/i.test(raw) ? raw.toLowerCase() : "";
  try {
    let html = await loadIndexHtml(req);
    if (slug) {
      html = html.replace('href="/api/manifest"', `href="/api/manifest?slug=${slug}"`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.status(200).send(html);
  } catch (err) {
    console.error("api/page error:", err);
    res.status(500).send("Couldn't load the page. Please try again.");
  }
}
