"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type PageToken = number | "ellipsis-left" | "ellipsis-right";

function pageTokens(page: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const ordered = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const tokens: PageToken[] = [];

  ordered.forEach((value, index) => {
    const previous = ordered[index - 1];
    if (previous && value - previous > 1) tokens.push(previous === 1 ? "ellipsis-left" : "ellipsis-right");
    tokens.push(value);
  });

  return tokens;
}

export function TablePagination({ page, pageSize, totalItems, onPageChange }: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-border bg-card/35 px-5 py-2.5">
      <p className="text-[11px] font-mono text-muted-foreground" aria-live="polite">
        Showing {firstItem}-{lastItem} of {totalItems}
      </p>
      <nav className="flex items-center gap-1" aria-label="Table pages">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
        </button>
        {pageTokens(page, totalPages).map((token) =>
          typeof token === "number" ? (
            <button key={token} type="button" onClick={() => onPageChange(token)} aria-current={page === token ? "page" : undefined} aria-label={`Page ${token}`} className={`h-8 min-w-8 rounded-md border px-2 text-[11px] font-mono transition-colors ${page === token ? "border-primary/35 bg-primary/12 text-primary" : "border-border text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"}`}>
              {token}
            </button>
          ) : (
            <span key={token} className="w-6 text-center text-[11px] text-muted-foreground/60" aria-hidden="true">...</span>
          ),
        )}
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35">
          Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
