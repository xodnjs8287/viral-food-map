package com.yozmeat.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

public class YomechuLaunchWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_yomechu_launch);
        views.setOnClickPendingIntent(
                R.id.yomechu_widget_root,
                WidgetIntentFactory.openUrl(context, WidgetUrls.yomechuLaunch(), appWidgetId)
        );
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
