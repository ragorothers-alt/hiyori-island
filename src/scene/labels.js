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

  // getPos: () => Vector3 | null
  add(el, getPos) {
    const wrap = document.createElement('div')
    wrap.className = 'lbl'
    wrap.append(el)
    this.root.append(wrap)
    const item = { wrap, el, getPos }
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

  _place(item) {
    const p = item.getPos()
    if (!p) {
      item.wrap.style.display = 'none'
      return
    }
    v.copy(p).project(this.world.camera)
    // 在鏡頭後面、或遠在畫面外（例如在小木屋室內時小島上的標籤）就藏起來
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.6 || Math.abs(v.y) > 1.6) {
      item.wrap.style.display = 'none'
      return
    }
    item.wrap.style.display = ''
    const x = (v.x * 0.5 + 0.5) * innerWidth
    const y = (-v.y * 0.5 + 0.5) * innerHeight
    item.wrap.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
  }

  update() {
    for (const it of this.items) this._place(it)
  }
}
