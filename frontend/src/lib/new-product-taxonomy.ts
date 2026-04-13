export type NewProductSectorKey =
  | "cafe"
  | "burger"
  | "pizza"
  | "sandwich"
  | "other";

export type NewProductSectorFilter = "all" | NewProductSectorKey;

export const NEW_PRODUCT_SECTOR_OPTIONS: Array<{
  key: NewProductSectorFilter;
  label: string;
}> = [
  { key: "all", label: "전체" },
  { key: "cafe", label: "카페·음료" },
  { key: "burger", label: "버거·치킨" },
  { key: "pizza", label: "피자" },
  { key: "sandwich", label: "샌드위치" },
  { key: "other", label: "기타" },
];

const BRAND_DISPLAY_ALIASES: Record<string, string> = {
  "LOTTE EATZ": "롯데잇츠",
};

type NewProductTaxonomyMetadata = Record<string, unknown> | null | undefined;

const BRAND_TO_SECTOR: Record<string, NewProductSectorKey> = {
  lotteeatz: "other",
  빽다방: "cafe",
  kfc: "burger",
  맘스터치: "burger",
  도미노피자: "pizza",
  맥도날드: "burger",
  버거킹: "burger",
  서브웨이: "sandwich",
  컴포즈커피: "cafe",
  공차: "cafe",
  스타벅스: "cafe",
  메가mgc커피: "cafe",
};

function toBrandKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

function inferSectorFromBrand(brand: string): NewProductSectorKey {
  if (/(커피|카페|공차|스타벅스|coffee|cafe|tea)/i.test(brand)) {
    return "cafe";
  }

  if (
    /(버거|치킨|burger|kfc|momstouch|mom'stouch|맘스터치|맥도날드|버거킹)/i.test(
      toBrandKey(brand)
    )
  ) {
    return "burger";
  }

  if (/(피자|pizza)/i.test(brand)) {
    return "pizza";
  }

  if (/(샌드|subway)/i.test(brand)) {
    return "sandwich";
  }

  return "other";
}

export function isNewProductSectorKey(
  value: string | null | undefined
): value is NewProductSectorKey {
  return (
    value === "cafe" ||
    value === "burger" ||
    value === "pizza" ||
    value === "sandwich" ||
    value === "other"
  );
}

function getMetadataString(
  metadata: NewProductTaxonomyMetadata,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getNewProductBrandLabel(
  brand: string | null | undefined,
  metadata?: NewProductTaxonomyMetadata
) {
  const displayBrand = getMetadataString(metadata, "display_brand");

  if (displayBrand) {
    return displayBrand;
  }

  const trimmed = brand?.trim();

  if (!trimmed) {
    return "브랜드 미정";
  }

  return BRAND_DISPLAY_ALIASES[trimmed] ?? trimmed;
}

export function getNewProductSectorKey(
  brand: string | null | undefined,
  metadata?: NewProductTaxonomyMetadata
): NewProductSectorKey {
  const metadataSector = getMetadataString(metadata, "sector_key");

  if (isNewProductSectorKey(metadataSector)) {
    return metadataSector;
  }

  const trimmed = brand?.trim();

  if (!trimmed) {
    return "other";
  }

  return BRAND_TO_SECTOR[toBrandKey(trimmed)] ?? inferSectorFromBrand(trimmed);
}

export function getNewProductSectorLabel(sector: NewProductSectorFilter) {
  return (
    NEW_PRODUCT_SECTOR_OPTIONS.find((option) => option.key === sector)?.label ??
    "전체"
  );
}
