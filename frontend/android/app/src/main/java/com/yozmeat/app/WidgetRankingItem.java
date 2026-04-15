package com.yozmeat.app;

final class WidgetRankingItem {
    enum DeltaType {
        NEW,
        UP,
        DOWN,
        SAME
    }

    private final String id;
    private final String name;
    private final int peakScore;
    private final Integer previousRank;
    private final int currentRank;
    private final int storeCount;

    WidgetRankingItem(
            String id,
            String name,
            int peakScore,
            Integer previousRank,
            int currentRank,
            int storeCount
    ) {
        this.id = id;
        this.name = name;
        this.peakScore = peakScore;
        this.previousRank = previousRank;
        this.currentRank = currentRank;
        this.storeCount = storeCount;
    }

    String getId() {
        return id;
    }

    String getName() {
        return name;
    }

    int getCurrentRank() {
        return currentRank;
    }

    int getPeakScore() {
        return peakScore;
    }

    int getStoreCount() {
        return storeCount;
    }

    DeltaType getDeltaType() {
        if (previousRank == null) {
            return DeltaType.NEW;
        }

        int diff = previousRank - currentRank;
        if (diff > 0) {
            return DeltaType.UP;
        }
        if (diff < 0) {
            return DeltaType.DOWN;
        }
        return DeltaType.SAME;
    }

    String getDeltaLabel() {
        if (previousRank == null) {
            return "NEW";
        }

        int diff = previousRank - currentRank;
        if (diff > 0) {
            return "▲" + diff;
        }
        if (diff < 0) {
            return "▼" + Math.abs(diff);
        }
        return "-";
    }
}
