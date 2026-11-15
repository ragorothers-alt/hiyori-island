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

// 警語的定時提醒：網頁排好接下來的每一則（幾點、標題、內容），交給手機的鬧鐘一則一則發。
// App 被收掉、手機鎖著也照時間通知。每一則只由一邊念：這裡記著「念到哪一則了」（handled，手機通知過、
// 或網頁念過的最後一則的時間），兩邊都照它分——
//   App 不在前面：到點的由這裡通知，記下來（網頁醒著也不會再念）
//   App 在前面：這裡不發，網頁念之前先 claim（記下來）；網頁還沒念就離開 App 的話，離開時（away）補發
// 排好的存在 SharedPreferences：開機、App 更新後鬧鐘被清掉時照它重排（MottoBoot）
final class MottoNotice {
    private static final String CH = "motto";
    private static final String PREFS = "hiyori";
    private static final String KEY = "mottos";
    private static final String KEY_HANDLED = "mottoHandled";
    private static final String KEY_POSTED = "mottoPosted";
    // 網頁剛念的那一則（{ at, title, body, wall }，wall 是念的時候）：剛念完就離開 App 的話改用通知再發一次
    private static final String KEY_CLAIMED = "mottoClaimed";
    private static final long CLAIM_GRACE = 2000;
    private static final String TAG = "motto";
    private static final int ID = 20;
    // 到點晚了這麼久還沒通知的就不發了（過時的提醒沒有用）；網頁那邊是 MOTTO_LATE，兩邊要一樣
    private static final long LATE = 10 * 60_000L;
    // 最多收幾則（網頁最多排 300 則）
    private static final int MAX = 320;

    private MottoNotice() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static PendingIntent alarm(Context c) {
        Intent i = new Intent(c, MottoAlarm.class);
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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

    // 念到哪一則了。記的時間遠在未來（時鐘被往回調過）就清掉：不然之後的都會被當成念過了
    // （只當成沒有、不清掉的話，時間走到那附近又會生效）
    private static long handled(Context c, long now) {
        long h = prefs(c).getLong(KEY_HANDLED, 0);
        if (h <= now + LATE) return h;
        prefs(c).edit().putLong(KEY_HANDLED, 0).apply();
        return 0;
    }

    // 留下 cutoff 以後的（還沒處理、晚得不多的），存起來，排鬧鐘到最早的那一則（已經到點的會馬上響）。
    // App 在前面時已經到點的不排：網頁會念，離開 App 時 away 補發
    private static void keep(Context c, JSONArray items, long cutoff, long now) {
        JSONArray rest = new JSONArray();
        long next = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            long at = o == null ? 0 : o.optLong("at", 0);
            if (at <= cutoff) continue;
            rest.put(o);
            if (at <= now && MainActivity.foreground) continue;
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

    private static long cutoff(long handled, long now) {
        return Math.max(handled, now - LATE);
    }

    // 網頁交來的：{ items: [{ at, title, body }] }，空字串是不提醒了（排著的取消）。內容當成資料看，只收需要的欄位
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
        long now = System.currentTimeMillis();
        keep(c, items, cutoff(handled(c, now), now), now);
    }

    // App 不在前面的話：發最近到點、還沒處理的那一則（好幾則一起到點只發最近的；晚太久的只記成處理過），再排下一則
    private static void check(Context c) {
        JSONArray items = load(c);
        long now = System.currentTimeMillis();
        long handled = handled(c, now);
        if (!MainActivity.foreground) {
            JSONObject due = null;
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                long at = o == null ? 0 : o.optLong("at", 0);
                if (at > handled && at <= now + 1000 && (due == null || at > due.optLong("at"))) due = o;
            }
            if (due != null) {
                handled = due.optLong("at");
                SharedPreferences.Editor e = prefs(c).edit().putLong(KEY_HANDLED, handled);
                if (now - handled < LATE) {
                    show(c, due.optString("title"), due.optString("body"));
                    e.putLong(KEY_POSTED, now);
                }
                e.apply();
            }
        }
        keep(c, items, cutoff(handled, now), now);
    }

