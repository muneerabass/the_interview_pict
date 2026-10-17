"use client";

import Navbar from "../../components/Navbar";
import FeedPostCard from "../../components/FeedPostCard";
import FeedHero from "../../components/FeedHero";
import SearchableDropdown from "../../components/SearchableDropdown";
import FeedSearch from "../../components/FeedSearch";
import { useEffect, useState, useRef, useCallback } from "react";
import { requestJson } from "../../lib/client-api";
import { ArrowUpRight, Loader2, Send, Zap, Clock, SlidersHorizontal, GraduationCap, CalendarDays, Building2, UserRound, X, RefreshCw, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ProfileCardSkeleton from "../../components/ProfileCardSkeleton";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";

const FEED_CACHE_PREFIX = "feed_state_v4";
// The chosen sort tab + filters, so a reload does not dump the reader back on
// the random "Feed" tab they deliberately switched away from.
const FEED_VIEW_KEY = "feed_view_v1";
const SORT_TABS = ["latest", "trending", "random"];
const FILTER_KEYS = ["company", "author", "college", "branch", "batch"];
const pickFilters = (raw) =>
  Object.fromEntries(FILTER_KEYS.map((key) => [key, typeof raw?.[key] === "string" ? raw[key] : ""]));
const BRANCH_OPTIONS = [
  { label: "Computer Science", value: "CS" },
  { label: "Information Technology", value: "IT" },
  { label: "E&TC", value: "EnTC" },
  { label: "AI & Data Science", value: "AIDS" },
  { label: "Electronics & Comp", value: "EC" },
];
const COLLEGE_PAGE_SIZE = 20;
const YEAR_OPTIONS = Array.from({ length: 28 }, (_, index) => String(2000 + index)).reverse();
const getFeedCacheKey = (tab, filters) =>
  `${FEED_CACHE_PREFIX}:${tab}:${filters.company || "all"}:${filters.author || "all"}:${filters.college || "all"}:${filters.branch || "all"}:${filters.batch || "all"}`;

const LoadingScreen = ({ isDarkMode }) => (
  <div
    className={`fixed left-0 top-0 z-50 flex h-full w-full items-center justify-center backdrop-blur-sm ${isDarkMode ? "bg-slate-950/80" : "bg-white/80"
      }`}
  >
    <Loader2 className={`h-10 w-10 animate-spin ${isDarkMode ? "text-blue-400" : "text-blue-600"}`} />
  </div>
);

export default function HomePage() {
  const [profiles, setProfiles] = useState([]);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [authorOptions, setAuthorOptions] = useState([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [collegeOptions, setCollegeOptions] = useState([]);
  const [collegeSearchTerm, setCollegeSearchTerm] = useState("");
  const [collegePage, setCollegePage] = useState(1);
  const [collegeHasMore, setCollegeHasMore] = useState(false);
  const [collegeLoading, setCollegeLoading] = useState(false);
  const [page, setPage] = useState(0);
  const itemsPerPage = 10;
  // null until the persisted choice is read on mount; nothing fetches before then.
  const [activeTab, setActiveTab] = useState(null); // 'latest', 'trending', or 'random' (Feed)
  const [pageLoading, setPageLoading] = useState(false);
  const [hasMoreProfiles, setHasMoreProfiles] = useState(true);
  const [isShareButtonLoading, setIsShareButtonLoading] = useState(false);
  const pathname = usePathname();
  const [tabReady, setTabReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    company: "",
    author: "",
    college: "",
    branch: "",
    batch: "",
  });

  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDarkMode = mounted && resolvedTheme === "dark";

  useEffect(() => {
    const loadCompanyOptions = async () => {
      setCompaniesLoading(true);
      try {
        // Pass the Response itself: requestJson(res.url, ...) re-fetched the
        // same endpoint a second time on every mount.
        const res = await fetch("/api/getCompanies");
        const data = await requestJson(res, {}, { success: false, data: [] });
        if (data.success && Array.isArray(data.data)) {
          const names = data.data.map((company) => company.name).filter(Boolean);
          setCompanyOptions(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
        }
      } catch (error) {
        console.error("Error fetching companies:", error);
      } finally {
        setCompaniesLoading(false);
      }
    };

    loadCompanyOptions();
  }, []);

  useEffect(() => {
    const loadAuthorOptions = async () => {
      setAuthorsLoading(true);
      try {
        const response = await fetch("/api/feed?options=authors");
        const data = await requestJson(response, {}, []);
        setAuthorOptions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching authors:", error);
      } finally {
        setAuthorsLoading(false);
      }
    };
    loadAuthorOptions();
  }, []);

  const loadCollegeOptions = async (query, pageToLoad) => {
    setCollegeLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(pageToLoad),
        limit: String(COLLEGE_PAGE_SIZE),
      });
      const res = await fetch(`/api/colleges?${params.toString()}`);
      const data = await requestJson(res, {}, { success: false, data: [] });
      if (data.success && Array.isArray(data.data)) {
        setCollegeOptions((prev) => (
          pageToLoad === 1
            ? data.data
            : Array.from(new Set([...prev, ...data.data]))
        ));
        setCollegePage(pageToLoad);
        setCollegeHasMore(Boolean(data.pagination?.hasMore));
      }
    } catch (error) {
      console.error("Error fetching colleges:", error);
    } finally {
      setCollegeLoading(false);
    }
  };

  // The 2xl sidebar renders these fields without ever setting `filtersOpen`, so
  // gating the load on it left the College dropdown permanently empty on wide
  // screens. Load the first page up front; the panel only drives re-searches.
  useEffect(() => {
    loadCollegeOptions(collegeSearchTerm, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeSearchTerm]);

  const isFetchingRef = useRef(false);
  // "No stories found" used to paint before the very first request even started.
  const hasFetchedRef = useRef(false);
  const feedRequestIdRef = useRef(0);
  const feedAbortRef = useRef(null);
  const skipNextFetchRef = useRef(false);
  const observer = useRef();
  const lastProfileElementRef = useCallback(
    (node) => {
      if (pageLoading || !hasMoreProfiles) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(
        (entries) => {
          // Only increment page if we are actually at the bottom and not currently fetching
          if (entries[0].isIntersecting && hasMoreProfiles && !isFetchingRef.current && profiles.length > 0) {
            setPage((prevPage) => prevPage + 1);
          }
        },
        { rootMargin: "400px" }
      );

      if (node) observer.current.observe(node);
    },
    [pageLoading, hasMoreProfiles, profiles.length]
  );

  // The observer lived in a ref and was never disconnected, so leaving the feed
  // left it holding the last sentinel node and its callback closure alive.
  useEffect(() => () => observer.current?.disconnect(), []);

  const fetchProfiles = useCallback(async (pageNumber, limit, sort, activeFilters, forceRefresh = false, excludedProfileIds = [], cursorAnchor = null) => {
    // Avoid redundant fetches if already loading or no more profiles
    if (isFetchingRef.current && pageNumber > 0) return;

    setPageLoading(true);
    isFetchingRef.current = true;
    const requestId = ++feedRequestIdRef.current;
    feedAbortRef.current?.abort();
    const controller = new AbortController();
    feedAbortRef.current = controller;
    try {
      const params = new URLSearchParams({
        page: String(pageNumber),
        itemsPerPage: String(limit),
        sort,
        _ts: Date.now().toString(), // Cache busting
      });
      if (activeFilters.company) params.set("company", activeFilters.company);
      if (activeFilters.author) params.set("author", activeFilters.author);
      if (activeFilters.college) params.set("college", activeFilters.college);
      if (activeFilters.branch) params.set("branch", activeFilters.branch);
      if (activeFilters.batch) params.set("batch", activeFilters.batch);
      if (searchQuery) params.set("q", searchQuery);
      if (forceRefresh) params.set("refresh", "true");
      if (sort === "random" && pageNumber > 0 && excludedProfileIds.length > 0) {
        params.set("exclude", excludedProfileIds.join(","));
      }
      // `page`/$skip gets slower the deeper you scroll; a cursor built from the
      // last loaded item's own (date, _id) -- already in every feed row -- lets
      // the server skip straight there instead. Only "latest" supports it
      // (trending's window can widen mid-request, random has no stable order),
      // and `page` still goes up above so nothing breaks if the cursor is unusable.
      if (sort === "latest" && pageNumber > 0 && cursorAnchor?.date && cursorAnchor?._id) {
        params.set("cursor", `${cursorAnchor.date}::${cursorAnchor._id}`);
      }

      const url = `/api/feed?${params.toString()}`;
      const incoming = await requestJson(url, { signal: controller.signal }, []);

      // Safety check: only update state if this request matches the current active tab
      if (requestId !== feedRequestIdRef.current || sort !== activeTab) return;

      if (incoming.length > 0) {
        setProfiles((prev) => {
          // If it's page 0, we replace the previous state to avoid stale data
          if (pageNumber === 0) return incoming;

          // Deduplicate based on _id
          const combined = [...prev, ...incoming];
          const uniqueProfiles = [...new Map(combined.map((item) => [item._id, item])).values()];
          return uniqueProfiles;
        });

        if (incoming.length < limit) {
          setHasMoreProfiles(false);
        } else {
          setHasMoreProfiles(true);
        }
      } else {
        setHasMoreProfiles(false);
        if (pageNumber === 0) {
          setProfiles([]);
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("Error fetching profiles:", error);
      if (pageNumber === 0) {
        setHasMoreProfiles(false);
      }
    } finally {
      // Only the newest request may clear the spinner. The unconditional call
      // that used to sit here let a stale/aborted request hide the loader while
      // a newer one was still in flight.
      if (requestId === feedRequestIdRef.current) {
        hasFetchedRef.current = true;
        setPageLoading(false);
        isFetchingRef.current = false;
      }
    }
  }, [activeTab, searchQuery]);

  useEffect(() => {
    if (activeTab !== null) return;

    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(FEED_VIEW_KEY) || "null");
    } catch (error) {
      console.warn("Failed to restore feed view:", error);
    }

    if (saved?.filters) setFilters(pickFilters(saved.filters));
    setActiveTab(SORT_TABS.includes(saved?.tab) ? saved.tab : "latest");
  }, [activeTab]);

  useEffect(() => {
    if (!activeTab) return;
    try {
      sessionStorage.setItem(FEED_VIEW_KEY, JSON.stringify({ tab: activeTab, filters }));
    } catch (error) {
      console.warn("Failed to persist feed view:", error);
    }
  }, [activeTab, filters]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTab) return;

    // Skip persistence for random discovery tab to ensure variety
    if (activeTab === "random") {
      setProfiles([]);
      setPage(0);
      setHasMoreProfiles(true);
      skipNextFetchRef.current = false;
      setTabReady(true);
      return;
    }

    let restored = false;
    try {
      const cached = sessionStorage.getItem(getFeedCacheKey(activeTab, filters));
      if (cached) {
        const parsed = JSON.parse(cached);
        const cacheAge = Date.now() - (parsed.timestamp || 0);

        // Only use cache if it was saved within the last 60 seconds
        if (cacheAge < 60 * 1000) {
          const cachedProfiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
          const cachedPage = Number.isFinite(Number(parsed?.page)) ? Number(parsed.page) : 0;

          setProfiles(cachedProfiles);
          setPage(cachedPage);
          setHasMoreProfiles(parsed?.hasMoreProfiles ?? true);
          skipNextFetchRef.current = cachedProfiles.length > 0;
          restored = true;

          if (Number.isFinite(parsed?.scrollY)) {
            requestAnimationFrame(() => {
              window.scrollTo({ top: parsed.scrollY, behavior: "auto" });
            });
          }
        } else {
          // Cache expired, remove it and start fresh
          sessionStorage.removeItem(getFeedCacheKey(activeTab, filters));
        }
      }
    } catch (error) {
      console.warn("Failed to restore feed cache:", error);
    }

    if (!restored) {
      setProfiles([]);
      setPage(0);
      setHasMoreProfiles(true);
      skipNextFetchRef.current = false;
    }

    setTabReady(true);
  }, [activeTab, filters]);

  useEffect(() => {
    if (!tabReady) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    fetchProfiles(
      page,
      itemsPerPage,
      activeTab,
      filters,
      false,
      activeTab === "random" ? profiles.map((profile) => profile._id) : [],
      activeTab === "latest" && profiles.length > 0 ? profiles[profiles.length - 1] : null
    );
  }, [tabReady, page, activeTab, filters, fetchProfiles, itemsPerPage]);

  useEffect(() => {
    if (!tabReady || typeof window === "undefined" || activeTab === "random") return;
    try {
      sessionStorage.setItem(
        getFeedCacheKey(activeTab, filters),
        JSON.stringify({
          profiles,
          page,
          hasMoreProfiles,
          scrollY: window.scrollY,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.warn("Failed to persist feed cache:", error);
    }
  }, [profiles, page, hasMoreProfiles, activeTab, filters, tabReady]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTab) return;

    const saveScroll = () => {
      try {
        const cached = sessionStorage.getItem(getFeedCacheKey(activeTab, filters));
        if (!cached) return;
        const parsed = JSON.parse(cached);
        sessionStorage.setItem(
          getFeedCacheKey(activeTab, filters),
          JSON.stringify({
            ...parsed,
            scrollY: window.scrollY,
            timestamp: Date.now(),
          })
        );
      } catch (error) {
        console.warn("Failed to update feed scroll cache:", error);
      }
    };

    window.addEventListener("pagehide", saveScroll);
    return () => {
      saveScroll();
      window.removeEventListener("pagehide", saveScroll);
    };
  }, [activeTab, filters]);

  const skeletonCards = Array.from({ length: 3 });

  const handleShareExperienceClick = (event) => {
    // A modified click opens a new tab and leaves THIS one under a permanent
    // full-screen overlay, because nothing ever unmounts to reset the flag.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    setIsShareButtonLoading(true);
  };

  // Navigating (or coming back) must always clear the blocking overlay.
  useEffect(() => {
    setIsShareButtonLoading(false);
  }, [pathname]);

  const activeFilterCount = [filters.company, filters.author, filters.college, filters.branch, filters.batch].filter(Boolean).length;

  const handleFilterChange = (key, value) => {
    setProfiles([]);
    setPage(0);
    setHasMoreProfiles(true);
    skipNextFetchRef.current = false;
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // Refresh used to call fetchProfiles(0, ...) without resetting `page`, so the
  // next intersection asked for page N+1 and everything between 0 and N was
  // silently skipped.
  const refreshFeed = () => {
    setProfiles([]);
    setHasMoreProfiles(true);
    skipNextFetchRef.current = false;
    if (page === 0) {
      fetchProfiles(0, itemsPerPage, activeTab, filters, true);
    } else {
      setPage(0); // the page effect issues the fetch
    }
  };

  const clearFilters = () => {
    setProfiles([]);
    setPage(0);
    setHasMoreProfiles(true);
    skipNextFetchRef.current = false;
    // Only set state. This used to ALSO call fetchProfiles directly, and the
    // filters effect then fired a second request that aborted the first --
    // throwing away the forceRefresh the direct call was made for.
    setFilters({
      company: "",
      author: "",
      college: "",
      branch: "",
      batch: "",
    });
  };

  const handleSearchChange = useCallback((value) => {
    setProfiles([]);
    setPage(0);
    setHasMoreProfiles(true);
    skipNextFetchRef.current = false;
    setSearchQuery(value);
  }, []);

  // NB: plain <div>s, not <label>s. A <label> without htmlFor forwards a click to
  // its first labelable descendant -- the dropdown's toggle button -- so selecting
  // an option set the value and then immediately re-opened the menu, which read as
  // "picking a company does nothing".
  const renderFilterFields = () => (
    <div className="space-y-4">
      <div className="block space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <Building2 className="h-3.5 w-3.5" />
          Company
        </span>
        <SearchableDropdown
          options={[{ label: "All companies", value: "" }, ...companyOptions.map((company) => ({ label: company, value: company }))]}
          value={filters.company}
          onChange={(value) => handleFilterChange("company", value)}
          placeholder="All companies"
          loading={companiesLoading}
        />
      </div>

      <div className="block space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <UserRound className="h-3.5 w-3.5" />
          Author
        </span>
        <SearchableDropdown
          options={[{ label: "All authors", value: "" }, ...authorOptions]}
          value={filters.author}
          onChange={(value) => handleFilterChange("author", value)}
          placeholder="All authors"
          loading={authorsLoading}
        />
      </div>

      <div className="block space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          College
        </span>
        <SearchableDropdown
          options={[{ label: "All colleges", value: "" }, ...collegeOptions.map((college) => ({ label: college, value: college }))]}
          value={filters.college}
          onChange={(value) => handleFilterChange("college", value)}
          placeholder="All colleges"
          remoteSearch
          loading={collegeLoading}
          hasMore={collegeHasMore}
          onSearchTermChange={setCollegeSearchTerm}
          onLoadMore={() => {
            if (!collegeLoading && collegeHasMore) {
              loadCollegeOptions(collegeSearchTerm, collegePage + 1);
            }
          }}
        />
      </div>

      <div className="block space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <GraduationCap className="h-3.5 w-3.5" />
          Department
        </span>
        <SearchableDropdown
          options={[{ label: "All departments", value: "" }, ...BRANCH_OPTIONS]}
          value={filters.branch}
          onChange={(value) => handleFilterChange("branch", value)}
          placeholder="All departments"
        />
      </div>

      <div className="block space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <CalendarDays className="h-3.5 w-3.5" />
          Year
        </span>
        <SearchableDropdown
          options={[{ label: "All years", value: "" }, ...YEAR_OPTIONS.map((year) => ({ label: year, value: year }))]}
          value={filters.batch}
          onChange={(value) => handleFilterChange("batch", value)}
          placeholder="All years"
        />
      </div>
    </div>
  );

  return (
    <main className="relative min-h-screen overflow-x-clip bg-slate-50 font-sans dark:bg-slate-950">
      <Navbar showThemeToggle />
      {isShareButtonLoading && <LoadingScreen isDarkMode={isDarkMode} />}

      <div className="relative mx-auto w-full max-w-[820px] px-4 pb-14 pt-20 sm:px-6 md:pt-24 2xl:px-0">
        <div className="relative">
          <aside className="hidden 2xl:absolute 2xl:bottom-0 2xl:right-[calc(100%+20px)] 2xl:top-0 2xl:block 2xl:w-[300px]">
          <div className="space-y-3 2xl:sticky 2xl:top-24 2xl:max-h-[calc(100vh-6.5rem)] 2xl:overflow-y-auto 2xl:pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-2">
            <div className="inline-flex min-w-0 flex-1 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-800/50">
              {[
                { value: "latest", label: "Latest", icon: Clock },
                { value: "trending", label: "Trending", icon: Zap },
                { value: "random", label: "Feed", icon: RefreshCw },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveTab(value)}
                  className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-2 text-xs font-semibold transition ${activeTab === value
                    ? "bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refreshFeed}
              disabled={pageLoading}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              title="Refresh feed"
              aria-label="Refresh feed"
            >
              <RefreshCw className={`h-4 w-4 ${pageLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Refine The Feed</span>
              </div>
              {activeFilterCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </div>
            {renderFilterFields()}
            <button
              type="button"
              onClick={clearFilters}
              disabled={activeFilterCount === 0}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          </div>
          </div>
          </aside>

          <aside className="mb-5 2xl:absolute 2xl:bottom-0 2xl:left-[calc(100%+20px)] 2xl:top-0 2xl:mb-0 2xl:w-[300px]">
          <div className="space-y-3 2xl:sticky 2xl:top-24">

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 [&>div]:mb-0">
            <FeedHero isDarkMode={isDarkMode} />
          </div>
          </div>
          </aside>

          <div className="min-w-0">
          <div className="sticky top-[59px] z-30 mb-4 bg-slate-50/95 py-2 backdrop-blur-md dark:bg-slate-950/95">
            <FeedSearch onSearchChange={handleSearchChange} />
          </div>
          <section className="2xl:hidden">
          {/* Header & Tabs */}
          <div className="mb-6 border-b border-slate-100 pb-4 dark:border-slate-800">
            {/* Tab Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-800/50">
                {[
                  { value: "latest", label: "Latest", icon: Clock },
                  { value: "trending", label: "Trending", icon: Zap },
                  { value: "random", label: "Feed", icon: RefreshCw },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setActiveTab(value)}
                    className={`inline-flex min-w-0 w-full items-center justify-center gap-1 rounded-md px-1.5 py-2 text-[11px] font-semibold whitespace-nowrap transition-all sm:gap-2 sm:px-3.5 sm:py-1.5 sm:text-sm ${activeTab === value
                      ? "bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>

              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={refreshFeed}
                  disabled={pageLoading}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                  title="Refresh feed"
                  aria-label="Refresh feed"
                >
                  <RefreshCw className={`h-4 w-4 ${pageLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="w-full">
                <Link
                  href="/post?type=interview"
                  onClick={handleShareExperienceClick}
                  prefetch={true}
                  scroll={false}
                  className="inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95 sm:py-2 sm:text-sm"
                >
                  <Send className="h-4 w-4" />
                  Post Your Story
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

          <div className="relative z-20 rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/20 2xl:hidden">
            <div className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${filtersOpen ? "border-b border-slate-100 dark:border-slate-800" : ""}`}>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className="flex items-center gap-2.5 text-left"
                aria-expanded={filtersOpen}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Refine The Feed</span>
                {activeFilterCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearFilters}
                  disabled={activeFilterCount === 0}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              </div>
            </div>

            {filtersOpen && (
              <div className="p-4 sm:p-5">{renderFilterFields()}</div>
            )}
          </div>
        </section>

        <div className="mt-4 space-y-2.5">
          {pageLoading && page === 0 && profiles.length === 0 ? (
            skeletonCards.map((_, index) => <ProfileCardSkeleton key={index} />)
          ) : (
            <AnimatePresence mode="popLayout">
              {profiles.map((profile, index) => (
                <motion.div
                  key={profile._id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.28, delay: (index % 10) * 0.025 }}
                >
                  <FeedPostCard
                    profile={profile}
                    onCompanyFilter={(company) => {
                      handleFilterChange("company", company);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}

            {/* Sentinel for Intersection Observer */}
            <div ref={lastProfileElementRef} className="h-4 w-full" />

            {profiles.length === 0 && !pageLoading && hasFetchedRef.current && (
              <div className="py-20 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl bg-slate-50 text-slate-300 dark:bg-slate-800/50 dark:text-slate-600">
                  <Clock size={32} />
                </div>
                <p className="text-base font-medium text-slate-500 dark:text-slate-400">
                  No stories found for this category yet.
                </p>
                <button
                  onClick={() => {
                    setActiveTab("latest");
                    clearFilters();
                  }}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-600 transition hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>

          <div className="mt-12 flex flex-col items-center space-y-4 pb-2">
            {pageLoading && (
              <div className="flex items-center space-x-3 rounded-full border border-indigo-100 bg-white px-6 py-3 text-indigo-600 shadow-sm dark:border-blue-500/40 dark:bg-slate-900 dark:text-blue-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm font-semibold">Loading more experiences...</span>
              </div>
            )}

            {!pageLoading && !hasMoreProfiles && profiles.length > 0 && (
              <div className="flex w-full items-center justify-center py-6">
                <div className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-700" />
                <span className="px-4 text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">You have reached the end</span>
                <div className="h-[1px] flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </main>
  );
}
