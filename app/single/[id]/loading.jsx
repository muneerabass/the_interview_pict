"use client";

import { useLayoutEffect } from "react";
import SingleExperienceThemeShell from "@/components/SingleExperienceThemeShell";

const pulse = "animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700";

export default function Loading() {
  // This skeleton mounts immediately on navigation, before the real page
  // (and its own scroll-to-top in ScrollViewTracker) is ready -- without this,
  // it renders at whatever scrollY the previous page was left at.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <SingleExperienceThemeShell>
      <div className="relative min-h-screen overflow-x-clip bg-slate-50 dark:bg-slate-950">
        <div className="relative z-10 mx-auto max-w-5xl px-4 pb-14 pt-24 sm:px-6 sm:pb-16 lg:px-8">
          <div className="mb-5 flex items-center justify-between">
            <div className={`h-9 w-28 ${pulse}`} />
            <div className={`h-6 w-24 ${pulse}`} />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex gap-5 border-b border-slate-100 px-4 py-7 dark:border-slate-800 sm:px-8 sm:py-8">
              <div className={`h-20 w-20 shrink-0 rounded-full sm:h-24 sm:w-24 ${pulse}`} />
              <div className="min-w-0 flex-1 space-y-3">
                <div className={`h-6 w-48 ${pulse}`} />
                <div className={`h-4 w-64 ${pulse}`} />
                <div className={`h-4 w-40 ${pulse}`} />
              </div>
            </div>
            <div className="space-y-3 px-4 py-7 sm:px-8 sm:py-9">
              <div className={`h-4 w-full ${pulse}`} />
              <div className={`h-4 w-full ${pulse}`} />
              <div className={`h-4 w-5/6 ${pulse}`} />
              <div className={`h-4 w-full ${pulse}`} />
              <div className={`h-4 w-3/4 ${pulse}`} />
            </div>
          </div>
        </div>
      </div>
    </SingleExperienceThemeShell>
  );
}
