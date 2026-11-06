// schottkyfarm.com is the chicken page. It shares this project with schottky.com,
// whose root index.html would otherwise win over a vercel.json rewrite, so the
// host routing lives here: www goes to the bare domain, "/" shows
// chickens/index.html, the page's own files and form endpoint pass through, and
// anything else on the farm domain goes back to "/".
const FARM = "schottkyfarm.com";

export default function middleware(request) {
  const url = new URL(request.url);
  const host = url.hostname;
  if (host === `www.${FARM}`) {
    return Response.redirect(`https://${FARM}${url.pathname}${url.search}`, 308);
  }
  if (host !== FARM) return;

  if (url.pathname === "/") {
    return new Response(null, { headers: { "x-middleware-rewrite": new URL("/chickens/index.html", url).toString() } });
  }
  if (url.pathname.startsWith("/chickens/") && url.pathname !== "/chickens/") return;
  if (url.pathname === "/api/chickens") return;
  return Response.redirect(`https://${FARM}/`, 307);
}
