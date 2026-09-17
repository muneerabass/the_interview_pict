"use client";

import { useLayoutEffect, useMemo } from "react";
import ViewTracker from "@/components/ViewTracker";

export default function ScrollViewTracker({ id }) {
  const payload = useMemo(() => ({ id }), [id]);

  // This route's loading.js boundary makes Next's own scroll-to-top on
  // navigation unreliable -- the browser keeps the previous page's scrollY
  // (or something close to it) once the real content streams in over the
  // skeleton. useLayoutEffect (not useEffect) so this runs before the
  // browser paints, instead of after -- a plain useEffect still showed a
  // brief flash of the old scroll position before snapping to the top.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return <ViewTracker endpoint="/api/view" payload={payload} />;
}
