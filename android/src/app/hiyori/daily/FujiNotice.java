package app.hiyori.daily;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

// ふじ在 App 關著時的通知（早上今天的安排、截止日有風險、睡前明天先做哪件；網頁的 fujiNotes.js 排好、寫好字）。
// 交給手機的鬧鐘一則一則發；到點時 App 在前面就不發（畫面上ふじ自己會說），只記成處理過。
// 跟警語分開：自己的通知類別（可以在系統設定只關這一類）、沒有按鈕、不算進回神紀錄。
// 排好的存在 SharedPreferences：開機、App 更新後鬧鐘被清掉時照它重排（MottoBoot）
final class FujiNotice {
    private static final String CH = "fuji";
    private static final String PREFS = "hiyori";
    private static final String KEY = "fujiNotes";
    private static final String KEY_POSTED = "fujiPosted";
    // 最後發出去的那一則排在幾點（網頁要自己說同一則時用它認出已經發過了，見 claim）
    private static final String KEY_POSTED_AT = "fujiPostedAt";
    private static final String TAG = "fuji";
    private static final int ID = 40;
    // 晚了這麼久還沒發的就不發了（早上那則晚半小時就沒意思了）
    private static final long LATE = 30 * 60_000L;
    // 網頁一次排三天、一天最多三則
    private static final int MAX = 16;

    private FujiNotice() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static PendingIntent alarm(Context c) {
        Intent i = new Intent(c, FujiAlarm.class);
        return PendingIntent.getBroadcast(c, 3, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String clip(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }

    private static JSONArray load(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    // 留下還沒到、或剛到點不久的，存起來，鬧鐘排到最早的那一則（已經到點的馬上響）
    private static void keep(Context c, JSONArray items, long now) {
        JSONArray rest = new JSONArray();
        long next = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            long at = o == null ? 0 : o.optLong("at", 0);
            if (at <= now - LATE) continue;
            rest.put(o);
            if (next == 0 || at < next) next = at;
        }
        prefs(c).edit().putString(KEY, rest.toString()).apply();
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        if (next == 0) {
            alarms.cancel(alarm(c));
            return;
        }
        try {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm(c));
        } catch (SecurityException e) {
            // 系統不讓排準時的鬧鐘：改用一般的（省電時可能晚幾分鐘）
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm(c));
        }
    }

    // 網頁交來的：{ items: [{ at, title, body }] }，空字串是不送了（排著的取消）。內容當成資料看，只收需要的欄位
    static synchronized void plan(Context c, String json) {
        JSONArray items = new JSONArray();
        try {
            JSONArray in = json == null || json.isEmpty() ? null : new JSONObject(json).optJSONArray("items");
            for (int i = 0; in != null && i < in.length() && items.length() < MAX; i++) {
                JSONObject o = in.optJSONObject(i);
                if (o == null) continue;
                long at = o.optLong("at", 0);
                String title = o.optString("title");
                if (at <= 0 || title.isEmpty()) continue;
                items.put(new JSONObject().put("at", at).put("title", clip(title, 80)).put("body", clip(o.optString("body"), 300)));
            }
        } catch (Exception ignored) {
        }
        keep(c, items, System.currentTimeMillis());
    }

    // 鬧鐘響了：到點的拿掉；App 不在前面的話發最近到點的那一則（好幾則一起到點只發最近的），再排下一則
    static synchronized void fire(Context c) {
        JSONArray items = load(c);
        long now = System.currentTimeMillis();
        JSONObject due = null;
        JSONArray rest = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            long at = o == null ? 0 : o.optLong("at", 0);
            if (at > now + 1000) {
                rest.put(o);
                continue;
            }
            if (due == null || at > due.optLong("at")) due = o;
        }
        // 網頁剛請手機發過的那一則（now）又被排回來了：不再發一次
        if (due != null && due.optLong("at") == prefs(c).getLong(KEY_POSTED_AT, 0)) due = null;
        if (due != null && !MainActivity.foreground && now - due.optLong("at") < LATE) {
            show(c, due);
            prefs(c).edit().putLong(KEY_POSTED, now).putLong(KEY_POSTED_AT, due.optLong("at")).apply();
        }
        keep(c, rest, now);
    }

    // 網頁到點了要說排在 at 的那一則（App 在背景、網頁還在跑時的就寢提醒，跟ふじ睡前那則是同一刻）：
    // 手機還沒發的話現在就用ふじ的通知類別發、不再排，已經發過了就不再發，兩種都回 true（網頁就不發）。
    // 手機沒排這一則（還沒收到、被換掉了）回 false：網頁自己說
    static synchronized boolean now(Context c, long at) {
        if (at <= 0) return false;
        if (prefs(c).getLong(KEY_POSTED_AT, 0) == at) return true;
        JSONArray items = load(c);
        JSONArray rest = new JSONArray();
        JSONObject hit = null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null) continue;
            if (hit == null && o.optLong("at", 0) == at) hit = o;
            else rest.put(o);
        }
        if (hit == null) return false;
        long now = System.currentTimeMillis();
        show(c, hit);
        prefs(c).edit().putLong(KEY_POSTED, now).putLong(KEY_POSTED_AT, at).apply();
        keep(c, rest, now);
        return true;
    }

    // 開機、App 更新後：鬧鐘被清掉了，照存著的重排（剛好錯過、還不算太晚的那一則馬上補發）
    static synchronized void restore(Context c) {
        keep(c, load(c), System.currentTimeMillis());
    }

    private static void show(Context c, JSONObject o) {
        String body = o.optString("body");
        NotificationManager m = c.getSystemService(NotificationManager.class);
        m.createNotificationChannel(new NotificationChannel(CH, c.getString(R.string.ch_fuji), NotificationManager.IMPORTANCE_DEFAULT));
        Notification.Builder b = new Notification.Builder(c, CH)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle(o.optString("title"))
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(TimerNotice.open(c));
        // 同一個 tag：新的一則換掉上一則
        m.notify(TAG, ID, b.build());
    }

    // 回到 App：ふじ的那一則看到了（App 裡她自己會說），收掉。剛發出來的（10 秒內）留著：可能剛好在打開 App 的那一刻到點
    static void clear(Context c) {
        if (System.currentTimeMillis() - prefs(c).getLong(KEY_POSTED, 0) < 10_000) return;
        c.getSystemService(NotificationManager.class).cancel(TAG, ID);
    }
}
