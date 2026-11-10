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
        // 第一次打開先問通知權限：沒有它，倒數和到點的通知都出不來
        if (!canNotify() && saved == null) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFY);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 回到 App：「時間到了」那一則已經看到了，收掉
        TimerNotice.clearDone(this);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
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
        @JavascriptInterface
        public int version() {
            return 1;
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
    }
}
