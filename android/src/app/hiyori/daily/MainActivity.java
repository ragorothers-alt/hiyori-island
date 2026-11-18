package app.hiyori.daily;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

// 整個畫面是線上的網站：網站更新，這裡就是新版。原生只多做通知（見 TimerNotice）。
// 網頁透過 window.HiyoriNative 叫原生（src/native.js）
public class MainActivity extends Activity {
    static final String HOME = "https://ragorothers-alt.github.io/hiyori-island/";
    private static final int ASK_NOTIFY = 1;
    private static final int PICK_FILE = 2;

    private WebView web;
    private ValueCallback<Uri[]> picking;
    // 現在開著的是不是自己的網站：不是的話（照理不會發生）不讓它叫原生
    private volatile boolean trusted;
    // App 在前面嗎：警語的鬧鐘響時在前面就不發通知（網頁自己會念）
    static volatile boolean foreground;
    // 上一次離開 App 時手機是不是鎖著（按電源鍵、螢幕自己關掉）：鎖著手機專心做事不算「中途離開」。
    // 也存在 SharedPreferences：App 在背景被系統收掉、重新打開時，網頁問得到剛才那一次
    private static final String KEY_AWAY_LOCKED = "awayLocked";
    // 按了警語通知上的按鈕（"focus"／"pause"）：網頁用 takeAct 拿走、照著做
    private String act;
    private static final String KEY_ACT = "hiyoriAct";
    // 那顆按鈕是哪一則警語通知上的（排在幾點）；takenAt：網頁剛拿走的那一顆的（網頁接著用 actAt 問）
    private long actAt;
    private long takenAt;
    private static final String KEY_ACT_AT = "hiyoriActAt";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xFFEAF2FA);
        web = new WebView(this);
        frame.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(frame);
        // Android 15 起畫面一律延伸到狀態列和導覽列底下：外框讓出那些位置，鍵盤跳出來時也讓開
        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsets.CONSUMED;
        });
        WindowInsetsController bars = getWindow().getInsetsController();
        if (bars != null) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            bars.setSystemBarsAppearance(light, light);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "HiyoriNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap icon) {
                trusted = url != null && url.startsWith(HOME);
            }

            // 自己的網站留在 App 裡，其他連結交給瀏覽器
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url.toString().startsWith(HOME)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // 匯入備份、選檔案
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picking != null) picking.onReceiveValue(null);
                picking = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    picking = null;
                    return false;
                }
                return true;
            }
        });
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(HOME);
        // 從通知上的按鈕打開的（App 原本沒在跑）。系統收回後重建、從最近使用的 App 叫回來的，帶的還是當初那個，不算；
        // 那時網頁還沒來拿的那一次存在 saved 裡，接著交給網頁
        if (saved != null) {
            synchronized (this) {
                act = saved.getString(KEY_ACT);
                actAt = saved.getLong(KEY_ACT_AT, 0);
            }
        } else if ((getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) takeIntent(getIntent());
        // 第一次打開先問通知權限：沒有它，倒數和到點的通知都出不來
        if (!canNotify() && saved == null) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFY);
    }

    // App 已經開著時按了通知上的按鈕（singleTask：送到這裡）
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (takeIntent(intent)) web.evaluateJavascript("window.dispatchEvent(new Event('hiyori-native-act'))", null);
    }

    // 是警語通知上的按鈕的話記下來（網頁開好了會來拿）、那一則通知收掉，回傳 true
    private boolean takeIntent(Intent intent) {
        String a = MottoNotice.actOf(this, intent);
        if (a == null) return false;
        synchronized (this) {
            act = a;
            actAt = MottoNotice.atOf(this, intent);
        }
        MottoNotice.dismiss(this);
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        // 回到 App：「時間到了」和上一則警語已經看到了，收掉
        TimerNotice.clearDone(this);
        MottoNotice.clear(getApplicationContext());
        FujiNotice.clear(getApplicationContext());
    }

    @Override
    protected void onPause() {
        super.onPause();
        foreground = false;
        setAwayLocked(MottoNotice.locked(this));
        // 到點了、網頁還沒念的警語：離開 App 的這一刻由手機補發
        MottoNotice.away(getApplicationContext());
    }

    // 按電源鍵時，螢幕關掉、鎖定畫面出來可能比 onPause 晚一點：完全離開時再看一次
    @Override
    protected void onStop() {
        super.onStop();
        if (!foreground && MottoNotice.locked(this)) setAwayLocked(true);
    }

    private void setAwayLocked(boolean v) {
        getSharedPreferences("hiyori", MODE_PRIVATE).edit().putBoolean(KEY_AWAY_LOCKED, v).apply();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
        // 按了通知上的按鈕、網頁還沒來拿：系統收回後重建時接著交給網頁
        synchronized (this) {
            if (act != null) {
                out.putString(KEY_ACT, act);
                out.putLong(KEY_ACT_AT, actAt);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request != PICK_FILE || picking == null) return;
        picking.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        picking = null;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request != ASK_NOTIFY) return;
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('hiyori-native-perm',{detail:" + ok + "}))", null);
    }

    boolean canNotify() {
        return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                && getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    // 網頁叫得到的東西。這些方法在另一條執行緒被叫到；只收字串，內容當成資料看
    class Bridge {
        // 2：多了 mottos（警語的定時提醒）；3：多了 mottoSeen、takeAct（警語通知上的按鈕）；
        // 4：多了 awayLocked，mottos 收得下 back（專注中離開太久叫你回來的那一則，手機鎖著就不發）；
        // 5：多了 actAt（按鈕是哪一則警語通知上的）、shown（App 不在前面時發過的警語）；
        // 6：多了 fujiNotes（ふじ在 App 關著時的通知）、fujiClaim（網頁自己說了其中一則）
        @JavascriptInterface
        public int version() {
            return 6;
        }

        // ふじ在 App 關著時的通知：json 是接下來的每一則 { items: [{ at, title, body }] }，空字串是不送了
        @JavascriptInterface
        public void fujiNotes(String json) {
            if (trusted) FujiNotice.plan(getApplicationContext(), json);
        }

        // 網頁要自己說排在 at（毫秒）的那一則：還沒發的話手機不發了，回 true；已經發過了回 false
        @JavascriptInterface
        public boolean fujiClaim(String at) {
            if (!trusted) return false;
            try {
                return FujiNotice.claim(getApplicationContext(), Long.parseLong(at));
            } catch (NumberFormatException e) {
                return false;
            }
        }

        // 按了警語通知上的哪一顆按鈕："focus"（開始專注現在該做的那一件）、"pause"（先停 1 小時），沒有是空字串。拿走就清掉
        @JavascriptInterface
        public String takeAct() {
            if (!trusted) return "";
            synchronized (MainActivity.this) {
                String a = act;
                takenAt = a == null ? 0 : actAt;
                act = null;
                actAt = 0;
                return a == null ? "" : a;
            }
        }

        // 剛用 takeAct 拿走的那一顆按鈕是哪一則警語通知上的（排在幾點）；不知道是 0
        @JavascriptInterface
        public long actAt() {
            if (!trusted) return 0;
            synchronized (MainActivity.this) {
                return takenAt;
            }
        }

        // App 不在前面時手機發過的警語（最近 32 則排在幾點的 JSON 陣列）：只是讀、不清掉，算過哪幾則網頁自己記著
        // （網頁的存檔寫不進去時，重新打開還拿得到）
        @JavascriptInterface
        public String shown() {
            return trusted ? MottoNotice.shown(getApplicationContext()) : "[]";
        }

        @JavascriptInterface
        public boolean canNotify() {
            return MainActivity.this.canNotify();
        }

        // 系統讓不讓這個 App 的通知升級成即時通知（使用者可以在設定裡關）
        @JavascriptInterface
        public boolean canLive() {
            return getSystemService(NotificationManager.class).canPostPromotedNotifications();
        }

        // 問通知權限；問過被拒絕、系統不再跳視窗時，打開這個 App 的通知設定。結果用 hiyori-native-perm 事件回給網頁
        @JavascriptInterface
        public void askNotify() {
            if (!trusted) return;
            runOnUiThread(() -> {
                boolean granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                if (!granted) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFY);
                else if (!MainActivity.this.canNotify()) startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            });
        }

        // 計時的狀態變了（開始、暫停、換目標、結束）：json 是要顯示的樣子，空字串是沒在計時
        @JavascriptInterface
        public void timer(String json) {
            if (trusted) TimerNotice.apply(getApplicationContext(), json);
        }

        // 一般的提醒（日程、就寢、重要日子…）
        @JavascriptInterface
        public void notify(String title, String body, String tag) {
            if (trusted) TimerNotice.remind(getApplicationContext(), title, body, tag);
        }

        // 警語的定時提醒：json 是接下來的每一則 { items: [{ at, title, body }] }，空字串是不提醒了
        @JavascriptInterface
        public void mottos(String json) {
            if (trusted) MottoNotice.plan(getApplicationContext(), json);
        }

        // 警語念到哪一則了（手機通知過、或網頁念過的最後一則的時間）
        @JavascriptInterface
        public long mottoHandled() {
            return MottoNotice.handledAt(getApplicationContext());
        }

        // 網頁要念 at 那一則：先說一聲（手機就不發）。手機已經通知過了回傳 false
        @JavascriptInterface
        public boolean mottoClaim(long at) {
            return trusted && MottoNotice.claim(getApplicationContext(), at);
        }

        // 使用者按了網頁念的那一則提示卡上的按鈕（先停、開始專注）：看到了，離開 App 時不用再用通知發一次
        @JavascriptInterface
        public void mottoSeen() {
            if (trusted) MottoNotice.seen(getApplicationContext());
        }

        // App 在前面嗎（App 在背景時網頁的 JavaScript 可能還在跑）
        @JavascriptInterface
        public boolean foreground() {
            return foreground;
        }

        // 上一次離開 App 時手機是不是鎖著（是的話不算「切去用別的 App」）
        @JavascriptInterface
        public boolean awayLocked() {
            return getSharedPreferences("hiyori", MODE_PRIVATE).getBoolean(KEY_AWAY_LOCKED, false);
        }
    }
}
