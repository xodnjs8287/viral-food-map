package com.yozmeat.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

final class WidgetIntentFactory {
    private WidgetIntentFactory() {
    }

    static PendingIntent openUrl(Context context, String url, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.setPackage(context.getPackageName());
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );

        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
