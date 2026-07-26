import { useState } from "react";

export const DISPLAY_PAGE_SIZE = 25;

export function useSourcingPagination() {
  const [visibleCount, setVisibleCount] = useState(DISPLAY_PAGE_SIZE);

  const showMore = (totalCandidates: number) =>
    setVisibleCount((n) => Math.min(n + DISPLAY_PAGE_SIZE, totalCandidates));

  const reset = () => setVisibleCount(DISPLAY_PAGE_SIZE);

  return { visibleCount, showMore, reset };
}
