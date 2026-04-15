package com.yozmeat.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class WidgetRankingStore {
    private static final String PREFS_NAME = "yozmeat_widgets";
    private static final String KEY_RANKINGS_PAYLOAD = "rankings_payload";
    private static final String KEY_FETCHED_AT_MS = "rankings_fetched_at_ms";

    private WidgetRankingStore() {
    }

    static void savePayload(Context context, String payload) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit()
                .putString(KEY_RANKINGS_PAYLOAD, payload)
                .putLong(KEY_FETCHED_AT_MS, System.currentTimeMillis())
                .apply();
    }

    static boolean hasPayload(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return preferences.contains(KEY_RANKINGS_PAYLOAD);
    }

    static WidgetRankingSnapshot readSnapshot(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String payload = preferences.getString(KEY_RANKINGS_PAYLOAD, null);
        long fetchedAtMs = preferences.getLong(KEY_FETCHED_AT_MS, 0L);

        if (payload == null || payload.isEmpty()) {
            return WidgetRankingSnapshot.empty();
        }

        try {
            JSONObject root = new JSONObject(payload);
            JSONArray itemsArray = root.optJSONArray("items");
            List<WidgetRankingItem> items = new ArrayList<>();

            if (itemsArray != null) {
                for (int index = 0; index < itemsArray.length(); index++) {
                    JSONObject item = itemsArray.optJSONObject(index);
                    if (item == null) {
                        continue;
                    }

                    Integer previousRank = item.isNull("previous_rank")
                            ? null
                            : Integer.valueOf(item.optInt("previous_rank"));

                    items.add(
                            new WidgetRankingItem(
                                    item.optString("id"),
                                    item.optString("name"),
                                    (int) Math.round(item.optDouble("peak_score", 0)),
                                    previousRank,
                                    item.optInt("current_rank"),
                                    item.optInt("store_count")
                            )
                    );
                }
            }

            return new WidgetRankingSnapshot(items, fetchedAtMs);
        } catch (JSONException exception) {
            return WidgetRankingSnapshot.empty();
        }
    }
}
