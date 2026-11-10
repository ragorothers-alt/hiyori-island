package app.hiyori.daily;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

// 通知都在這裡：
//   專注、休息中的即時倒數：一則常駐通知，請系統升級成即時通知（Android 16 的 Live Updates；三星手機上是 Now Bar）。
//     倒數是系統自己跑的（告訴它幾點結束就好），App 被收掉也照樣在走，不用背景服務
//   到點：用鬧鐘準時發一則「時間到了」（TimerAlarm），手機鎖著、沒網路都一樣
//   一般的提醒：網頁開著時發的（日程、就寢、重要日子…）
final class TimerNotice {
    private static final String CH_LIVE = "live";
    private static final String CH_DONE = "done";
    private static final String CH_REMIND = "remind";
    private static final int ID_LIVE = 1;
    private static final int ID_DONE = 2;
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";

    private TimerNotice() {
    }

    private static NotificationManager manager(Context c) {
        NotificationManager m = c.getSystemService(NotificationManager.class);
        // 倒數那一則不出聲（開始、暫停時不用響）；到點和提醒要響
        NotificationChannel live = new NotificationChannel(CH_LIVE, c.getString(R.string.ch_live), NotificationManager.IMPORTANCE_DEFAULT);
        live.setSound(null, null);
        live.enableVibration(false);
        live.setShowBadge(false);
        m.createNotificationChannel(live);
        m.createNotificationChannel(new NotificationChannel(CH_DONE, c.getString(R.string.ch_done), NotificationManager.IMPORTANCE_HIGH));
        m.createNotificationChannel(new NotificationChannel(CH_REMIND, c.getString(R.string.ch_remind), NotificationManager.IMPORTANCE_HIGH));
        return m;
    }

    private static PendingIntent open(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent alarm(Context c, String title, String body) {
        Intent i = new Intent(c, TimerAlarm.class).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // json：{ title, text, at?, since?, chip?, done?: { title, body } }
    //   at：倒數到幾點（毫秒）；since：正向計時從幾點開始數；兩個都沒有是暫停中（chip 是狀態列小方塊上的字）
    //   done：到點（at，正向計時是 doneAt）時要發的那一則
    static void apply(Context c, String json) {
        NotificationManager m = manager(c);
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        alarms.cancel(alarm(c, "", ""));
        JSONObject o = null;
        try {
            if (json != null && !json.isEmpty()) o = new JSONObject(json);
        } catch (Exception ignored) {
        }
        if (o == null || o.optString("title").isEmpty()) {
            m.cancel(ID_LIVE);
            return;
        }
        long at = o.optLong("at", 0);
        long since = o.optLong("since", 0);
        Notification.Builder b = new Notification.Builder(c, CH_LIVE)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle(o.optString("title"))
                .setContentText(o.optString("text"))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_STOPWATCH)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(open(c))
                // 請系統把這一則升級成即時通知。要不要升級由系統和使用者的設定決定，沒升級就是一般的常駐通知
                .setRequestPromotedOngoing(true);
        if (at > 0) b.setWhen(at).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
        else if (since > 0) b.setWhen(since).setShowWhen(true).setUsesChronometer(true);
        else b.setShowWhen(false);
        String chip = o.optString("chip");
        if (!chip.isEmpty()) b.setShortCriticalText(chip);
        m.notify(ID_LIVE, b.build());

        JSONObject done = o.optJSONObject("done");
        long doneAt = at > 0 ? at : o.optLong("doneAt", 0);
        if (done != null && doneAt > System.currentTimeMillis()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, doneAt, alarm(c, done.optString("title"), done.optString("body")));
        }
    }

    // 到點了：倒數那一則收掉，換成會響的「時間到了」
    static void done(Context c, String title, String body) {
        NotificationManager m = manager(c);
        m.cancel(ID_LIVE);
        if (title == null || title.isEmpty()) return;
        m.notify(ID_DONE, new Notification.Builder(c, CH_DONE)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(open(c))
                .build());
    }

    static void clearDone(Context c) {
        c.getSystemService(NotificationManager.class).cancel(ID_DONE);
    }

    static void remind(Context c, String title, String body, String tag) {
        if (title == null || title.isEmpty()) return;
        manager(c).notify(tag == null || tag.isEmpty() ? "remind" : tag, 10, new Notification.Builder(c, CH_REMIND)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(open(c))
                .build());
    }
}
