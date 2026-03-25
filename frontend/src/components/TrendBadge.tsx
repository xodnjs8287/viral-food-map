interface TrendBadgeProps {
  status: string;
}

const badges: Record<string, { label: string; color: string }> = {
  rising: { label: "🔥 급상승", color: "bg-red-100 text-red-600" },
  active: { label: "⬆️ 인기", color: "bg-purple-100 text-purple-600" },
  declining: { label: "⬇️ 하락", color: "bg-gray-100 text-gray-500" },
  inactive: { label: "⏸️ 종료", color: "bg-gray-100 text-gray-400" },
};

export default function TrendBadge({ status }: TrendBadgeProps) {
  const badge = badges[status] || badges.inactive;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${badge.color}`}
    >
      {badge.label}
    </span>
  );
}
