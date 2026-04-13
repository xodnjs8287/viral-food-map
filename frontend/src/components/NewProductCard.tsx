"use client";

import Image from "next/image";

import type { NewProductListItem } from "@/lib/new-products-server";

interface NewProductCardProps {
  product: NewProductListItem;
}

function formatDateLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}

function buildSummary(product: NewProductListItem) {
  if (product.summary) {
    return product.summary;
  }

  if (product.category) {
    return `${product.brand_label} 공식 채널에서 수집한 ${product.category} 신상 정보입니다.`;
  }

  return `${product.brand_label} 공식 채널에서 수집한 신상 정보입니다.`;
}

export default function NewProductCard({ product }: NewProductCardProps) {
  const officialUrl = product.product_url || product.source?.site_url || null;

  const imageFallback = (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-[#8BACD8] text-4xl text-white">
      🍴
    </div>
  );

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
      <div className="relative h-44 w-full bg-gray-100">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 512px) 100vw, 512px"
            className="object-cover"
          />
        ) : (
          imageFallback
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700">
            {product.sector_label}
          </span>
          {product.is_limited ? (
            <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950">
              한정
            </span>
          ) : null}
        </div>

        <div className="absolute right-3 top-3">
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
            {product.brand_label}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h2 className="text-lg font-bold tracking-[-0.03em] text-white">
            {product.name}
          </h2>
          <p className="mt-1 text-xs text-white/80">
            {product.source?.title || product.brand_label}
          </p>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="mb-3 line-clamp-2 text-sm text-gray-500">
          {buildSummary(product)}
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
            {product.date_label} {formatDateLabel(product.effective_at)}
          </span>
          {product.category ? (
            <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-600">
              {product.category}
            </span>
          ) : null}
          <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-600">
            {product.channel}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
          <div className="min-w-0 flex-1">
            <p className="truncate">
              공식 출처: {product.source?.title || product.brand_label}
            </p>
          </div>

          {officialUrl ? (
            <a
              href={officialUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-purple-600"
            >
              공식 링크
            </a>
          ) : (
            <span className="shrink-0 text-xs text-gray-400">링크 준비 중</span>
          )}
        </div>
      </div>
    </article>
  );
}
