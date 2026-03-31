import type { Metadata } from "next";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "개인정보처리방침",
  description:
    "요즘뭐먹 서비스의 개인정보 수집 항목, 이용 목적, 보관 기간과 이용자 권리를 안내합니다.",
  path: "/privacy",
  keywords: ["개인정보처리방침", "요즘뭐먹 개인정보"],
});

export default function PrivacyPage() {
  return (
    <>
      <Header showBack />
      <main className="page-with-bottom-nav max-w-lg mx-auto px-4 py-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">개인정보처리방침</h2>
        <p className="text-xs text-gray-400 mb-6">최종 수정일: 2026년 3월 25일</p>

        <div className="space-y-6 text-sm text-gray-600 leading-relaxed">
          <section>
            <h3 className="font-bold text-gray-800 mb-2">1. 수집하는 개인정보</h3>
            <p>요즘뭐먹은 서비스 제공을 위해 다음과 같은 정보를 수집할 수 있습니다.</p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-gray-500">
              <li>위치 정보 (내 주변 판매처 검색 시, 기기에서만 처리)</li>
              <li>제보 정보 (판매처명, 주소 등 이용자가 직접 입력한 정보)</li>
              <li>서비스 이용 기록 (페이지 방문, 클릭 등 익명 통계)</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-gray-800 mb-2">2. 개인정보 수집 및 이용 목적</h3>
            <ul className="space-y-1 list-disc list-inside text-gray-500">
              <li>내 위치 기반 판매처 정보 제공</li>
              <li>판매처 제보 처리 및 서비스 품질 개선</li>
              <li>서비스 이용 통계 분석</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-gray-800 mb-2">3. 위치 정보 처리</h3>
            <p>위치 정보는 브라우저 권한 허용 시에만 수집되며, 서버에 저장되지 않습니다. 기기 내에서만 처리되어 주변 판매처 거리 계산에 활용됩니다.</p>
          </section>

          <section>
            <h3 className="font-bold text-gray-800 mb-2">4. 개인정보 보유 및 파기</h3>
            <p>제보를 통해 수집된 정보는 서비스 운영 목적 달성 후 지체 없이 파기합니다. 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.</p>
          </section>

          <section>
            <h3 className="font-bold text-gray-800 mb-2">5. 제3자 제공</h3>
            <p>수집된 정보는 법령에 의한 경우를 제외하고 제3자에게 제공되지 않습니다. 서비스는 카카오맵 API, Supabase 등 외부 서비스를 활용하며, 각 서비스의 개인정보처리방침을 따릅니다.</p>
          </section>

          <section>
            <h3 className="font-bold text-gray-800 mb-2">6. 이용자 권리</h3>
            <p>이용자는 언제든지 제보한 정보의 수정 또는 삭제를 요청할 수 있습니다. 요청은 <a href="mailto:support@yozmeat.com" className="text-primary">support@yozmeat.com</a>으로 문의해 주세요.</p>
          </section>

          <section>
            <h3 className="font-bold text-gray-800 mb-2">7. 개인정보 보호책임자</h3>
            <p>개인정보 관련 문의 및 불만 처리는 아래 연락처로 문의해 주세요.</p>
            <p className="mt-1 text-gray-500">이메일: <a href="mailto:support@yozmeat.com" className="text-primary">support@yozmeat.com</a></p>
          </section>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
