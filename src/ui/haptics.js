// 觸感回饋：打勾、選本命、全部完成、番茄鐘到點時，手機輕輕震一下。每台裝置自己記開關（預設開）。
// Android（Chrome、Samsung Internet）用 navigator.vibrate：使用者點過這一頁之後才會震；頁面在背景、手機鎖著時不震（那時有通知）。
// iPhone 的 Safari 沒有 vibrate。iOS 18 起，切換 <input type="checkbox" switch> 時系統會輕輕震一下，
// 所以在使用者點的那一下裡，替一顆藏起來的開關按一下。這不是公開的做法，有的 iOS 版本已經不震了（不會有別的影響）；
// 不在使用者點的那一下裡（例如番茄鐘自己到點）就不試，iPhone 也只能震一下，不能照節奏
const KEY = 'hiyori-haptics'

// 毫秒：震、停、震…
const PATTERNS = {
  tick: 8, // 輕輕一下：選本命、開始專注、滑到可以放手、拖到新的時段
  done: 14, // 打勾
  soft: 6, // 取消完成
  star: [14, 60, 18], // 本命做完
  warn: [24, 50, 24], // 做不到（本命已經選滿）
  party: [14, 60, 14, 60, 28], // 全部完成、升級
  end: [40, 90, 40, 90, 70], // 番茄鐘到點、休息結束
}

export const IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
// 這台裝置震得動嗎（設定裡要不要放這一列）：手指操作的裝置，而且是 Android 的 vibrate 或 iPhone
export const canHaptics = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && (canVibrate() || IOS)

let on = null
export function hapticsOn() {
  if (on == null) {
    try {
      on = JSON.parse(localStorage.getItem(KEY)) !== false
    } catch {
      on = true
    }
  }
  return on
}
export function setHaptics(v) {
  on = !!v
  try {
    localStorage.setItem(KEY, JSON.stringify(on))
  } catch {}
}

// iPhone：藏起來的開關。按它的那一下 click 不是使用者按的：不讓別的地方（點外面就收起來的選單等）收到
let sw = null
function flick() {
  if (!sw?.isConnected) {
    sw = document.createElement('label')
    sw.setAttribute('aria-hidden', 'true')
    sw.style.display = 'none'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.tabIndex = -1
    input.setAttribute('switch', '')
    sw.append(input)
    sw.addEventListener('click', (e) => e.stopPropagation())
    document.body.append(sw)
  }
  sw.click()
}

export function haptic(kind = 'tick') {
  if (!hapticsOn() || typeof document === 'undefined' || document.visibilityState === 'hidden') return
  const act = typeof navigator !== 'undefined' ? navigator.userActivation : null
  if (canVibrate()) {
    // 使用者還沒點過這一頁：瀏覽器不會震（還會在主控台抱怨一句）
    if (act && !act.hasBeenActive) return
    try {
      navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tick)
    } catch {}
    return
  }
  // iPhone：只在使用者點的那一下裡試（不知道的話也試，不會有別的影響）
  if (IOS && act?.isActive !== false) flick()
}
