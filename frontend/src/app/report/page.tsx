"use client";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import ReportForm from "@/components/ReportForm";

export default function ReportPage() {
  return (
    <>
      <Header />
      <main className="max-w-lg mx-auto px-4 py-4">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900">판매처 제보하기</h2>
          <p className="text-sm text-gray-500 mt-1">
            유행 음식을 파는 곳을 알고 계신가요? 알려주세요!
          </p>
        </div>
        <ReportForm />
        <div className="mt-6 bg-purple-50 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-3 text-sm">제보 전 참고하세요 💡</h3>
          <ul className="space-y-2 text-sm text-gray-500">
            <li>✅ 정확한 매장명과 주소를 입력해주세요</li>
            <li>✅ 관리자 검토 후 지도에 표시됩니다 (보통 24시간 이내)</li>
            <li>✅ 이미 등록된 매장 중복 제보는 불필요해요</li>
            <li>✅ 카카오맵에서 검색되는 매장명으로 입력하면 정확해요</li>
          </ul>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
