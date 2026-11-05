import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: ["/", "/pricing"], disallow: ["/app", "/platform", "/workspaces", "/api"] }] };
}
