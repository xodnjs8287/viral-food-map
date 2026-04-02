export default function Footer() {
  return (
    <footer className="max-w-lg mx-auto px-4 py-8 mt-8 border-t border-gray-100 text-center">
      <p className="text-sm font-bold text-primary mb-1">요즘뭐먹</p>
      <p className="text-xs text-gray-400 mb-3">SNS 바이럴 음식 트렌드 · 내 주변 판매처 탐색</p>
      <div className="flex justify-center gap-4 text-xs text-gray-300 mb-3">
        <a href="mailto:support@yozmeat.com" className="hover:text-primary transition-colors">문의하기</a>
        <span>·</span>
        <a href="/terms" className="hover:text-primary transition-colors">이용약관</a>
        <span>·</span>
        <a href="/privacy" className="hover:text-primary transition-colors">개인정보처리방침</a>
      </div>
      <p className="text-[11px] text-gray-300">© 2026 yozmeat.com · All rights reserved</p>
    </footer>
  );
}
