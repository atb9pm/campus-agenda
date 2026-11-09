import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import {
  PUBLIC_DISALLOWED_PATHS,
  PUBLIC_INDEXABLE_PATHS,
  isProductionSiteHost,
  publicSiteUrl,
} from "@campus/lib/public-site";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  if (!isProductionSiteHost(host)) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: [...PUBLIC_INDEXABLE_PATHS],
      disallow: [...PUBLIC_DISALLOWED_PATHS],
    },
    sitemap: publicSiteUrl("/sitemap.xml"),
  };
}
