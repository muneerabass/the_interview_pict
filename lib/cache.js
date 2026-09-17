import redis from "@/lib/redis";

/**
 * Fetch data with Redis caching
 * @param {string} key - Cache key
 * @param {number} ttlSeconds - Time-to-live in seconds
 * @param {function} fetcherFunction - Function to fetch fresh data if cache miss
 * @returns {Promise<any>} - Cached or fresh data
 */
export async function fetchWithCache(key, ttlSeconds, fetcherFunction) {
  try {
    if (redis) {
      const cached = await redis.get(key);
      if (cached) {
        try {
          // Upstash redis.get() returns parsed JSON if the value was set as an object/array
          // But if it was stringified manually, we need to handle it.
          return typeof cached === "string" ? JSON.parse(cached) : cached;
        } catch (parseError) {
          console.warn(`[cache] Failed to parse JSON for key=${key}:`, parseError.message);
          return null; // Treat as cache miss
        }
      }
    }
  } catch (error) {
    console.warn(`[cache] GET fail-open for key=${key}:`, error?.message || error);
  }

  const freshData = await fetcherFunction();

  if (freshData !== undefined && freshData !== null) {
    try {
      if (redis) {
        // @upstash/redis set() signature: set(key, value, { ex: ttlSeconds })
        await redis.set(key, freshData, { ex: ttlSeconds });
      }
    } catch (error) {
      console.warn(`[cache] SET fail-open for key=${key}:`, error?.message || error);
    }
  }

  return freshData;
}

export async function invalidateAfterWrite(email, uid) {
  if (!redis) return;

  const keys = [];
  if (email) {
    keys.push(
      `profile_posts_${encodeURIComponent(email)}`,
      `public_profile_full_v2:${email}`,
      `user_profile_data:${email}`,
    );
  }
  if (uid) keys.push(`exp_${uid}`);
  if (!keys.length) return;

  try {
    await redis.del(keys);
  } catch (err) {
    console.warn("[cache] Invalidation failed:", err?.message || err);
  }
}

export default fetchWithCache;
