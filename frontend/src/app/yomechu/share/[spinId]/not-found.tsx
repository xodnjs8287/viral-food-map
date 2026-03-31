import BottomNav from "@/components/BottomNav";
import Header from "@/components/Header";

export default function YomechuShareNotFound() {
  return (
    <>
      <Header showBack />
      <main className="page-with-bottom-nav mx-auto flex max-w-lg flex-col gap-8 px-4 py-12">
        <section className="rounded-[32px] border border-gray-200 bg-white px-6 py-8 text-center shadow-sm">
          <p className="text-lg font-bold text-gray-900">
            공유된 추천 결과를 찾을 수 없어요
          </p>
          <p className="mt-2 break-keep text-sm leading-6 text-gray-600">
            링크가 잘못되었거나 만료된 추천 결과입니다.
          </p>
        </section>
      </main>
      <BottomNav />
    </>
  );
}
