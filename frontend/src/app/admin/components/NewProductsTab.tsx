"use client";

import { useEffect, useState } from "react";
import {
  autoRegisterNewProductSource,
  fetchNewProductsRefreshStatus,
  triggerNewProductsRefresh,
  type AutoRegisterNewProductSourceResponse,
  type NewProductsRefreshStatus,
} from "@/lib/crawler";
import { supabase } from "@/lib/supabase";
import type {
  NewProduct,
  NewProductCrawlRun,
  NewProductSource,
  NewProductSourceType,
  NewProductStatus,
} from "@/lib/types";

type ProductRow = NewProduct & {
  source: Pick<
    NewProductSource,
    "id" | "source_key" | "title" | "brand" | "source_type" | "channel" | "site_url"
  > | null;
};

type SourceFilter = "all" | NewProductSourceType;
type StatusFilter = "all" | NewProductStatus;
type RequestStatus = "idle" | "loading" | "success" | "error";

const SOURCE_LABELS: Record<NewProductSourceType, string> = {
  convenience: "편의점",
  franchise: "프랜차이즈",
};

const STATUS_LABELS: Record<NewProductStatus, string> = {
  visible: "노출",
  hidden: "숨김",
  expired: "만료",
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "없음";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ko-KR");
}

function getEffectiveAt(product: Pick<NewProduct, "published_at" | "first_seen_at">) {
  return product.published_at || product.first_seen_at;
}

function buildAutoRegisterMessage(
  result: AutoRegisterNewProductSourceResponse,
  fallbackBrand: string
) {
  const brand = result.source?.brand || fallbackBrand;

  if (result.summary) {
    return `${brand} 소스를 등록했습니다. 미리보기 ${result.preview.fetched_products}건, 반영 ${result.summary.visible_products}건입니다.`;
  }

  return `${result.message} 미리보기 ${result.preview.fetched_products}건입니다.`;
}

