import type { MetadataRoute } from "next";
import { ABOUT_PAGE_PATH, publicSiteUrl } from "@campus/lib/public-site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: publicSiteUrl("/"), changeFrequency: "monthly", priority: 1 },
    { url: publicSiteUrl(ABOUT_PAGE_PATH), changeFrequency: "yearly", priority: 0.8 },
  ];
}
