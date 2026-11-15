package app.hiyori.daily;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// 警語提醒的鬧鐘（MottoNotice 排的）：App 沒開著、手機鎖著時系統也會叫到這裡
public class MottoAlarm extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        MottoNotice.fire(context);
    }
}
