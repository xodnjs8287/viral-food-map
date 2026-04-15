import SwiftUI
import WidgetKit

private enum WidgetBackgroundStyle {
    case hero
    case surface
}

private enum WidgetRoutes {
    static let home = URL(string: "https://www.yozmeat.com/")!
    static let yomechu = URL(string: "https://www.yozmeat.com/?openYomechu=1")!
    static let rankings = URL(string: "https://www.yozmeat.com/api/widgets/rankings")!

    static func trend(_ id: String) -> URL {
        URL(string: "https://www.yozmeat.com/trend/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")!
    }
}

private struct WidgetTrendItem: Decodable, Identifiable {
    let id: String
    let name: String
    let peakScore: Double
    let previousRank: Int?
    let currentRank: Int
    let storeCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case peakScore = "peak_score"
        case previousRank = "previous_rank"
        case currentRank = "current_rank"
        case storeCount = "store_count"
    }

    var deltaLabel: String {
        guard let previousRank else { return "NEW" }
        let diff = previousRank - currentRank
        if diff > 0 {
            return "▲\(diff)"
        }
        if diff < 0 {
            return "▼\(abs(diff))"
        }
        return "-"
    }

    var deltaColor: Color {
        guard let previousRank else { return Color.purple }
        let diff = previousRank - currentRank
        if diff > 0 {
            return Color(red: 0.88, green: 0.11, blue: 0.28)
        }
        if diff < 0 {
            return Color(red: 0.15, green: 0.39, blue: 0.93)
        }
        return Color.gray.opacity(0.75)
    }
}

private struct WidgetRankingsResponse: Decodable {
    let items: [WidgetTrendItem]
}

private struct RankingEntry: TimelineEntry {
    let date: Date
    let items: [WidgetTrendItem]

    static let placeholder = RankingEntry(
        date: .now,
        items: [
            WidgetTrendItem(id: "1", name: "두바이 초콜릿", peakScore: 97, previousRank: 2, currentRank: 1, storeCount: 128),
            WidgetTrendItem(id: "2", name: "황치즈 디저트", peakScore: 91, previousRank: nil, currentRank: 2, storeCount: 74),
            WidgetTrendItem(id: "3", name: "소금빵", peakScore: 84, previousRank: 1, currentRank: 3, storeCount: 211),
            WidgetTrendItem(id: "4", name: "요거트 아이스크림", peakScore: 80, previousRank: 4, currentRank: 4, storeCount: 87),
            WidgetTrendItem(id: "5", name: "크룽지", peakScore: 76, previousRank: 3, currentRank: 5, storeCount: 64),
        ]
    )
}

private struct YomechuEntry: TimelineEntry {
    let date: Date
}

private struct RankingProvider: TimelineProvider {
    func placeholder(in context: Context) -> RankingEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (RankingEntry) -> Void) {
        completion(.placeholder)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RankingEntry>) -> Void) {
        let request = URLRequest(url: WidgetRoutes.rankings, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)

        URLSession.shared.dataTask(with: request) { data, _, _ in
            let decoder = JSONDecoder()
            let entry: RankingEntry

            if
                let data,
                let response = try? decoder.decode(WidgetRankingsResponse.self, from: data)
            {
                entry = RankingEntry(date: .now, items: response.items)
            } else {
                entry = .placeholder
            }

            let refreshDate = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now.addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(refreshDate)))
        }.resume()
    }
}

private struct YomechuProvider: TimelineProvider {
    func placeholder(in context: Context) -> YomechuEntry {
        YomechuEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (YomechuEntry) -> Void) {
        completion(YomechuEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<YomechuEntry>) -> Void) {
        let entry = YomechuEntry(date: .now)
        let refreshDate = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now.addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(refreshDate)))
    }
}

