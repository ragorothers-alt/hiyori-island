import { LAYOUT } from './island.js'
import { tween, ease } from './util.js'
import { buildCabin } from './models/cabin.js'

// もち的小木屋：專注時もち回到屋裡，窗戶亮燈、煙囪冒煙；有「並肩專注」時紙窗上映著もち的影子
export class Cabin {
  constructor(world, sky) {
    this.sky = sky
    const { x, z, rot, scale } = LAYOUT.cabin
    const g = (this.group = buildCabin())
    g.position.set(x, 0, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    g.userData.pick = { type: 'cabin', id: 'cabin' }
    world.scene.add(g)
    world.addPickable(g)
    g.updateMatrixWorld(true)
    // lit／shadow 是目標值，state 每幀慢慢靠過去
    this.lit = 0
    this.shadow = 0
    this.state = { focus: 0, shadow: 0 }
    this.door = 0
    world.add((dt, t) => this.update(dt, t))
  }

  // 模型標好的位置（doorway 門外、inside 門內、roofTop 屋頂上方）換成世界座標
  point(key) {
    return this.group.localToWorld(this.group.userData[key].clone())
  }

  // instant：重新整理後接著專注，直接亮燈
  setLit(on, instant = false) {
    this.lit = on ? 1 : 0
    if (instant) this.state.focus = this.lit
  }

  swing(to, dur = 0.4) {
    const from = this.door
    return new Promise((res) => tween(dur, (k) => (this.door = from + (to - from) * k), { easing: ease.inOutSine, onDone: res }))
  }

  update(dt, t) {
    const s = this.state
    const k = Math.min(1, dt * 1.6)
    s.focus += (this.lit - s.focus) * k
    s.shadow += (this.shadow - s.shadow) * k
    const u = this.group.userData
    u.setDoor(this.door)
    u.anim(t, dt, this.sky.night, s)
  }
}
