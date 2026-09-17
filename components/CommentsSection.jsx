"use client";

import { CheckCircle2, Heart, MessageSquare, Reply, Send, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useAuthModal } from "@/components/AuthModalProvider";
import ProfileAvatar from "@/components/ProfileAvatar";
import { resolveProfileImage, resolveProfileName } from "@/lib/utils";
import { readJson } from "@/lib/client-api";
import Alert from "@/components/ui/Alert";

const DEFAULT_COMMENT_TYPES = ["doubt", "tip", "experience", "general"];

const TYPE_META = {
  doubt: { label: "Doubt", badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-500/35" },
  tip: { label: "Tip", badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-300 dark:border-emerald-500/35" },
  experience: { label: "My experience", badgeClass: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/35 dark:text-violet-300 dark:border-violet-500/35" },
  general: { label: "General", badgeClass: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700" },
};

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

function initialsFromName(name) {
  if (!name) return "U";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function buildOptimisticAuthor(session) {
  const name = session?.user?.name || null;
  return {
    name,
    profilePic: session?.user?.image || null,
    initials: initialsFromName(name),
    batch: null,
    branch: null,
  };
}

function updateMetaOnCreate(prevMeta, type) {
  const nextType = type && prevMeta.countsByType[type] !== undefined ? type : "general";
  return {
    ...prevMeta,
    totalComments: (prevMeta.totalComments || 0) + 1,
    countsByType: {
      ...prevMeta.countsByType,
      [nextType]: (prevMeta.countsByType[nextType] || 0) + 1,
    },
  };
}

function addReplyToTree(nodes, parentId, replyComment) {
  let inserted = false;

  const nextNodes = nodes.map((node) => {
    if (node.id === parentId) {
      inserted = true;
      const nextReplies = Array.isArray(node.replies) ? [...node.replies, replyComment] : [replyComment];
      return {
        ...node,
        replyCount: (node.replyCount || 0) + 1,
        nestedCount: (node.nestedCount || 0) + 1,
        replies: nextReplies,
      };
    }

    if (!Array.isArray(node.replies) || node.replies.length === 0) {
      return node;
    }

    const childResult = addReplyToTree(node.replies, parentId, replyComment);
    if (childResult.inserted) {
      inserted = true;
      return {
        ...node,
        nestedCount: (node.nestedCount || 0) + 1,
        replies: childResult.nodes,
      };
    }

    return node;
  });

  return { nodes: nextNodes, inserted };
}

function updateResolvedInTree(nodes, commentId, isResolved) {
  return nodes.map((node) => {
    if (node.id === commentId) {
      return { ...node, isResolved };
    }
    if (!Array.isArray(node.replies) || node.replies.length === 0) {
      return node;
    }
    return {
      ...node,
      replies: updateResolvedInTree(node.replies, commentId, isResolved),
    };
  });
}

function replaceCommentInTree(nodes, commentId, replacement) {
  return nodes.map((node) => {
    if (node.id === commentId) {
      return { ...replacement, replies: node.replies };
    }
    if (!Array.isArray(node.replies) || node.replies.length === 0) {
      return node;
    }
    return {
      ...node,
      replies: replaceCommentInTree(node.replies, commentId, replacement),
    };
  });
}

// Mirrors addReplyToTree's count bookkeeping so an optimistic reply that
// failed to save can be undone without leaving replyCount/nestedCount stale.
function removeReplyFromTree(nodes, parentId, replyId) {
  let removed = false;

  const nextNodes = nodes.map((node) => {
    if (node.id === parentId) {
      removed = true;
      const nextReplies = Array.isArray(node.replies)
        ? node.replies.filter((reply) => reply.id !== replyId)
        : [];
      return {
        ...node,
        replyCount: Math.max(0, (node.replyCount || 0) - 1),
        nestedCount: Math.max(0, (node.nestedCount || 0) - 1),
        replies: nextReplies,
      };
    }

    if (!Array.isArray(node.replies) || node.replies.length === 0) {
      return node;
    }

    const childResult = removeReplyFromTree(node.replies, parentId, replyId);
    if (childResult.removed) {
      removed = true;
      return {
        ...node,
        nestedCount: Math.max(0, (node.nestedCount || 0) - 1),
        replies: childResult.nodes,
      };
    }

    return node;
  });

  return { nodes: nextNodes, removed };
}

function updateUpvoteInTree(nodes, commentId, nextHasUpvoted, nextUpvotesCount = null) {
  return nodes.map((node) => {
    if (node.id === commentId) {
      const previousHasUpvoted = Boolean(node.hasUpvoted);
      const resolvedHasUpvoted = Boolean(nextHasUpvoted);
      const fallbackCount = Math.max(
        0,
        (node.upvotesCount || 0) + (resolvedHasUpvoted === previousHasUpvoted ? 0 : resolvedHasUpvoted ? 1 : -1)
      );

      return {
        ...node,
        hasUpvoted: resolvedHasUpvoted,
        upvotesCount:
          typeof nextUpvotesCount === "number" ? Math.max(0, nextUpvotesCount) : fallbackCount,
      };
    }

    if (!Array.isArray(node.replies) || node.replies.length === 0) {
      return node;
    }

    return {
      ...node,
      replies: updateUpvoteInTree(node.replies, commentId, nextHasUpvoted, nextUpvotesCount),
    };
  });
}

export default function CommentsSection({ experienceId, companyName, articleAuthorName }) {
  const { data: session } = useSession();
  const isAuthenticated = Boolean(session?.user);
  const { openAuthModal } = useAuthModal();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comments, setComments] = useState([]);
  const [meta, setMeta] = useState({
    totalComments: 0,
    countsByType: { doubt: 0, tip: 0, experience: 0, general: 0 },
    resolvedCount: 0,
    uiConfig: { maxCommentLength: 1000, allowedTypes: DEFAULT_COMMENT_TYPES },
  });

  const [sort, setSort] = useState("top");
  const [filter, setFilter] = useState("all");
  const [composeType, setComposeType] = useState("general");
  const [composeText, setComposeText] = useState("");
  const [posting, setPosting] = useState(false);
  const [resolvingId, setResolvingId] = useState("");
  const [likingCommentId, setLikingCommentId] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [expanded, setExpanded] = useState({});
  const [postingReplyId, setPostingReplyId] = useState("");
  const [highlightedCommentId, setHighlightedCommentId] = useState("");

  const loadComments = useCallback(async (signal) => {
    if (!experienceId) {
      setError("Comments unavailable: invalid experience id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/comments?experienceId=${encodeURIComponent(experienceId)}&page=1&limit=40&depth=5&sort=${encodeURIComponent(sort)}`,
        { cache: "no-store", signal }
      );
      const json = await readJson(res, {});
      if (!res.ok) {
        throw new Error(json?.error || "Failed to fetch comments");
      }
      setComments(Array.isArray(json.comments) ? json.comments : []);
      setMeta({
        totalComments: json.totalComments || 0,
        countsByType: json.countsByType || { doubt: 0, tip: 0, experience: 0, general: 0 },
        resolvedCount: json.resolvedCount || 0,
        uiConfig: json.uiConfig || { maxCommentLength: 1000, allowedTypes: DEFAULT_COMMENT_TYPES },
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to fetch comments");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [experienceId, sort]);

  useEffect(() => {
    // Toggling sort refires this; without an abort the responses could land out
    // of order and show results for the sort the pill no longer says.
    const controller = new AbortController();
    loadComments(controller.signal);
    return () => controller.abort();
  }, [loadComments]);

  useEffect(() => {
    const syncHashTarget = () => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash || "";
      setHighlightedCommentId(hash.startsWith("#comment-") ? hash.replace("#comment-", "") : "");
    };

    syncHashTarget();
    window.addEventListener("hashchange", syncHashTarget);
    return () => window.removeEventListener("hashchange", syncHashTarget);
  }, []);

  // `comments` was a dependency, so every upvote, reply or resolve re-ran this and
  // yanked the viewport back to the hash target.
  useEffect(() => {
    if (!highlightedCommentId || loading) return;

    const target = document.getElementById(`comment-${highlightedCommentId}`);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedCommentId, loading]);

  const filteredComments = useMemo(() => {
    if (filter === "all") return comments;
    if (filter === "resolved") return comments.filter((item) => item.isResolved);
    return comments.filter((item) => item.type === filter);
  }, [comments, filter]);

  const toggleCommentLike = async (item) => {
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }

    if (likingCommentId === item.id) return;

    const previousHasUpvoted = Boolean(item.hasUpvoted);
    const previousUpvotesCount = Number(item.upvotesCount) || 0;

    setLikingCommentId(item.id);
    setComments((prev) => updateUpvoteInTree(prev, item.id, !previousHasUpvoted));

    try {
      const res = await fetch("/api/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentId: item.id,
          action: "toggle-upvote",
        }),
      });
      const json = await readJson(res, {});
      if (!res.ok) {
        if (res.status === 401) openAuthModal();
        // Throw either way so the catch below rolls the optimistic update back.
        throw new Error(json?.error || (res.status === 401 ? "Please sign in again." : "Failed to like comment"));
      }

      setComments((prev) =>
        updateUpvoteInTree(
          prev,
          item.id,
          Boolean(json?.comment?.hasUpvoted),
          Number(json?.comment?.upvotesCount) || 0
        )
      );
    } catch (err) {
      setError(err.message || "Failed to like comment");
      setComments((prev) =>
        updateUpvoteInTree(prev, item.id, previousHasUpvoted, previousUpvotesCount)
      );
    } finally {
      setLikingCommentId("");
    }
  };

  const submitComment = async () => {
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }
    const trimmed = composeText.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError("");

    const tempId = `temp-${Date.now()}`;
    const optimisticComment = {
      id: tempId,
      experienceId,
      parentCommentId: null,
      rootCommentId: null,
      depth: 0,
      level: 1,
      text: trimmed,
      type: composeType,
      isResolved: false,
      upvotesCount: 0,
      hasUpvoted: false,
      canReply: true,
      canResolve: composeType === "doubt",
      isOwnComment: true,
      author: buildOptimisticAuthor(session),
      companyTag: null,
      timeAgo: "Just now",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replyCount: 0,
      nestedCount: 0,
      replies: [],
    };

    setComments((prev) => (sort === "recent" ? [optimisticComment, ...prev] : [...prev, optimisticComment]));
    setMeta((prev) => updateMetaOnCreate(prev, composeType));
    // The list renders `filteredComments`: posting a "general" comment while
    // the "tips" pill was active showed nothing at all, so people posted again.
    setFilter((prev) => (prev === "all" || prev === composeType ? prev : "all"));
    setComposeText("");

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experienceId,
          text: trimmed,
          type: composeType,
        }),
      });
      const json = await readJson(res, {});
      if (!res.ok) {
        if (res.status === 401) openAuthModal();
        throw new Error(json?.error || (res.status === 401 ? "Please sign in again." : "Failed to post comment"));
      }
      const created = json?.comment;
      if (created && !created.parentCommentId) {
        setComments((prev) => replaceCommentInTree(prev, tempId, created));
      }
    } catch (err) {
      setError(err.message || "Failed to post comment");
      setComments((prev) => prev.filter((node) => node.id !== tempId));
      setMeta((prev) => ({
        ...prev,
        totalComments: Math.max(0, (prev.totalComments || 0) - 1),
        countsByType: {
          ...prev.countsByType,
          [composeType]: Math.max(0, (prev.countsByType[composeType] || 0) - 1),
        },
      }));
      setComposeText(trimmed);
    } finally {
      setPosting(false);
    }
  };

  const submitReply = async (parent) => {
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }
    const value = (replyDrafts[parent.id] || "").trim();
    if (!value || postingReplyId) return;
    setPostingReplyId(parent.id);
    setError("");

    const tempId = `temp-${Date.now()}`;
    const parentDepth = parent.depth || 0;
    const optimisticReply = {
      id: tempId,
      experienceId,
      parentCommentId: parent.id,
      rootCommentId: parent.rootCommentId || parent.id,
      depth: parentDepth + 1,
      level: parentDepth + 2,
      text: value,
      type: "general",
      isResolved: false,
      upvotesCount: 0,
      hasUpvoted: false,
      canReply: parentDepth + 1 < 2,
      canResolve: false,
      isOwnComment: true,
      author: buildOptimisticAuthor(session),
      companyTag: null,
      timeAgo: "Just now",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replyCount: 0,
      nestedCount: 0,
      replies: [],
    };

    setComments((prev) => addReplyToTree(prev, parent.id, optimisticReply).nodes);
    setMeta((prev) => updateMetaOnCreate(prev, "general"));
    setReplyDrafts((prev) => ({ ...prev, [parent.id]: "" }));
    setExpanded((prev) => ({ ...prev, [parent.id]: true }));

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experienceId,
          parentCommentId: parent.id,
          text: value,
          type: "general",
        }),
      });
      const json = await readJson(res, {});
      if (!res.ok) {
        if (res.status === 401) openAuthModal();
        throw new Error(json?.error || (res.status === 401 ? "Please sign in again." : "Failed to post reply"));
      }
      const createdReply = json?.comment;
      if (createdReply) {
        setComments((prev) => replaceCommentInTree(prev, tempId, createdReply));
      }
    } catch (err) {
      setError(err.message || "Failed to post reply");
      setComments((prev) => removeReplyFromTree(prev, parent.id, tempId).nodes);
      setMeta((prev) => ({
        ...prev,
        totalComments: Math.max(0, (prev.totalComments || 0) - 1),
        countsByType: {
          ...prev.countsByType,
          general: Math.max(0, (prev.countsByType.general || 0) - 1),
        },
      }));
      setReplyDrafts((prev) => ({ ...prev, [parent.id]: value }));
    } finally {
      setPostingReplyId("");
    }
  };

  const toggleResolved = async (item) => {
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }
    if (resolvingId) return;

    const previousResolved = Boolean(item.isResolved);
    const optimisticResolved = !previousResolved;
    const action = previousResolved ? "unresolve" : "resolve";

    setResolvingId(item.id);
    setError("");
    setComments((prev) => updateResolvedInTree(prev, item.id, optimisticResolved));
    setMeta((prev) => ({
      ...prev,
      resolvedCount: Math.max(0, (prev.resolvedCount || 0) + (optimisticResolved ? 1 : -1)),
    }));

    try {
      const res = await fetch("/api/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentId: item.id,
          action,
        }),
      });
      const json = await readJson(res, {});
      if (!res.ok) {
        if (res.status === 401) openAuthModal();
        throw new Error(json?.error || (res.status === 401 ? "Please sign in again." : "Failed to update status"));
      }

      const nextResolved = Boolean(json?.comment?.isResolved);
      if (nextResolved !== optimisticResolved) {
        setComments((prev) => updateResolvedInTree(prev, item.id, nextResolved));
        setMeta((prev) => ({
          ...prev,
          resolvedCount: Math.max(0, (prev.resolvedCount || 0) + (nextResolved ? 1 : -1) - (optimisticResolved ? 1 : -1)),
        }));
      }
    } catch (err) {
      setError(err.message || "Failed to update status");
      setComments((prev) => updateResolvedInTree(prev, item.id, previousResolved));
      setMeta((prev) => ({
        ...prev,
        resolvedCount: Math.max(0, (prev.resolvedCount || 0) + (previousResolved ? 1 : -1)),
      }));
    } finally {
      setResolvingId("");
    }
  };

  const renderComment = (item, level = 0) => {
    const isReply = level > 0;
    const typeMeta = TYPE_META[item.type] || TYPE_META.general;
    const repliesOpen = Boolean(expanded[item.id]);
    const hasReplies = (item.replyCount || 0) > 0;
    const authorInitials = item.author?.initials || initialsFromName(item.author?.name);
    const isArticleAuthor =
      articleAuthorName &&
      item.author?.name &&
      String(articleAuthorName).trim().toLowerCase() === String(item.author.name).trim().toLowerCase();

    return (
      <div
        key={item.id}
        id={`comment-${item.id}`}
        className={cn(
          "border border-slate-200/80 bg-white/95 dark:border-slate-700/80 dark:bg-slate-900/90",
          isReply ? "mt-2 rounded-xl p-3 scroll-mt-28" : "rounded-xl p-4 scroll-mt-28 sm:p-5",
          highlightedCommentId === item.id
            ? "ring-2 ring-blue-300 dark:ring-blue-400/60"
            : ""
        )}
      >
        <div className={cn("flex", isReply ? "gap-2.5" : "gap-3")}>
          <div className={cn("shrink-0 overflow-hidden rounded-full shadow-sm ring-1 ring-slate-100 dark:ring-slate-800", isReply ? "h-7 w-7" : "h-9 w-9")}>
            <ProfileAvatar
              src={resolveProfileImage(item.author)}
              name={resolveProfileName(item.author)}
              alt={item.author?.name || "User"}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("flex flex-wrap items-center", isReply ? "mb-1.5 gap-1.5" : "mb-2 gap-2")}>
              <span className={cn("font-semibold text-slate-900 dark:text-slate-100", isReply ? "text-xs" : "text-sm")}>
                {item.author?.name || "Anonymous"}
              </span>
              {isArticleAuthor ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">Author</span>
              ) : null}
              {item.author?.batch ? (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{item.author.batch}</span>
              ) : null}
              {!isReply ? (
                <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", typeMeta.badgeClass)}>
                  {typeMeta.label}
                </span>
              ) : null}
              {item.isResolved ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-emerald-950/35 dark:text-emerald-300">
                  <CheckCircle2 size={10} />
                  Resolved
                </span>
              ) : null}
              <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{item.timeAgo || ""}</span>
            </div>

            <p
              className={cn(
                "whitespace-pre-wrap text-slate-700 dark:text-slate-300",
                isReply ? "text-xs leading-5" : "text-sm leading-6"
              )}
            >
              {item.text}
            </p>

            <div className={cn("flex flex-wrap items-center text-xs", isReply ? "mt-2 gap-2" : "mt-3 gap-3")}>
              <button
                type="button"
                onClick={() => toggleCommentLike(item)}
                disabled={likingCommentId === item.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition",
                  item.hasUpvoted
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/35 dark:text-rose-300"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
                  likingCommentId === item.id ? "cursor-not-allowed opacity-70" : ""
                )}
              >
                <Heart size={12} />
                {item.upvotesCount || 0} helpful
              </button>
              {item.canReply ? (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: true }))}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Reply size={12} />
                  Reply
                </button>
              ) : null}
              {hasReplies ? (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500/35 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/50"
                >
                  {repliesOpen ? "Hide replies" : `View ${item.replyCount} repl${item.replyCount === 1 ? "y" : "ies"}`}
                </button>
              ) : null}
              {item.canResolve ? (
                <button
                  type="button"
                  onClick={() => toggleResolved(item)}
                  disabled={resolvingId === item.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/35 dark:bg-emerald-950/35 dark:text-emerald-300"
                >
                  <CheckCircle2 size={12} />
                  {item.isResolved ? "Mark unresolved" : "Mark resolved"}
                </button>
              ) : null}
            </div>

            {(repliesOpen || hasReplies) && item.canReply ? (
              <div className={cn("flex items-center gap-2", isReply ? "mt-2" : "mt-3")}>
                <input
                  value={replyDrafts[item.id] || ""}
                  onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  onFocus={() => {
                    if (!isAuthenticated) openAuthModal();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitReply(item);
                    }
                  }}
                  readOnly={!isAuthenticated}
                  placeholder="Add a reply..."
                  className={cn(
                    "w-full rounded-full border border-slate-200 bg-white px-3 text-slate-700 outline-none ring-blue-500 transition focus:border-blue-300 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-400 dark:focus:ring-blue-500/30",
                    isReply ? "h-8 text-xs" : "h-9 text-sm"
                  )}
                />
                <button
                  type="button"
                  onClick={() => submitReply(item)}
                  disabled={postingReplyId === item.id || !(replyDrafts[item.id] || "").trim()}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-blue-600 dark:hover:bg-blue-500 dark:disabled:bg-slate-700",
                    isReply ? "h-8" : "h-9"
                  )}
                >
                  <Send size={12} />
                  Send
                </button>
              </div>
            ) : null}

            {repliesOpen && Array.isArray(item.replies) && item.replies.length > 0 ? (
              <div className="mt-3 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                {item.replies.map((child) => renderComment(child, level + 1))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="relative mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
      <div className="pointer-events-none absolute -left-16 -top-16 h-52 w-52 rounded-full bg-blue-200/25 blur-3xl dark:bg-blue-500/15" />
      <div className="pointer-events-none absolute -right-16 -bottom-16 h-52 w-52 rounded-full bg-blue-200/25 blur-3xl dark:bg-blue-500/15" />

      <div className="relative mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
        <h2 className="inline-flex items-center gap-2 text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
          <MessageSquare size={20} className="text-blue-600 dark:text-blue-300" />
          Discussion
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            {meta.totalComments} comments
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setSort((prev) => (prev === "top" ? "recent" : "top"))}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <SlidersHorizontal size={13} />
          {sort === "top" ? "Top" : "Recent"}
        </button>
      </div>

      <div className="relative rounded-xl border border-slate-200/60 bg-slate-50/50 p-4 transition-all focus-within:border-blue-400/50 focus-within:bg-white focus-within:shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:border-slate-700/50 dark:bg-slate-800/40 dark:focus-within:border-blue-500/30 dark:focus-within:bg-slate-900/40">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tag as:</span>
          <div className="flex flex-wrap gap-1.5">
            {(meta.uiConfig?.allowedTypes || DEFAULT_COMMENT_TYPES).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setComposeType(type)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all duration-200",
                  composeType === type
                    ? "border-blue-500 bg-blue-100 text-blue-800 shadow-sm ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-500/20"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600"
                )}
              >
                {TYPE_META[type]?.label || type}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={composeText}
          onChange={(e) => setComposeText(e.target.value.slice(0, meta.uiConfig.maxCommentLength || 1000))}
          onFocus={() => {
            if (!isAuthenticated) openAuthModal();
          }}
          readOnly={!isAuthenticated}
          placeholder={
            isAuthenticated
              ? `Ask a doubt, share a tip, or discuss your experience at ${companyName || "this company"}...`
              : "Sign in to add your comment"
          }
          className="min-h-[100px] w-full resize-none border-none bg-transparent p-0 text-[14px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200"
        />
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/50">
          <span className="rounded-full border border-slate-200/80 bg-slate-50/70 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/75 dark:text-slate-300">
            {composeText.length}/{meta.uiConfig.maxCommentLength || 1000} characters
          </span>
          <button
            type="button"
            onClick={submitComment}
            disabled={posting || !composeText.trim()}
            className="flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-blue-600 dark:hover:bg-blue-500 dark:disabled:bg-slate-700"
          >
            <Send size={14} />
            Post
          </button>
        </div>
      </div>

      <div className="relative mt-8 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-1 dark:border-slate-700/80">
        {[
          { key: "all", label: "All" },
          { key: "doubt", label: "Doubts" },
          { key: "tip", label: "Tips" },
          { key: "experience", label: "Experiences" },
          { key: "general", label: "General" },
          { key: "resolved", label: "Resolved" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn(
              "relative rounded-full px-3 py-1.5 text-[13px] font-bold transition-all duration-200",
              filter === item.key
                ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-500/35"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Alert tone="error" className="mt-4">{error}</Alert>

      {loading ? (
        <div className="mt-6 space-y-4">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-28 animate-pulse rounded-xl border border-slate-200/60 bg-slate-50/50 dark:border-slate-700/50 dark:bg-slate-800/40" />
          ))}
        </div>
      ) : filteredComments.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300/70 bg-slate-50/60 p-6 dark:border-slate-700/70 dark:bg-slate-800/35">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm dark:bg-slate-900/70">
              <MessageSquare size={22} className="text-blue-500 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No comments yet</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Start the discussion with a doubt, tip, or experience.</p>
            </div>
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Use the input above to post the first comment.</p>
        </div>
      ) : (
        <div className="relative mt-4 space-y-3">{filteredComments.map((item) => renderComment(item))}</div>
      )}

    </section>
  );
}
