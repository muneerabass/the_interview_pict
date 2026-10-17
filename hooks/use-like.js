"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useAuthModal } from "@/components/AuthModalProvider";

/**
 * Shared optimistic like toggle.
 *
 * Three components each had their own copy, none of which guarded against a
 * second click while the first request was in flight -- double-clicking raced
 * two toggles and left the server in the opposite state from the UI.
 *
 * Accepts either the raw likes array (the post page still has it) or a
 * count + liked flag (what /api/feed returns, so the feed no longer has to ship
 * every liker's email address to the browser).
 */
export function useLike(id, initial = []) {
  const { data: session } = useSession();
  const { openAuthModal } = useAuthModal();
  const userEmail = session?.user?.email;

  const derive = useCallback(
    (value) => {
      if (Array.isArray(value)) {
        return { count: value.length, liked: Boolean(userEmail) && value.includes(userEmail) };
      }
      if (value && typeof value === "object") {
        return { count: Number(value.count) || 0, liked: Boolean(value.liked) };
      }
      return { count: Number(value) || 0, liked: false };
    },
    [userEmail]
  );

  const [state, setState] = useState(() => derive(initial));
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const sync = useCallback((value) => setState(derive(value)), [derive]);

  const toggleLike = useCallback(
    async (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();

      if (!session) {
        openAuthModal();
        return;
      }
      if (inFlight.current || !id) return;

      inFlight.current = true;
      setPending(true);

      const previous = state;
      setState({ count: state.count + (state.liked ? -1 : 1), liked: !state.liked });

      try {
        const res = await fetch("/api/like", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The liking user is taken from the session server-side.
          body: JSON.stringify({ id }),
        });

        if (!res.ok) throw new Error("like failed");

        // Trust the server's post-write state over the optimistic guess.
        const data = await res.json().catch(() => null);
        if (typeof data?.count === "number") {
          setState({ count: data.count, liked: Boolean(data.liked) });

          // The feed caches full post cards in sessionStorage. Without clearing
          // those snapshots, a reload can restore the pre-like count for up to
          // a minute without asking the API for the persisted value.
          try {
            for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
              const key = sessionStorage.key(index);
              if (key?.startsWith("feed_state_v4:")) sessionStorage.removeItem(key);
            }
          } catch (error) {
            console.warn("Failed to clear stale feed cache after like:", error);
          }
        }
      } catch (error) {
        console.error("Failed to toggle like:", error);
        setState(previous);
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [id, openAuthModal, session, state]
  );

  return { count: state.count, isLiked: state.liked, pending, toggleLike, sync };
}

/** Keep local like state in step with new props without re-running on every render. */
export function useLikeSync(sync, value) {
  useEffect(() => {
    sync(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, JSON.stringify(value ?? null)]);
}
