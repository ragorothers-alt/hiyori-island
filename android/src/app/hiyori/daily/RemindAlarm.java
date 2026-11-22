package app.hiyori.daily;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// 日程、排定的任務、就寢提醒的鬧鐘（RemindNotice 排的）：App 沒開著、手機鎖著時系統也會叫到這裡
public class RemindAlarm extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        RemindNotice.fire(context);
    }
}
