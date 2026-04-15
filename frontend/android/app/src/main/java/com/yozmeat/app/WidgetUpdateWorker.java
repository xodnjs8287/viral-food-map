package com.yozmeat.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public class WidgetUpdateWorker extends Worker {
    private static final String UNIQUE_PERIODIC_WORK = "yozmeat_widget_rankings_periodic";
    private static final String UNIQUE_IMMEDIATE_WORK = "yozmeat_widget_rankings_immediate";
    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 8000;

    public WidgetUpdateWorker(
            @NonNull Context context,
            @NonNull WorkerParameters workerParams
    ) {
        super(context, workerParams);
    }

    static void schedulePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                WidgetUpdateWorker.class,
                30,
                TimeUnit.MINUTES
        ).build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.KEEP,
                request
        );
    }

    static void enqueueImmediate(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(WidgetUpdateWorker.class).build();

        WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_IMMEDIATE_WORK,
                ExistingWorkPolicy.REPLACE,
                request
        );
    }

    static void cancelAll(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC_WORK);
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_IMMEDIATE_WORK);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        try {
            String payload = fetchRankingsJson();
            WidgetRankingStore.savePayload(context, payload);
            TrendRankingWidgetProvider.updateAllWidgets(context);
            return Result.success();
        } catch (IOException exception) {
            TrendRankingWidgetProvider.updateAllWidgets(context);
            return WidgetRankingStore.hasPayload(context) ? Result.success() : Result.retry();
        }
    }

    private String fetchRankingsJson() throws IOException {
        HttpURLConnection connection = null;

        try {
            connection = (HttpURLConnection) new URL(WidgetUrls.rankingsApi()).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 200 && statusCode < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String responseBody = stream != null ? readStream(stream) : "";

            if (statusCode < 200 || statusCode >= 300) {
                throw new IOException("Unexpected widget rankings response: " + statusCode);
            }

            return responseBody;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readStream(InputStream stream) throws IOException {
        StringBuilder builder = new StringBuilder();

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }

        return builder.toString();
    }
}