export default function NewProductsTab() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [sources, setSources] = useState<NewProductSource[]>([]);
  const [runs, setRuns] = useState<NewProductCrawlRun[]>([]);
  const [refreshStatus, setRefreshStatus] = useState<NewProductsRefreshStatus | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [brandInput, setBrandInput] = useState("");
  const [autoSourceType, setAutoSourceType] = useState<NewProductSourceType>("franchise");
  const [autoRegisterResult, setAutoRegisterResult] =
    useState<AutoRegisterNewProductSourceResponse | null>(null);

  const loadData = async () => {
    const [productsResult, sourcesResult, runsResult, refreshResult] =
      await Promise.all([
        supabase
          .from("new_products")
          .select(
            "*, source:new_product_sources(id, source_key, title, brand, source_type, channel, site_url)"
          )
          .order("last_seen_at", { ascending: false })
          .limit(120),
        supabase
          .from("new_product_sources")
          .select("*")
          .order("brand", { ascending: true }),
        supabase
          .from("new_product_crawl_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(12),
        fetchNewProductsRefreshStatus().catch(() => null),
      ]);

    setProducts((productsResult.data as ProductRow[]) ?? []);
    setSources((sourcesResult.data as NewProductSource[]) ?? []);
    setRuns((runsResult.data as NewProductCrawlRun[]) ?? []);
    setRefreshStatus(refreshResult);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const getAdminAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    if (!accessToken) {
      throw new Error("관리자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
    }

    return accessToken;
  };

  const handleRefresh = async () => {
    try {
      setRequestStatus("loading");
      setRequestMessage("신상 소스를 수집하는 중입니다...");

      const accessToken = await getAdminAccessToken();
      const result = await triggerNewProductsRefresh(accessToken);

      setRequestStatus("success");
      setRequestMessage(
        `신상 ${result.summary.visible_products}건을 반영했습니다. 신규 ${result.summary.inserted_products}건, 갱신 ${result.summary.updated_products}건입니다.`
      );
      await loadData();
    } catch (error) {
      setRequestStatus("error");
      setRequestMessage(
        error instanceof Error ? error.message : "신상 수집 실행에 실패했습니다."
      );
    }
  };

  const handleAutoRegister = async () => {
    const normalizedBrand = brandInput.trim();
    if (!normalizedBrand) {
      setRequestStatus("error");
      setRequestMessage("등록할 브랜드명을 입력해 주세요.");
      return;
    }

    try {
      setRequestStatus("loading");
      setRequestMessage("공식 신상 채널을 찾고 자동 등록하는 중입니다...");

      const accessToken = await getAdminAccessToken();
      const result = await autoRegisterNewProductSource(accessToken, {
        brand: normalizedBrand,
        sourceType: autoSourceType,
      });

      setAutoRegisterResult(result);
      setRequestStatus("success");
      setRequestMessage(buildAutoRegisterMessage(result, normalizedBrand));
      setBrandInput("");
      await loadData();
    } catch (error) {
      setRequestStatus("error");
      setRequestMessage(
        error instanceof Error ? error.message : "브랜드 자동 등록에 실패했습니다."
      );
    }
  };

  const handleStatusUpdate = async (
    productId: string,
    nextStatus: NewProductStatus
  ) => {
    await supabase.from("new_products").update({ status: nextStatus }).eq("id", productId);
    await loadData();
  };

  const filteredProducts = products.filter((product) => {
    if (sourceFilter !== "all" && product.source_type !== sourceFilter) {
      return false;
    }

    if (statusFilter !== "all" && product.status !== statusFilter) {
      return false;
    }

    return true;
  });

  const statusCounts = products.reduce(
    (counts, product) => {
      counts[product.status] += 1;
      return counts;
    },
    { visible: 0, hidden: 0, expired: 0 } satisfies Record<NewProductStatus, number>
  );

  if (loading) {
    return <p className="py-12 text-center text-gray-400">로딩 중...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">신상 운영</h2>
          <p className="mt-1 text-sm text-gray-400">
            편의점과 프랜차이즈의 공식 신상품 소스를 수집하고 노출 상태를 관리합니다.
          </p>
        </div>
        <button
          onClick={() => {
            void handleRefresh();
          }}
          disabled={requestStatus === "loading"}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-600 disabled:opacity-60"
        >
          {requestStatus === "loading" ? "수집 중..." : "수집 실행"}
        </button>
      </div>

      {requestMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            requestStatus === "error"
              ? "border-red-200 bg-red-50 text-red-600"
              : requestStatus === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-gray-200 bg-white text-gray-500"
          }`}
        >
          {requestMessage}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">브랜드 자동 등록</h3>
          <p className="mt-1 text-xs text-gray-400">
            브랜드명만 입력하면 공식 신상 채널을 찾아 parser를 연결하고 바로 수집합니다.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            value={brandInput}
            onChange={(event) => setBrandInput(event.target.value)}
            placeholder="예: 맘스터치, 도미노피자"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
          />
          <select
            value={autoSourceType}
            onChange={(event) =>
              setAutoSourceType(event.target.value as NewProductSourceType)
            }
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary"
          >
            <option value="franchise">프랜차이즈</option>
            <option value="convenience">편의점</option>
          </select>
          <button
            onClick={() => {
              void handleAutoRegister();
            }}
            disabled={requestStatus === "loading"}
            className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
          >
            {requestStatus === "loading" ? "자동 등록 중..." : "자동 등록"}
          </button>
        </div>

        {autoRegisterResult ? (
          <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                {SOURCE_LABELS[autoRegisterResult.source?.source_type || autoSourceType]}
              </span>
              <span className="rounded-full bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white">
                {autoRegisterResult.source?.parser_type || "parser 없음"}
              </span>
              <span className="rounded-full bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700">
                신뢰도 {(autoRegisterResult.discovery.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-900">
              {autoRegisterResult.source?.title || "자동 등록 소스"}
            </p>
            <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
              <p>공식 URL: {autoRegisterResult.discovery.official_site_url}</p>
              <p>매칭 URL: {autoRegisterResult.discovery.matched_url}</p>
              <p>미리보기 수집: {autoRegisterResult.preview.fetched_products}건</p>
            </div>
            {autoRegisterResult.crawl_error ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                즉시 수집은 실패했습니다. 소스 등록은 완료되어 다음 자동 수집에서 다시 시도합니다.
              </div>
            ) : null}
            {autoRegisterResult.discovery.notes.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {autoRegisterResult.discovery.notes.map((note) => (
                  <span
                    key={note}
                    className="rounded-full bg-white px-2 py-1 text-[11px] text-gray-500"
                  >
                    {note}
                  </span>
                ))}
              </div>
            ) : null}
            {autoRegisterResult.preview.preview_items.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                {autoRegisterResult.preview.preview_items.map((item) => (
                  <div
                    key={item.external_id}
                    className="rounded-lg border border-gray-100 bg-white px-3 py-2"
                  >
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      기준일 {formatDateTime(item.published_at)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">등록 상품</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{products.length}</p>
          <p className="mt-1 text-xs text-gray-400">현재 저장된 신상 기준</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">활성 소스</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {sources.filter((source) => source.is_active).length}
          </p>
          <p className="mt-1 text-xs text-gray-400">전체 {sources.length}개 소스</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">최근 수집</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            {formatDateTime(refreshStatus?.last_finished_at ?? null)}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {refreshStatus?.last_summary
              ? `노출 ${refreshStatus.last_summary.visible_products}건`
              : "아직 실행 기록 없음"}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-xs text-gray-400">노출 상태</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">
            노출 {statusCounts.visible} / 숨김 {statusCounts.hidden}
          </p>
          <p className="mt-1 text-xs text-gray-400">만료 {statusCounts.expired}건</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSourceFilter("all")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    sourceFilter === "all"
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  전체
                </button>
                {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSourceFilter(key as SourceFilter)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      sourceFilter === key
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    statusFilter === "all"
                      ? "bg-primary text-white"
                      : "bg-primary/10 text-primary hover:bg-primary/20"
                  }`}
                >
                  전체
                </button>
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key as StatusFilter)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      statusFilter === key
                        ? "bg-primary text-white"
                        : "bg-primary/10 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                필터 결과 {filteredProducts.length}건 / 전체 {products.length}건
              </p>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
              <p className="text-sm text-gray-400">조건에 맞는 신상이 없습니다.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="rounded-xl border border-gray-100 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {SOURCE_LABELS[product.source_type]}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {STATUS_LABELS[product.status]}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          {product.brand}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900">{product.name}</h3>
                      {product.summary ? (
                        <p className="mt-1 text-sm text-gray-500">{product.summary}</p>
                      ) : null}
                      <div className="mt-2 flex flex-col gap-1 text-xs text-gray-400">
                        <p>공식 링크: {product.product_url || product.source?.site_url || "없음"}</p>
                        <p>기준일: {formatDateTime(getEffectiveAt(product))}</p>
                        <p>마지막 확인: {formatDateTime(product.last_seen_at)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {product.status === "visible" ? (
                        <button
                          onClick={() => {
                            void handleStatusUpdate(product.id, "hidden");
                          }}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
                        >
                          숨김
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            void handleStatusUpdate(product.id, "visible");
                          }}
                          className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100"
                        >
                          복구
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-900">소스 현황</h3>
              <p className="mt-1 text-xs text-gray-400">
                어떤 공식 채널을 기준으로 신상을 수집하는지 확인합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {sources.map((source) => (
                <div key={source.id} className="rounded-xl border border-gray-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{source.title}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {SOURCE_LABELS[source.source_type]} · {source.channel}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white">
                        {source.source_origin === "admin" ? "어드민 등록" : "코드 등록"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          source.is_active
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {source.is_active ? "활성" : "비활성"}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    마지막 성공 {formatDateTime(source.last_success_at)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-900">최근 실행</h3>
              <p className="mt-1 text-xs text-gray-400">
                최근 신상 수집 배치 결과입니다.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {runs.length === 0 ? (
                <p className="text-sm text-gray-400">아직 실행 기록이 없습니다.</p>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-gray-900">
                        {run.source_key || "전체 소스"}
                      </p>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          run.status === "success"
                            ? "bg-green-50 text-green-700"
                            : run.status === "failed"
                            ? "bg-red-50 text-red-600"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      시작 {formatDateTime(run.started_at)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      수집 {run.fetched_count}건 · 신규 {run.inserted_count}건 · 갱신 {run.updated_count}건
                    </p>
                    {run.error_message ? (
                      <p className="mt-1 text-xs text-red-500">{run.error_message}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
