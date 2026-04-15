package com.yozmeat.app;

import java.util.ArrayList;
import java.util.List;

final class WidgetRankingSnapshot {
    private final List<WidgetRankingItem> items;
    private final long fetchedAtMs;

    WidgetRankingSnapshot(List<WidgetRankingItem> items, long fetchedAtMs) {
        this.items = items;
        this.fetchedAtMs = fetchedAtMs;
    }

    static WidgetRankingSnapshot empty() {
        return new WidgetRankingSnapshot(new ArrayList<>(), 0L);
    }

    List<WidgetRankingItem> getItems() {
        return items;
    }

    long getFetchedAtMs() {
        return fetchedAtMs;
    }

    boolean hasItems() {
        return !items.isEmpty();
    }
}
