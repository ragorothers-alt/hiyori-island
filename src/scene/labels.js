import * as THREE from 'three'

// 把 HTML 元素釘在 3D 座標上（對話泡泡、浮動經驗值、專案名牌…）
const v = new THREE.Vector3()

export class Labels {
  constructor(world) {
    this.world = world
    this.root = document.getElementById('labels')
    this.items = new Set()
    world.add(() => this.update())
  }

  // getPos: () => Vector3 | null（每幀呼叫：可以重複用同一個向量回傳，不必每次 new）
  // declutter：會互相避讓的名牌（例如專案町的二十棟房子），重疊時 priority 高、離鏡頭近的留下，其他先淡出
  add(el, getPos, { declutter = false, priority = 0 } = {}) {
    const wrap = document.createElement('div')
    wrap.className = 'lbl'
    wrap.append(el)
    this.root.append(wrap)
    const item = { wrap, el, getPos, declutter, priority }
    this.items.add(item)
    this._place(item)
    return item
  }

  remove(item) {
    if (!item) return
    this.items.delete(item)
    item.wrap.remove()
  }

  // 自動淡出移除
  flash(el, getPos, ms = 1600) {
    const item = this.add(el, getPos)
    setTimeout(() => this.remove(item), ms)
    return item
  }

  // 內容換了（寬度會變）就要重新量
  resized(item) {
    if (item) item.size = null
  }

  // 每幀都會跑：位置、顯示狀態沒變就不寫 style（省掉字串配置和樣式重算）
  _show(item, on) {
    item.shown = on
    if (item.vis === on) return
    item.vis = on
    item.wrap.style.display = on ? '' : 'none'
  }

  _place(item) {
    const p = item.getPos()
    if (!p) return this._show(item, false)
    v.copy(p).project(this.world.camera)
    // 在鏡頭後面、或遠在畫面外（例如在小木屋室內時小島上的標籤）就藏起來
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.6 || Math.abs(v.y) > 1.6) return this._show(item, false)
    this._show(item, true)
    const x = Math.round((v.x * 0.5 + 0.5) * innerWidth * 10) / 10
    const y = Math.round((-v.y * 0.5 + 0.5) * innerHeight * 10) / 10
    item.depth = v.z
    if (x === item.x && y === item.y) return
    item.x = x
    item.y = y
    item.wrap.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  update() {
    const crowd = []
    for (const it of this.items) {
      this._place(it)
      if (it.declutter && it.shown) crowd.push(it)
    }
    if (!crowd.length) return
    // 名牌是置中、底邊對齊錨點（translate(-50%, -100%)）
    crowd.sort((a, b) => b.priority - a.priority || a.depth - b.depth)
    const boxes = []
    for (const it of crowd) {
      it.size ||= [it.el.offsetWidth, it.el.offsetHeight]
      const [w, h] = it.size
      const box = [it.x - w / 2 - 2, it.y - h - 2, it.x + w / 2 + 2, it.y + 2]
      const hit = boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])
      if (it.hidden !== hit) it.wrap.classList.toggle('lbl-hide', (it.hidden = hit))
      if (!hit) boxes.push(box)
    }
  }
}
