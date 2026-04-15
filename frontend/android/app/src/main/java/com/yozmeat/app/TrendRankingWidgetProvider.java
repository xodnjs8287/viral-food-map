package com.yozmeat.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Color;
import android.text.format.DateFormat;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Date;
import java.util.List;

public class TrendRankingWidgetProvider extends AppWidgetProvider {
    private static final int[] ROW_IDS = {
            R.id.trend_row_1,
            R.id.trend_row_2,
            R.id.trend_row_3
    };
    private static final int[] RANK_IDS = {
            R.id.trend_rank_1,
            R.id.trend_rank_2,
            R.id.trend_rank_3
    };
    private static final int[] NAME_IDS = {
            R.id.trend_name_1,
            R.id.trend_name_2,
            R.id.trend_name_3
    };
    private static final int[] META_IDS = {
            R.id.trend_meta_1,
            R.id.trend_meta_2,
            R.id.trend_meta_3
    };
    private static final int[] DELTA_IDS = {
            R.id.trend_delta_1,
            R.id.trend_delta_2,
            R.id.trend_delta_3
    };

    @Override
    public void onEnabled(Context context) {
        WidgetUpdateWorker.schedulePeriodic(context);
        WidgetUpdateWorker.enqueueImmediate(context);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetUpdateWorker.cancelAll(context);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        WidgetUpdateWorker.schedulePeriodic(context);
        WidgetUpdateWorker.enqueueImmediate(context);

        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAllWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName componentName = new ComponentName(context, TrendRankingWidgetProvider.class);
        int[] appWidgetIds = manager.getAppWidgetIds(componentName);

        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, manager, appWidgetId);
        }
    }

    private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_trend_rankings);
        WidgetRankingSnapshot snapshot = WidgetRankingStore.readSnapshot(context);

        views.setOnClickPendingIntent(
                R.id.trend_ranking_widget_root,
                WidgetIntentFactory.openUrl(context, WidgetUrls.home(), appWidgetId * 100)
        );

        if (!snapshot.hasItems()) {
            views.setViewVisibility(R.id.trend_rankings_empty, View.VISIBLE);
            views.setTextViewText(R.id.trend_ranking_updated_at, context.getString(R.string.widget_rankings_loading));
            setAllRowsHidden(views);
            appWidgetManager.updateAppWidget(appWidgetId, views);
            return;
        }

        views.setViewVisibility(R.id.trend_rankings_empty, View.GONE);
        views.setTextViewText(
                R.id.trend_ranking_updated_at,
                context.getString(
                        R.string.widget_rankings_updated,
                        DateFormat.getTimeFormat(context).format(new Date(snapshot.getFetchedAtMs()))
                )
        );

        List<WidgetRankingItem> items = snapshot.getItems();
        for (int index = 0; index < ROW_IDS.length; index++) {
            if (index >= items.size()) {
                views.setViewVisibility(ROW_IDS[index], View.GONE);
                continue;
            }

            WidgetRankingItem item = items.get(index);
            views.setViewVisibility(ROW_IDS[index], View.VISIBLE);
            views.setTextViewText(RANK_IDS[index], String.valueOf(item.getCurrentRank()));
            views.setTextViewText(NAME_IDS[index], item.getName());
            views.setTextViewText(
                    META_IDS[index],
                    context.getString(
                            R.string.widget_rankings_meta,
                            Math.min(item.getPeakScore(), 100),
                            item.getStoreCount()
                    )
            );
            views.setTextViewText(DELTA_IDS[index], item.getDeltaLabel());
            views.setTextColor(DELTA_IDS[index], resolveDeltaColor(item));
            views.setOnClickPendingIntent(
                    ROW_IDS[index],
                    WidgetIntentFactory.openUrl(
                            context,
                            WidgetUrls.trendDetail(item.getId()),
                            appWidgetId * 1000 + index
                    )
            );
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static void setAllRowsHidden(RemoteViews views) {
        for (int rowId : ROW_IDS) {
            views.setViewVisibility(rowId, View.GONE);
        }
    }

    private static int resolveDeltaColor(WidgetRankingItem item) {
        switch (item.getDeltaType()) {
            case NEW:
                return Color.parseColor("#7C3AED");
            case UP:
                return Color.parseColor("#E11D48");
            case DOWN:
                return Color.parseColor("#2563EB");
            case SAME:
            default:
                return Color.parseColor("#9CA3AF");
        }
    }
}
