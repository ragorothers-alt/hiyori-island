package app.hiyori.daily;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

// 日程開始前、排定的任務開始時、就寢前的提醒，App 關著、手機鎖著也照時間響（網頁的 remindPlan.js 排好、寫好字）。
// 跟ふじ的通知不同：同一刻到點的每一則都發，各自一則通知（tag 是那一件的 id：網頁自己發的同一件會換掉它，不會兩則）。
// App 在前面時不發（畫面上的提示卡會說）。發過的記在 posted，網頁回到前面時拿走（posted()），記成提醒過，不再跳一次提示卡。
// 排好的存在 SharedPreferences：開機、App 更新後鬧鐘被清掉時照它重排（MottoBoot）
final class RemindNotice {
    private static final String PREFS = "hiyori";
    private static final String KEY = "reminds";
    private static final String KEY_POSTED = "remindPosted";
    // 排的時候手機是哪個時區：換了時區（出國、跨時區）時照當地的同一個時間重排（日程記的是幾月幾號幾點）
    private static final String KEY_ZONE = "remindZone";
    // 晚了這麼久還沒發的就不發了：每一則的 until（日程開始後 15 分鐘內、就寢那一刻以前），沒寫的照 LATE
    private static final long LATE = 15 * 60_000L;
    private static final int MAX = 60;
    private static final int POSTED_MAX = 80;

