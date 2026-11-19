/**
 * The one image the runner starts for the proxy and for each health check
 * (specs/015-domains-https, research R1; contracts/runner.md, "Names the
 * runner uses"): Caddy 2.11.9 on Alpine, pinned by its multi-arch index
 * digest, so the registry can never decide what terminates TLS for every
 * app. It is named here and nowhere else in the runner; nothing a deploy
 * carries names an image of the runner's. A runner release with another
 * digest makes the proxy again at the next deploy with a route (RN6).
 */
export const PROXY_IMAGE =
  "caddy@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0"
