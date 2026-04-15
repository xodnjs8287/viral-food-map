import { NextResponse } from "next/server";

import { getWidgetRankings } from "@/lib/widget-rankings";

export const revalidate = 300;

export async function GET() {
  const payload = await getWidgetRankings();

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