    // 鬧鐘響了
    static synchronized void fire(Context c) {
        check(c);
    }

    // 剛離開 App（MainActivity.onPause，foreground 已經是 false）：到點了、網頁還沒念的，這裡補發。
    // 網頁剛念完（2 秒內）就離開了：使用者多半沒看到畫面上的提示卡（也可能是網頁說完這一聲的同時剛好離開，
    // 提示卡出現在背景），改用通知再發一次
    static synchronized void away(Context c) {
        check(c);
        String s = prefs(c).getString(KEY_CLAIMED, null);
        if (s == null) return;
        SharedPreferences.Editor e = prefs(c).edit().remove(KEY_CLAIMED);
        try {
            JSONObject o = new JSONObject(s);
            long now = System.currentTimeMillis();
            if (now - o.optLong("wall") < CLAIM_GRACE && now - o.optLong("at") < LATE) {
                show(c, o.optString("title"), o.optString("body"));
                e.putLong(KEY_POSTED, now);
            }
        } catch (Exception ignored) {
        }
        e.apply();
    }

    // 網頁要念這一則：還沒人處理過就記下來（這裡就不發），回傳 true；這裡已經通知過了回傳 false（網頁就不念）。
    // 網頁判斷「App 在前面」之後、說這一聲之前剛好離開了 App（onPause 先拿到鎖、那時這一則還沒人處理）：
    // 改由這裡現在發，回傳 false
    static synchronized boolean claim(Context c, long at) {
        long now = System.currentTimeMillis();
        if (at <= handled(c, now)) return false;
        if (!MainActivity.foreground) {
            check(c);
            if (at <= handled(c, now)) return false;
        }
        // 記下網頁要念的這一則：念完的這一刻剛好離開 App 的話，away 用通知再發一次
        JSONArray items = load(c);
        SharedPreferences.Editor e = prefs(c).edit().putLong(KEY_HANDLED, at).remove(KEY_CLAIMED);
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o == null || o.optLong("at", 0) != at) continue;
            try {
                e.putString(KEY_CLAIMED, new JSONObject(o.toString()).put("wall", now).toString());
            } catch (Exception ignored) {
            }
            break;
        }
        e.apply();
        keep(c, items, cutoff(at, now), now);
        return true;
    }

    // 網頁剛念的那一則，使用者按了提示卡上的按鈕（看到了）：離開 App 時不用再發一次
    static synchronized void seen(Context c) {
        prefs(c).edit().remove(KEY_CLAIMED).apply();
    }

    static synchronized long handledAt(Context c) {
        return handled(c, System.currentTimeMillis());
    }

    // 開機、App 更新後：鬧鐘被清掉了，照存著的重排（剛好錯過、還不算太晚的那一則馬上補發）
    static synchronized void restore(Context c) {
        long now = System.currentTimeMillis();
        keep(c, load(c), cutoff(handled(c, now), now), now);
    }

    private static void show(Context c, String title, String body) {
        NotificationManager m = c.getSystemService(NotificationManager.class);
        m.createNotificationChannel(new NotificationChannel(CH, c.getString(R.string.ch_motto), NotificationManager.IMPORTANCE_HIGH));
        // 同一個 tag：新的一則換掉上一則，不會在通知欄疊一長串
        m.notify(TAG, ID, new Notification.Builder(c, CH)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(TimerNotice.open(c))
                .build());
    }

    // 回到 App：上一則警語看到了，收掉。剛發出來的（10 秒內）留著：可能剛好在打開 App 的那一刻到點，還沒看到
    static void clear(Context c) {
        if (System.currentTimeMillis() - prefs(c).getLong(KEY_POSTED, 0) < 10_000) return;
        c.getSystemService(NotificationManager.class).cancel(TAG, ID);
    }
}
