package app.hiyori.daily;

import android.app.AlarmManager;
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
    // 晚了這麼久還沒發的就不發了（跟網頁一樣：睡著時錯過的，開始後 15 分鐘內還補）
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

    // 網頁交來的：{ items: [{ at, key, date, title, body, tag }] }，空字串是都不提醒了（排著的取消）。內容當成資料看，只收需要的欄位
    static synchronized void plan(Context c, String json) {
        JSONArray items = new JSONArray();
        try {
            JSONArray in = json == null || json.isEmpty() ? null : new JSONObject(json).optJSONArray("items");
            for (int i = 0; in != null && i < in.length() && items.length() < MAX; i++) {
                JSONObject o = in.optJSONObject(i);
                if (o == null) continue;
                long at = o.optLong("at", 0);
                String title = o.optString("title");
                String key = o.optString("key");
                if (at <= 0 || title.isEmpty() || key.isEmpty()) continue;
                items.put(new JSONObject().put("at", at).put("key", clip(key, 120)).put("date", clip(o.optString("date"), 10))
                        .put("title", clip(title, 80)).put("body", clip(o.optString("body"), 200)).put("tag", clip(o.optString("tag"), 60)));
            }
        } catch (Exception ignored) {
        }
        keep(c, items, System.currentTimeMillis());
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
            if (o == null || MainActivity.foreground || now - at >= LATE) continue;
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
}
