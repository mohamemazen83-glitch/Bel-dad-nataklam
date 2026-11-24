package com.bildad.natakallam;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Periodically (>= 15 min, Android limit) checks for announcements written by the teacher and shows a system notification. */
public final class AnnouncementJobService extends JobService {
    static final String PREFS = "announcements", KEY_LAST = "last_seen", CHANNEL = "announcements";
    private static final int JOB_ID = 4201;
    private volatile Thread worker;

    /** Called from MainActivity: remembers "now" as the starting point (so old announcements don't spam) and schedules the job. */
    static void schedule(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!p.contains(KEY_LAST)) {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            p.edit().putString(KEY_LAST, f.format(new Date())).apply();
        }
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, AnnouncementJobService.class))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    @Override public boolean onStartJob(final JobParameters params) {
        worker = new Thread(() -> {
            boolean retry = false;
            try { check(); } catch (Exception e) { retry = true; }
            jobFinished(params, retry);
        });
        worker.start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }

    private void check() throws Exception {
        String cfg = read(getAssets().open("config.js"));
        String base = find(cfg, "supabaseUrl\\s*:\\s*\"([^\"]+)\""), key = find(cfg, "supabaseAnonKey\\s*:\\s*\"([^\"]+)\"");
        if (base == null || key == null) return;
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String last = p.getString(KEY_LAST, null);
        if (last == null) return;
        URL u = new URL(base.replaceAll("/$", "") + "/rest/v1/announcements?select=id,title,body,created_at&order=created_at.asc&limit=5&created_at=gt." + URLEncoder.encode(last, "UTF-8"));
        HttpURLConnection h = (HttpURLConnection) u.openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(15000);
        h.setRequestProperty("apikey", key);
        h.setRequestProperty("Authorization", "Bearer " + key);
        if (h.getResponseCode() != 200) throw new Exception("http " + h.getResponseCode());
        JSONArray rows = new JSONArray(read(h.getInputStream()));
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.getJSONObject(i);
            notify(r.optString("title"), r.optString("body"), r.optString("id").hashCode());
            last = r.optString("created_at", last);
        }
        if (rows.length() > 0) p.edit().putString(KEY_LAST, last).apply();
    }

    private void notify(String title, String text, int id) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "إشعارات المحاضرات", NotificationManager.IMPORTANCE_DEFAULT));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        b.setSmallIcon(R.drawable.ic_stat_notify).setContentTitle(title).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true);
        try { nm.notify(id, b.build()); } catch (SecurityException ignored) { }
    }

    private static String find(String s, String re) { Matcher m = Pattern.compile(re).matcher(s); return m.find() ? m.group(1) : null; }

    private static String read(InputStream in) throws Exception {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"))) {
            StringBuilder sb = new StringBuilder(); String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        }
    }
}
