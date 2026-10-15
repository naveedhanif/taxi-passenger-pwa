// Per-driver web app manifest. The installed home-screen app must open
// at the driver's own booking page (e.g. /johns-taxi). A static
// manifest can only say start_url "/", which loads the app with no
// driver and shows "No driver specified".
export default async function handler(req, res) {
  const raw = String(req.query?.slug || "");
  const slug = /^[a-z0-9-]{1,80}$/i.test(raw) ? raw.toLowerCase() : "";

  let name = "Book a Taxi";
  if (slug) {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.error("api/manifest: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — using generic app name.");
    } else {
      try {
        const r = await fetch(`${url}/rest/v1/public_driver_profiles?booking_slug=eq.${encodeURIComponent(slug)}&select=business_name&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!r.ok) {
          console.error("api/manifest: driver lookup failed:", r.status, await r.text());
        } else {
          const rows = await r.json();
          if (rows[0]?.business_name) name = rows[0].business_name;
        }
      } catch (err) {
        console.error("api/manifest: driver lookup error:", err);
      }
    }
  }

  const startUrl = slug ? `/${slug}` : "/";
  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).send(
    JSON.stringify({
      id: startUrl,
      name,
      short_name: name.length > 12 ? name.slice(0, 12) : name,
      description: "Book your taxi in advance.",
      start_url: startUrl,
      scope: "/",
      display: "standalone",
      background_color: "#F6F6F3",
      theme_color: "#FFC400",
      orientation: "portrait-primary",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    })
  );
}