    private RemindNotice() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static PendingIntent alarm(Context c) {
        Intent i = new Intent(c, RemindAlarm.class);
        return PendingIntent.getBroadcast(c, 4, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String clip(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }

    private static JSONArray read(Context c, String key) {
        try {
            return new JSONArray(prefs(c).getString(key, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static long until(JSONObject o) {
        long u = o.optLong("until", 0);
        return u > 0 ? u : o.optLong("at", 0) + LATE;
    }

    // 留下還沒到、或到點了還沒過期限的，存起來，鬧鐘排到最早的那一則（已經到點的馬上響）
    private static void keep(Context c, JSONArray items, long now) {
        JSONArray rest = new JSONArray();
        long next = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            long at = o == null ? 0 : o.optLong("at", 0);
            if (o == null || at <= 0 || now >= until(o)) continue;
            rest.put(o);
            if (next == 0 || at < next) next = at;
        }
        prefs(c).edit().putString(KEY, rest.toString()).putString(KEY_ZONE, java.util.TimeZone.getDefault().getID()).apply();
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

    // 同一則的代號：key 加上那一天（就寢的 key 每天都一樣）
    private static String id(JSONObject o) {
        return o.optString("key") + "|" + o.optString("date");
    }

    // 網頁交來的：{ items: [{ at, until, key, date, title, body, tag }], shown: ["key|date"] }；空字串是都不提醒了（排著的全部取消）。
    // 網頁排的只有還沒到的：已經到點、鬧鐘還沒來得及發的那幾則（同一刻網頁剛好重排、手機睡著晚了）先留著，
    // 排在最前面（不會被 60 則的上限擠掉，明天同一個 key 的那一則也不會頂掉它）；頁面自己提醒過的（shown）不再發。
    // 內容當成資料看，只收需要的欄位
    static synchronized void plan(Context c, String json) {
        long now = System.currentTimeMillis();
        JSONArray items = new JSONArray();
        java.util.HashSet<String> ids = new java.util.HashSet<>();
        try {
            JSONObject root = json == null || json.isEmpty() ? null : new JSONObject(json);
            JSONArray in = root == null ? null : root.optJSONArray("items");
            if (in == null) {
                keep(c, items, now);
                return;
            }
            java.util.HashSet<String> shown = new java.util.HashSet<>();
            JSONArray sh = root.optJSONArray("shown");
            for (int i = 0; sh != null && i < sh.length() && i < 80; i++) shown.add(clip(sh.optString(i), 140));
            JSONArray old = read(c, KEY);
            for (int i = 0; i < old.length() && items.length() < MAX; i++) {
                JSONObject o = old.optJSONObject(i);
                if (o == null || o.optLong("at", 0) > now || now >= until(o) || shown.contains(id(o)) || ids.contains(id(o))) continue;
                items.put(o);
                ids.add(id(o));
            }
            for (int i = 0; i < in.length() && items.length() < MAX; i++) {
                JSONObject o = in.optJSONObject(i);
                if (o == null) continue;
                long at = o.optLong("at", 0);
                String title = o.optString("title");
                String key = clip(o.optString("key"), 120);
                String date = clip(o.optString("date"), 10);
                if (at <= 0 || title.isEmpty() || key.isEmpty() || ids.contains(key + "|" + date) || shown.contains(key + "|" + date)) continue;
                long u = o.optLong("until", 0);
                items.put(new JSONObject().put("at", at).put("until", u > at ? u : at + LATE).put("key", key).put("date", date)
                        .put("title", clip(title, 80)).put("body", clip(o.optString("body"), 200)).put("tag", clip(o.optString("tag"), 60)));
                ids.add(key + "|" + date);
            }
        } catch (Exception ignored) {
        }
        keep(c, items, now);
    }

    // 通知發得出去嗎（App 的通知、提醒這一類都沒被關掉）：發不出去就不記成發過了，回到 App 時頁面自己說
    private static boolean canShow(Context c) {
        NotificationManager m = c.getSystemService(NotificationManager.class);
        if (m == null || !m.areNotificationsEnabled()) return false;
        NotificationChannel ch = m.getNotificationChannel("remind");
        return ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    // 鬧鐘響了：到點的每一則，App 不在前面的話都發（晚太久的不發），記成發過了；再排下一則
    static synchronized void fire(Context c) {
        JSONArray items = read(c, KEY);
        long now = System.currentTimeMillis();
        JSONArray rest = new JSONArray();
        JSONArray posted = read(c, KEY_POSTED);
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            long at = o == null ? 0 : o.optLong("at", 0);
            if (at > now + 1000) {
                rest.put(o);
                continue;
            }
            if (o == null || MainActivity.foreground || now >= until(o) || !canShow(c)) continue;
            TimerNotice.remind(c, o.optString("title"), o.optString("body"), o.optString("tag"));
            try {
                posted.put(new JSONObject().put("key", o.optString("key")).put("date", o.optString("date")));
            } catch (Exception ignored) {
            }
        }
        // 只留最近的那幾筆（網頁一直沒來拿也不會越堆越多）
        JSONArray last = new JSONArray();
        for (int i = Math.max(0, posted.length() - POSTED_MAX); i < posted.length(); i++) last.put(posted.opt(i));
        prefs(c).edit().putString(KEY_POSTED, last.toString()).apply();
        keep(c, rest, now);
    }

    // App 不在前面時發過的（[{ key, date }]）：網頁拿走就清掉
    static synchronized String posted(Context c) {
        String v = prefs(c).getString(KEY_POSTED, "[]");
        prefs(c).edit().remove(KEY_POSTED).apply();
        return v;
    }

    // 開機、App 更新後：鬧鐘被清掉了，照存著的重排（剛好錯過、還不算太晚的那一則馬上補發）
    static synchronized void restore(Context c) {
        keep(c, read(c, KEY), System.currentTimeMillis());
    }

    // 手機換了時區：排著的每一則照「排的時候那個時區的幾點幾分」換成現在這個時區的同一個時間（期限跟著挪），再排。
    // 下次打開 App 時網頁也會照新的時區重排一次
    static synchronized void retime(Context c) {
        String was = prefs(c).getString(KEY_ZONE, "");
        java.util.TimeZone now = java.util.TimeZone.getDefault();
        JSONArray items = read(c, KEY);
        if (!was.isEmpty() && !was.equals(now.getID())) {
            java.util.TimeZone old = java.util.TimeZone.getTimeZone(was);
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                long at = o == null ? 0 : o.optLong("at", 0);
                if (at <= 0) continue;
                long d = shift(at, old, now) - at;
                try {
                    o.put("at", at + d).put("until", until(o) + d);
                } catch (Exception ignored) {
                }
            }
        }
        keep(c, items, System.currentTimeMillis());
    }

    // 那一刻在 from 時區是幾月幾號幾點幾分，換成 to 時區的同一個時間
    static long shift(long at, java.util.TimeZone from, java.util.TimeZone to) {
        java.util.Calendar a = java.util.Calendar.getInstance(from);
        a.setTimeInMillis(at);
        java.util.Calendar b = java.util.Calendar.getInstance(to);
        b.clear();
        b.set(a.get(java.util.Calendar.YEAR), a.get(java.util.Calendar.MONTH), a.get(java.util.Calendar.DAY_OF_MONTH),
                a.get(java.util.Calendar.HOUR_OF_DAY), a.get(java.util.Calendar.MINUTE), a.get(java.util.Calendar.SECOND));
        b.set(java.util.Calendar.MILLISECOND, a.get(java.util.Calendar.MILLISECOND));
        return b.getTimeInMillis();
    }
}
