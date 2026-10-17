"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export default function FeedSearch({ contentType = "interview", onSearchChange }) {
  const inputRef = useRef(null);
  const emittedQueryRef = useRef("");
  const [query, setQuery] = useState("");

  const updateQuery = (value) => {
    setQuery(value);
    if (value.trim()) return;

    // Clearing should restore the full feed immediately. Mark it emitted so
    // the debounce effect below doesn't send a duplicate empty search.
    emittedQueryRef.current = "";
    onSearchChange("");
  };

  useEffect(() => {
    const normalized = query.trim();
    if (normalized === emittedQueryRef.current) return undefined;
    const timer = window.setTimeout(() => {
      emittedQueryRef.current = normalized;
      onSearchChange(normalized);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [onSearchChange, query]);

  useEffect(() => {
    const handleShortcut = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="relative flex h-12 items-center rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-blue-500">
      <Search className="pointer-events-none absolute left-4 h-5 w-5 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => updateQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            updateQuery("");
            inputRef.current?.blur();
          }
        }}
        placeholder={contentType === "tale" ? "Search tales, topics, or authors" : "Search experiences, companies, or people"}
        aria-label={contentType === "tale" ? "Search tales" : "Search interview experiences"}
        autoComplete="off"
        className="h-full w-full rounded-xl bg-transparent pl-12 pr-24 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            updateQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : (
        <kbd className="absolute right-4 hidden rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 sm:block">/</kbd>
      )}
    </div>
  );
}
