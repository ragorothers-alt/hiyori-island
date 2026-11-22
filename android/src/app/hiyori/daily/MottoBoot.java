package app.hiyori.daily;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// 開機、App 更新後鬧鐘會被清掉：照存著的警語提醒、ふじ的通知、日程和任務的提醒重排（不用等打開 App）
public class MottoBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        MottoNotice.restore(context);
        FujiNotice.restore(context);
        RemindNotice.restore(context);
    }
}
