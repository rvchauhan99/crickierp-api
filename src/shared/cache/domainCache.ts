import { bumpCacheVersion } from "./cache.service";

export async function invalidateCacheDomains(domains: string[]): Promise<void> {
  const unique = [...new Set(domains.filter(Boolean))];
  await Promise.all(unique.map((domain) => bumpCacheVersion(domain)));
}
