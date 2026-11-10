package app.hiyori.daily;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// 計時到點的鬧鐘（TimerNotice.apply 排的）：App 沒開著、手機鎖著時系統也會叫到這裡
public class TimerAlarm extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        TimerNotice.done(context, intent.getStringExtra(TimerNotice.EXTRA_TITLE), intent.getStringExtra(TimerNotice.EXTRA_BODY));
    }
}
