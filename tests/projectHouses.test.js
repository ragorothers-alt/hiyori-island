// 專案町的房子：落成時完工線框淡出；淡出途中又取消落成，新的線框不能跟著被淡成看不見
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ProjectHouses } from '../src/scene/projectHouses.js'
import { updateTweens } from '../src/scene/util.js'

const world = () => ({ scene: new THREE.Scene(), addPickable() {}, add() {} })
const project = (done) => ({ id: 'p1', slot: 0, color: 0, milestones: [{ id: 'm1', done }], deadline: '', pausedAt: null, onTime: false })

describe('專案町的房子', () => {
  it('落成後 0.6 秒內取消：線框照樣看得到，舊的線框收掉', () => {
    const houses = new ProjectHouses(world(), { night: 0 })
    houses.sync([project(false)], () => 0.5, false)
    const h = houses.get('p1')
    const first = h.ghost
    expect(first).toBeTruthy()
    // 落成：線框開始淡出
    houses.sync([project(true)], () => 1, true)
    expect(h.ghost).toBeNull()
    updateTweens(0.2)
    // 淡出還沒跑完就取消落成
    houses.sync([project(false)], () => 0.5, true)
    expect(h.ghost).toBeTruthy()
    expect(first.parent).toBeNull()
    for (let i = 0; i < 20; i++) updateTweens(0.1)
    expect(h.ghostMat.opacity).toBeGreaterThan(0.1)
    expect(h.ghost.parent).toBe(h.group)
  })
})
