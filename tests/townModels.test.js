import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BUILDINGS, RESIDENTS, MAX_STAGE } from '../src/data/town.js'
import { buildBuilding, buildResident } from '../src/scene/models/town/index.js'

// 模型的規格：街區浮島半徑 2.7，建築放在中心後方 0.5，居民在店門口和浮島上閒晃
const MAX_R = [0, 0.9, 1.1, 1.35, 1.55, 1.7]
const MAX_H = [0, 1.3, 1.8, 2.4, 3.0, 3.6]
const CLOCK_H = { 4: 3.8, 5: 4.4 }

const stats = (obj) => {
  let meshes = 0
  let tris = 0
  obj.traverse((o) => {
    if (!o.isMesh) return
    meshes++
    const g = o.geometry
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3
  })
  return { meshes, tris }
}

describe('ひより町的建築模型', () => {
  for (const b of BUILDINGS) {
    it(`${b.name}：五個階段都蓋得出來，越長越大，介面齊全`, () => {
      let prev = 0
      for (let stage = 1; stage <= MAX_STAGE; stage++) {
        const g = buildBuilding(b.key, stage)
        const box = new THREE.Box3().setFromObject(g)
        const r = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)
        expect(r).toBeLessThanOrEqual(MAX_R[stage] + 0.05)
        expect(box.max.y).toBeLessThanOrEqual(((b.key === 'clock' && CLOCK_H[stage]) || MAX_H[stage]) + 0.05)
        expect(box.min.y).toBeGreaterThan(-0.2)
        const u = g.userData
        expect(u.front).toBeInstanceOf(THREE.Vector3)
        expect(u.top).toBeInstanceOf(THREE.Vector3)
        expect(u.front.z).toBeGreaterThan(0)
        expect(typeof u.anim).toBe('function')
        expect(() => u.anim(1.5, 0.016, { night: 1, hour: 21 })).not.toThrow()
        expect(Array.isArray(u.ownedMaterials) && Array.isArray(u.ownedTextures)).toBe(true)
        const s = stats(g)
        expect(s.meshes).toBeLessThanOrEqual(60)
        expect(s.tris).toBeLessThanOrEqual(14000)
        // 下一階至少不比上一階小
        const size = box.getSize(new THREE.Vector3()).length()
        expect(size).toBeGreaterThanOrEqual(prev * 0.98)
        prev = size
      }
    })
  }
})

describe('ひより町的居民模型', () => {
  for (const r of Object.values(RESIDENTS)) {
    it(`${r.name}（${r.animal}）：關節、頭頂、動畫齊全，大小比貓娘小一點`, () => {
      const g = buildResident(r.kind)
      const box = new THREE.Box3().setFromObject(g)
      const h = box.max.y - box.min.y
      expect(h).toBeGreaterThan(0.75)
      expect(h).toBeLessThan(1.15)
      expect(box.min.y).toBeGreaterThan(-0.05)
      const u = g.userData
      for (const j of ['body', 'head', 'armL', 'armR', 'legL', 'legR']) expect(u.joints[j]).toBeInstanceOf(THREE.Object3D)
      expect(u.headTop).toBeInstanceOf(THREE.Vector3)
      for (const s of [{ walk: 1 }, { wave: 1, talk: 1 }, { night: 1 }]) expect(() => u.anim(2, 0.016, { walk: 0, wave: 0, talk: 0, night: 0, ...s })).not.toThrow()
      const s = stats(g)
      expect(s.meshes).toBeLessThanOrEqual(30)
      expect(s.tris).toBeLessThanOrEqual(6000)
    })
  }
})
