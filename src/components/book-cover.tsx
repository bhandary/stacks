"use client";

import { useState } from "react";
import { coverPalette } from "@/lib/cover";

export function BookCover({
  title,
  coverUrl,
  className = "",
}: {
  title: string;
  coverUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const palette = coverPalette(title || "book");
  const showImage = Boolean(coverUrl) && !failed;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="flex h-full w-full items-end p-1.5 text-left"
        style={{ background: palette.bg, color: palette.ink }}
        aria-hidden
      >
        <span className="line-clamp-4 text-[10px] leading-tight font-medium">
          {title}
        </span>
      </div>
      {showImage ? (
        // External catalog covers vary by host; a plain img keeps this simple.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}
