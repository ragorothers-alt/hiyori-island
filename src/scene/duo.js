import * as THREE from 'three'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// もち和ふじ：一起走進小木屋專注、一起出來擊掌，閒晃時互相讓路，偶爾你一句我一句
export class Duo {
  constructor(world, labels, { list, cabin, room }) {
    this.list = list
    this.labels = labels
    this.cabin = cabin
    this.room = room
    for (const c of list) {
      c.cabin = cabin
      c.room = room
      c.others = list.filter((o) => o !== c)
      room.pickRoots.push(c.root)
    }
    this.byId = Object.fromEntries(list.map((c) => [c.id, c]))
    this.focusing = false
    this.chain = Promise.resolve()
    this.tag = null
    world.add(() => {
      // 「並肩專注」：兩人在屋裡時，紙窗上映著她們的影子
      cabin.shadow = this.inside && list[0].abilities.sit ? 1 : 0
    })
  }

  get inside() {
    return this.list.some((c) => c.inside)
  }

  _run(fn) {
    return (this.chain = this.chain.then(fn).catch((e) => console.warn('[hiyori] duo', e)))
  }

  // instant：重新整理後接著專注，直接在屋裡
  setFocus(on, instant = false) {
    if (this.focusing === on) return
    this.focusing = on
    for (const c of this.list) c.mode = on ? 'focus' : 'idle'
    if (on) {
      const el = document.createElement('div')
      el.className = 'focus-tag'
      el.textContent = 'しゅうちゅう'
      // 進到屋內就不用標籤了，整個畫面就是專注中
      this.tag = this.labels.add(el, () => (this.room.active ? null : this._tagAt()))
      if (instant && this.list.every((c) => c.pending === 0 && !c.busy)) {
        for (const c of this.list) c.toRoom()
        this.cabin.setLit(true, true)
        this.room.enter(true)
      } else this._run(() => this._goIn())
    } else {
      this.labels.remove(this.tag)
      this.tag = null
      this._run(() => this._goOut())
    }
  }

  _tagAt() {
    if (this.inside) return this.cabin.point('roofTop').add(new THREE.Vector3(0, 0.45, 0))
    const p = new THREE.Vector3()
    for (const c of this.list) p.add(c.headAnchor())
    return p.multiplyScalar(1 / this.list.length).add(new THREE.Vector3(0, 0.3, 0))
  }

  _doorway() {
    const door = this.cabin.point('doorway')
    const inside = this.cabin.point('inside')
    const out = door.clone().sub(inside).setY(0).normalize()
    return { door, inside, out, side: new THREE.Vector3(out.z, 0, -out.x) }
  }

  async _goIn() {
    await Promise.all(this.list.map((c) => c.settle()))
    if (!this.focusing) return
    const [a, b] = this.list
    const { door, inside, out, side } = this._doorway()
    for (const c of this.list) c.busy = true
    // もち站到門口，ふじ跟在後面一步
    await Promise.all([a.walkTo(door), b.walkTo(door.clone().addScaledVector(out, 0.85).addScaledVector(side, 0.3))])
    if (this.focusing) {
      await this.cabin.swing(1)
      await a.slipIn(inside)
      await b.walkTo(door)
      await b.slipIn(inside)
      this.cabin.setLit(true)
      this.cabin.swing(0)
      if (this.focusing) await this.room.enter()
    }
    for (const c of this.list) c.busy = false
  }

  async _goOut() {
    const [a, b] = this.list
    if (!this.inside) {
      for (const c of this.list) {
        c.busy = false
        c.wanderT = 1 + Math.random() * 2
      }
      return
    }
    for (const c of this.list) c.busy = true
    if (this.room.active) {
      await Promise.all(this.list.map((c) => c.stretch()))
      await this.room.exit()
    }
    const { door, inside, out, side } = this._doorway()
    this.cabin.setLit(false)
    await this.cabin.swing(1)
    await a.slipOut(inside, door)
    const walkA = a.walkTo(door.clone().addScaledVector(out, 0.7).addScaledVector(side, 0.5))
    await wait(250)
    await b.slipOut(inside, door)
    await Promise.all([walkA, b.walkTo(door.clone().addScaledVector(out, 0.7).addScaledVector(side, -0.5))])
    this.cabin.swing(0)
    // 一起努力完，面對面擊掌慶祝
    a.faceAngle = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z)
    b.faceAngle = a.faceAngle + Math.PI
    await wait(350)
    await Promise.all(this.list.map((c) => c._celebrate()))
    for (const c of this.list) {
      c.busy = false
      c.wanderT = 2 + Math.random() * 3
    }
  }

  // 兩人輪流說一段對話：lines = [[角色 id, 台詞], ...]
  async duet(lines, gap = 1900) {
    for (const [id, text] of lines) {
      const c = this.byId[id]
      if (!c || !text) continue
      c.say(text, gap + 1600)
      await wait(gap + text.length * 40)
    }
  }
}
