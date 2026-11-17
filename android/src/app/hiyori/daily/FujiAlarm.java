package app.hiyori.daily;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// ふじ的通知的鬧鐘（FujiNotice 排的）：App 沒開著、手機鎖著時系統也會叫到這裡
public class FujiAlarm extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        FujiNotice.fire(context);
    }
}
