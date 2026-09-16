"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";

const labels = {
  en: { more: "Show more", loading: "Loading…", count: "Showing {shown} of {total}" },
  hy: { more: "Ցույց տալ ավելին", loading: "Բեռնվում է…", count: "Ցուցադրված է {shown}՝ {total}-ից" },
  ru: { more: "Показать ещё", loading: "Загрузка…", count: "Показано {shown} из {total}" },
};

type Props<T> = {
  items: readonly T[];
  batchSize: number;
  locale: Locale;
  renderItem: (item: T, index: number) => ReactNode;
};

export default function ProgressiveList<T>({ items, batchSize, locale, renderItem }: Props<T>) {
  "use memo";
  const [page, setPage] = useState({ items, limit: batchSize });
  const [isPending, startTransition] = useTransition();
  // Reset in the same render when filtering, sorting, or a new search changes
  // the list; an effect would briefly paint the old expanded result count.
  if (page.items !== items) setPage({ items, limit: batchSize });
  const limit = page.items === items ? page.limit : batchSize;
  const shown = Math.min(limit, items.length);
  const copy = labels[locale];

  return (
    <>
      {items.slice(0, shown).map(renderItem)}
      {items.length > batchSize && (
        <div className="progressive-list-controls">
          <span role="status">
            {copy.count.replace("{shown}", String(shown)).replace("{total}", String(items.length))}
          </span>
          {shown < items.length && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => {
                setPage((current) => ({ items, limit: (current.items === items ? current.limit : batchSize) + batchSize }));
              })}
            >
              {isPending ? copy.loading : copy.more}
            </button>
          )}
        </div>
      )}
    </>
  );
}
