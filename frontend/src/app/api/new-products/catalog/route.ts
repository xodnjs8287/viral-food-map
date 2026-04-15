import { NextResponse } from "next/server";

import { getNewProductsCatalogData } from "@/lib/new-products-server";

export const revalidate = 300;

export async function GET() {
  const data = await getNewProductsCatalogData();

  return NextResponse.json(data);
}
