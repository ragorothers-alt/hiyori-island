// 手機上任務列左右滑：往右滑完成（做完的往右滑是「還沒做完」）、往左滑明天再做（逾期的是移到今天）。
// 只認手指（滑鼠和觸控筆照常用按鈕）；上下捲動交給瀏覽器（.item 設了 touch-action: pan-y）。
// 滑過去的地方露出顏色和字，拉過門檻時字變亮（Android 輕震一下），放開就做
import { calmMotion } from './motion.js'

const SLOP = 12 // 手指移動多少才開始判斷是左右滑還是上下捲

// box：列表容器（事件委派）；actions(id, li) 回傳 { right, left }，每個是 { label, color, run(li) } 或 null
export function bindSwipe(box, actions) {
  let s = null
  let quietUntil = 0
  const reset = (li) => {
    li.classList.remove('sw', 'sw-r', 'sw-l', 'armed')
    li.style.removeProperty('--sx')
    li.style.removeProperty('--sw-c')
    delete li.dataset.sw
  }
  const set = (x) => {
    s.li.style.setProperty('--sx', `${x.toFixed(1)}px`)
    const side = x >= 0 ? 'right' : 'left'
    const a = s.act[side]
    s.li.classList.toggle('sw-r', x >= 0)
    s.li.classList.toggle('sw-l', x < 0)
    if (a) {
      s.li.dataset.sw = a.label
      s.li.style.setProperty('--sw-c', a.color)
    } else delete s.li.dataset.sw
    const armed = !!a && Math.abs(x) >= s.th
    if (armed !== s.armed) {
      s.armed = armed
      s.li.classList.toggle('armed', armed)
      // 拉過門檻的那一下：Android 輕震一下（iPhone 的瀏覽器不支援，沒有反應）
      if (armed) navigator.vibrate?.(8)
    }
  }
  const end = (commit) => {
    const st = s
    s = null
    if (!st?.on) return
    quietUntil = performance.now() + 450
    const { li } = st
    const side = st.x >= 0 ? 'right' : 'left'
    const a = st.act[side]
    if (commit && st.armed && a && li.isConnected) {
      // 往左（明天再做、移到今天）：這一件會從這一頁的列表拿掉，先滑出去再做
      if (side === 'left' && !calmMotion()) {
        const out = li.animate([{ transform: `translateX(${st.x}px)`, opacity: 1 }, { transform: `translateX(${-li.offsetWidth}px)`, opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' })
        out.finished.then(() => a.run(li), () => a.run(li))
        return
      }
      // 往右（完成）：直接做；重畫時這一件從手指放開的位置滑回去（motion.js 的 flipItems 量的是移開的位置）。
      // 沒有重畫到這一件（例如做不了）：等重畫的 microtask 跑完再自己歸位
      a.run(li)
      setTimeout(() => li.isConnected && reset(li), 0)
      return
    }
    // 沒拉過門檻：彈回去
    if (calmMotion()) return reset(li)
    const back = li.animate([{ transform: `translateX(${st.x}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' })
    li.style.setProperty('--sx', '0px')
    back.finished.then(() => reset(li), () => reset(li))
  }
  // 這一列在滑的時候被重畫掉了（同步、別的分頁、計時器）：之後的移動和放開不會再到這個列表，
  // 所以放開、取消都在 document 上接；新的一次按下時，舊的手勢如果還掛著也先丟掉
  const gone = () => s && !s.li.isConnected
  box.addEventListener('pointerdown', (e) => {
    // 新的一下：上一次滑動補的 click 不會再來了，不要把這一下的點擊也吃掉
    quietUntil = 0
    if (gone()) s = null
    if (e.pointerType !== 'touch' || s || !e.isPrimary) return
    const li = e.target.closest('.item[data-id]')
    if (!li || !box.contains(li) || e.target.closest('input, textarea, select, .subs, .inline-input, [contenteditable="true"]')) return
    s = { li, id: li.dataset.id, x0: e.clientX, y0: e.clientY, pid: e.pointerId, x: 0, on: false, armed: false }
  })
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!s || e.pointerId !== s.pid) return
      if (gone()) return (s = null)
      const dx = e.clientX - s.x0
      const dy = e.clientY - s.y0
      if (!s.on) {
        // 先往上下動：是捲動，這次不管
        if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) return (s = null)
        if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy) * 1.3) return
        s.act = actions(s.id, s.li) || {}
        if (!s.act.right && !s.act.left) return (s = null)
        s.on = true
        s.w = s.li.offsetWidth
        s.th = Math.min(110, s.w * 0.3)
        s.li.classList.add('sw')
        try {
          s.li.setPointerCapture(e.pointerId)
        } catch {}
      }
      e.preventDefault?.()
      const raw = dx - Math.sign(dx) * SLOP
      const a = s.act[raw >= 0 ? 'right' : 'left']
      // 沒有這個方向的動作：只拉得動一點點；過了門檻之後越拉越緊
      let x = !a ? raw * 0.12 : Math.abs(raw) <= s.th ? raw : Math.sign(raw) * (s.th + (Math.abs(raw) - s.th) * 0.45)
      x = Math.max(-s.w * 0.7, Math.min(s.w * 0.7, x))
      s.x = x
      set(x)
    },
    { passive: false },
  )
  document.addEventListener('pointerup', (e) => s?.pid === e.pointerId && end(!gone()))
  document.addEventListener('pointercancel', (e) => s?.pid === e.pointerId && end(false))
  // 手指按下時瀏覽器會自動把它抓在按到的那個字上；改抓到整列時，字那邊也會收到「失去抓取」：那不算中斷，
  // 只有整列自己被拿走抓取才算（被重畫掉的那種，事件會跑到 document 上，target 不是這一列）
  document.addEventListener('lostpointercapture', (e) => s?.pid === e.pointerId && s.on && (e.target === s.li || gone()) && end(false))
  // 滑完放開時瀏覽器可能還會補一個 click（點到勾、刪除）：只吃掉這一次滑動補的那一個（新的一下按下去就不吃）
  box.addEventListener(
    'click',
    (e) => {
      if (performance.now() < quietUntil) {
        quietUntil = 0
        e.stopPropagation()
        e.preventDefault()
      }
    },
    true,
  )
}