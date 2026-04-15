package com.yozmeat.app;

import android.net.Uri;

final class WidgetUrls {
    private static final String BASE_URL = "https://www.yozmeat.com";

    private WidgetUrls() {
    }

    static String home() {
        return BASE_URL + "/";
    }

    static String rankingsApi() {
        return BASE_URL + "/api/widgets/rankings";
    }

    static String yomechuLaunch() {
        return BASE_URL + "/?openYomechu=1";
    }

    static String trendDetail(String trendId) {
        return BASE_URL + "/trend/" + Uri.encode(trendId);
    }
}