private struct WidgetCardModifier: ViewModifier {
    let style: WidgetBackgroundStyle

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            content
                .padding(16)
                .containerBackground(for: .widget) {
                    background
                }
        } else {
            ZStack {
                background
                content.padding(16)
            }
        }
    }

    @ViewBuilder
    private var background: some View {
        switch style {
        case .hero:
            LinearGradient(
                colors: [
                    Color(red: 0.61, green: 0.49, blue: 0.83),
                    Color(red: 0.55, green: 0.67, blue: 0.85),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case .surface:
            LinearGradient(
                colors: [
                    Color.white,
                    Color(red: 0.98, green: 0.97, blue: 1.0),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

private extension View {
    func widgetCard(_ style: WidgetBackgroundStyle) -> some View {
        modifier(WidgetCardModifier(style: style))
    }
}

private struct DeltaBadge: View {
    let item: WidgetTrendItem

    var body: some View {
        Text(item.deltaLabel)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(item.deltaColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(item.deltaColor.opacity(0.12), in: Capsule())
    }
}

private struct RankingRowView: View {
    let item: WidgetTrendItem

    var body: some View {
        HStack(spacing: 10) {
            Text("\(item.currentRank)")
                .font(.system(size: 14, weight: .black))
                .foregroundStyle(Color(red: 0.30, green: 0.11, blue: 0.58))
                .frame(width: 28, height: 28)
                .background(Color.white.opacity(0.95), in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(item.name)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Text("인기도 \(min(Int(item.peakScore.rounded()), 100))% · 판매처 \(item.storeCount)곳")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)
            DeltaBadge(item: item)
        }
        .padding(12)
        .background(Color(red: 0.97, green: 0.96, blue: 0.99), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct RankingWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family

    let entry: RankingEntry

    private var items: [WidgetTrendItem] {
        let limit: Int
        switch family {
        case .systemLarge:
            limit = 5
        case .systemMedium:
            limit = 3
        default:
            limit = 1
        }

        return Array(entry.items.prefix(limit))
    }

    var body: some View {
        Group {
            switch family {
            case .systemMedium, .systemLarge:
                VStack(alignment: .leading, spacing: 10) {
                    header

                    ForEach(items) { item in
                        Link(destination: WidgetRoutes.trend(item.id)) {
                            RankingRowView(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .widgetURL(WidgetRoutes.home)
            default:
                smallBody
            }
        }
        .widgetCard(.surface)
    }

    private var header: some View {
        HStack(alignment: .center) {
            Text("실시간 순위")
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(.primary)

            Spacer()

            Text(entry.date, style: .time)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    private var smallBody: some View {
        let item = items.first ?? RankingEntry.placeholder.items[0]

        return VStack(alignment: .leading, spacing: 10) {
            header

            Spacer(minLength: 0)

            DeltaBadge(item: item)

            Text(item.name)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(.primary)
                .lineLimit(2)

            Text("인기도 \(min(Int(item.peakScore.rounded()), 100))% · 판매처 \(item.storeCount)곳")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .widgetURL(WidgetRoutes.trend(item.id))
    }
}

private struct YomechuWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family

    let entry: YomechuEntry

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemMedium ? 12 : 10) {
            Text("오늘 뭐 먹지?")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.92))

            Text("요메추 바로실행")
                .font(.system(size: family == .systemMedium ? 24 : 20, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(2)

            Text("앱을 열자마자 근처 추천 런처를 바로 시작해 보세요.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.92))
                .lineLimit(family == .systemMedium ? 2 : 3)

            Spacer(minLength: 0)

            Text("지금 추천 열기")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.18), in: Capsule())
        }
        .widgetCard(.hero)
        .widgetURL(WidgetRoutes.yomechu)
    }
}

struct YomechuLaunchWidget: Widget {
    let kind = "YomechuLaunchWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: YomechuProvider()) { entry in
            YomechuWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("요메추 바로실행")
        .description("앱을 열자마자 요메추 런처를 바로 펼칩니다.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TrendRankingWidget: Widget {
    let kind = "TrendRankingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RankingProvider()) { entry in
            RankingWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("실시간 순위")
        .description("지금 뜨는 음식 트렌드 순위를 홈 화면에서 바로 확인합니다.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct YozmeatWidgetsBundle: WidgetBundle {
    var body: some Widget {
        YomechuLaunchWidget()
        TrendRankingWidget()
    }
}
