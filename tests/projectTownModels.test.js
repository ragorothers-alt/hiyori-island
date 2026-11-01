import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { mat } from '../src/scene/util.js'
import { buildHouse, buildGhost, HOUSE_KINDS, KINDS_BY_HEIGHT } from '../src/scene/models/projectTown/index.js'

const HEIGHTS = { machiya: 1.4, teahouse: 1.2, shop: 1.6, workshop: 1.6, inn: 2.2, watchtower: 3.2 }
function stats(group) {
  let meshes = 0, triangles = 0
  group.traverse((o) => {
    if (!o.isMesh) return
    meshes++
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3
  })
  return { meshes, triangles }
}
function release(g) {
  g.traverse(o => { if (o.geometry) o.geometry.dispose() })
  g.userData.ownedMaterials?.forEach(m => m.dispose())
  g.userData.ownedTextures?.forEach(t => t.dispose())
}

function vertices(group) {
  group.updateMatrixWorld(true)
  const points = []
  group.traverse(o => {
    if (!o.geometry) return
    const p = o.geometry.attributes.position
    for (let i = 0; i < p.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld))
  })
  return points
}

// Check attachment against triangles, independently of the builder's raycast.
function surfaceDistance(group, point) {
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3()
  let distance = Infinity
  group.traverse(o => {
    if (!o.isMesh) return
    const p = o.geometry.attributes.position, index = o.geometry.index
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      for (const [j, v] of [triangle.a, triangle.b, triangle.c].entries()) {
        v.fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(o.matrixWorld)
      }
      triangle.closestPointToPoint(point, closest)
      distance = Math.min(distance, point.distanceTo(closest))
    }
  })
  return distance
}

describe('專案町：模型契約', () => {
  it('登記六種房屋與可用高度分類', () => {
    expect(HOUSE_KINDS).toEqual(['machiya', 'shop', 'workshop', 'inn', 'teahouse', 'watchtower'])
    expect(KINDS_BY_HEIGHT).toEqual({ low: ['machiya', 'teahouse'], mid: ['machiya', 'shop', 'workshop', 'inn'], tall: ['watchtower'] })
  })
  for (const kind of HOUSE_KINDS) for (const base of [1.4, 1.6, 1.8]) {
    it(`${kind} / base ${base}：stage 0–5 邊界、錨點、動畫與資源所有權`, () => {
      let lastTop = 0
      for (let stage = 0; stage <= 5; stage++) {
        const g = buildHouse(kind, stage, { base })
        expect(g).toBeInstanceOf(THREE.Group)
        const u = g.userData, bounds = new THREE.Box3().setFromObject(g)
        for (const p of ['top', 'door', 'flag']) {
          expect(u[p]).toBeInstanceOf(THREE.Vector3)
          expect(u[p].toArray().every(Number.isFinite)).toBe(true)
        }
        expect(u.top.y).toBeCloseTo(bounds.max.y, 5)
        expect(surfaceDistance(g, u.top)).toBeLessThan(1e-6)
        expect(surfaceDistance(g, u.flag)).toBeLessThan(1e-6)
        expect(u.top.y + 1e-6).toBeGreaterThanOrEqual(lastTop)
        lastTop = u.top.y
        expect(u.door.z).toBeGreaterThan(0)
        expect(Math.abs(u.door.x)).toBeLessThanOrEqual(base / 2)
        expect(u.door.z).toBeLessThanOrEqual(base / 2)
        expect(u.door.y).toBe(0)
        expect(typeof u.anim).toBe('function')
        expect(Array.isArray(u.ownedMaterials)).toBe(true)
        expect(u.ownedTextures).toEqual([])
        expect(new Set(u.ownedMaterials).size).toBe(u.ownedMaterials.length)
        for (const night of [0, .5, 1]) {
          expect(() => u.anim(1.5, .016, { night })).not.toThrow()
          const animatedBounds = new THREE.Box3().setFromObject(g)
          expect(Math.max(-animatedBounds.min.x, animatedBounds.max.x, -animatedBounds.min.z, animatedBounds.max.z)).toBeLessThanOrEqual(base / 2 + .120001)
          expect(animatedBounds.max.y).toBeLessThanOrEqual(HEIGHTS[kind] * base / 1.6 + .100001)
          expect(animatedBounds.min.y).toBeGreaterThanOrEqual(-1e-6)
        }
        expect(() => u.anim()).not.toThrow()
        expect(() => u.anim(NaN, 0, null)).not.toThrow()
        g.traverse(o => {
          if (!o.isMesh) return
          expect(o.receiveShadow).toBe(true)
          expect(o.castShadow).toBe(!o.material.transparent && o.material.side !== THREE.DoubleSide)
          expect(o.geometry.attributes.position.array.every(Number.isFinite)).toBe(true)
          if (!u.ownedMaterials.includes(o.material)) expect(o.material).toBe(mat('#ffffff', { vertexColors: true }))
        })
        if (stage === 5) {
          const s = stats(g)
          expect(s.meshes).toBeLessThanOrEqual(40)
          expect(s.triangles).toBeLessThanOrEqual(6000)
        }
        release(g)
      }
    })
  }
  for (const kind of HOUSE_KINDS) {
    it(`${kind}：線框只有 LineSegments，保留傳入材質；幾何與材質不跨棟共用`, () => {
      const material = new THREE.LineBasicMaterial({ color: '#bcae98' })
      for (const base of [1.4, 1.6, 1.8]) {
        const ghost = buildGhost(kind, { base, material })
        expect(ghost.children.length).toBeGreaterThan(0)
        ghost.traverse(o => { if (o !== ghost) {
          expect(o.isLineSegments).toBe(true); expect(o.material).toBe(material)
          expect(o.geometry.parameters.geometry).toBeNull()
        } })
        const bounds = new THREE.Box3().setFromObject(ghost)
        expect(bounds.max.y).toBeLessThanOrEqual(HEIGHTS[kind] * base / 1.6 + .1)
        expect(Math.max(-bounds.min.x, bounds.max.x, -bounds.min.z, bounds.max.z)).toBeLessThanOrEqual(base / 2 + .120001)
        release(ghost)
      }
      const a = buildHouse(kind, 5), b = buildHouse(kind, 5, { color: '#88bfe4' })
      const ga = new Set(); a.traverse(o => { if (o.geometry) ga.add(o.geometry) })
      b.traverse(o => { if (o.geometry) expect(ga.has(o.geometry)).toBe(false) })
      for (const m of a.userData.ownedMaterials) expect(b.userData.ownedMaterials).not.toContain(m)
      a.userData.anim(1, .016, { night: 1 }); b.userData.anim(1, .016, { night: 0 })
      expect(a.userData.ownedMaterials.some(m => m.emissiveIntensity > 1)).toBe(true)
      expect(b.userData.ownedMaterials.filter(m => m.emissive.getHex() !== 0).every(m => m.emissiveIntensity === 0)).toBe(true)
      release(a); release(b); material.dispose()
    })
  }
  it('所有階段的幾何、錨點與動畫在不同 base 等比縮放', () => {
    for (const kind of HOUSE_KINDS) for (let stage = 0; stage <= 5; stage++) {
      const reference = buildHouse(kind, stage)
      reference.userData.anim(2, .016, { night: 1 })
      const expected = vertices(reference)
      for (const base of [1.4, 1.8]) {
        const g = buildHouse(kind, stage, { base }), scale = base / 1.6
        g.userData.anim(2, .016, { night: 1 })
        const actual = vertices(g)
        expect(actual.length).toBe(expected.length)
        let error = 0
        actual.forEach((p, i) => { error = Math.max(error, p.distanceTo(expected[i].clone().multiplyScalar(scale))) })
        expect(error).toBeLessThan(1e-6)
        for (const key of ['top', 'door', 'flag']) expect(g.userData[key].distanceTo(reference.userData[key].clone().multiplyScalar(scale))).toBeLessThan(1e-6)
        release(g)
      }
      release(reference)
    }
  })
  it('20 棟逐幀動畫不遍歷樹、不改其他棟或共用材質', () => {
    const houses = Array.from({ length: 20 }, (_, i) => buildHouse(HOUSE_KINDS[i % HOUSE_KINDS.length], 5))
    const shared = mat('#ffffff', { vertexColors: true }), before = shared.toJSON()
    const idleMaterials = houses.slice(1).flatMap(g => g.userData.ownedMaterials).map(m => m.toJSON())
    const idleRotations = houses.slice(1).map(g => g.getObjectByName('noren-pivot').rotation.toArray())
    const traverse = vi.spyOn(THREE.Object3D.prototype, 'traverse').mockImplementation(() => { throw new Error('per-frame traversal') })
    try {
      for (let i = 0; i < 60; i++) houses[0].userData.anim(i / 60, 1 / 60, { night: i / 60 })
    } finally { traverse.mockRestore() }
    expect(shared.toJSON()).toEqual(before)
    expect(houses.slice(1).flatMap(g => g.userData.ownedMaterials).map(m => m.toJSON())).toEqual(idleMaterials)
    expect(houses.slice(1).map(g => g.getObjectByName('noren-pivot').rotation.toArray())).toEqual(idleRotations)
    expect(houses[0].getObjectByName('noren-pivot').rotation.x).not.toBe(0)
    houses.forEach(release)
  })
  it('重建與 ghost 的所有暫存資源都有釋放，且不 dispose 共用或借入材質', () => {
    const shared = mat('#ffffff', { vertexColors: true }), line = new THREE.LineBasicMaterial()
    const geometries = new Set(), materials = new Set(), disposed = new Map()
    const attribute = THREE.BufferGeometry.prototype.setAttribute
    const values = THREE.Material.prototype.setValues
    const record = function () { disposed.set(this, (disposed.get(this) ?? 0) + 1) }
    const spies = [
      vi.spyOn(THREE.BufferGeometry.prototype, 'setAttribute').mockImplementation(function (...args) { geometries.add(this); return attribute.apply(this, args) }),
      vi.spyOn(THREE.Material.prototype, 'setValues').mockImplementation(function (...args) { materials.add(this); return values.apply(this, args) }),
      vi.spyOn(THREE.BufferGeometry.prototype, 'dispose').mockImplementation(record),
      vi.spyOn(THREE.Material.prototype, 'dispose').mockImplementation(record),
    ]
    const liveGeometry = new Set(), liveMaterials = new Set()
    try {
      for (const kind of HOUSE_KINDS) for (let stage = 0; stage <= 5; stage++) {
        const a = buildHouse(kind, stage), b = buildHouse(kind, stage)
        for (const g of [a, b]) {
          g.traverse(o => {
            if (!o.geometry) return
            expect(liveGeometry.has(o.geometry)).toBe(false)
            liveGeometry.add(o.geometry)
          })
          for (const m of g.userData.ownedMaterials) {
            expect(m).not.toBe(shared)
            expect(liveMaterials.has(m)).toBe(false)
            liveMaterials.add(m)
          }
        }
        release(a)
        b.userData.anim(1, .016, { night: 1 })
        b.traverse(o => { if (o.geometry) expect(disposed.has(o.geometry)).toBe(false) })
        release(b)
      }
      for (const kind of HOUSE_KINDS) release(buildGhost(kind, { material: line }))
      expect(geometries.size).toBeGreaterThan(liveGeometry.size)
      for (const g of geometries) expect(disposed.get(g)).toBe(1)
      for (const m of materials) expect(disposed.get(m)).toBe(1)
      expect(disposed.has(shared)).toBe(false)
      expect(disposed.has(line)).toBe(false)
    } finally { spies.forEach(s => s.mockRestore()); line.dispose() }
  })
  it('拒絕未登記種類、無效階段和超出規格的 base', () => {
    expect(() => buildHouse('other', 5)).toThrow(RangeError)
    for (const stage of [-1, 6, 1.5, NaN]) expect(() => buildHouse('machiya', stage)).toThrow(RangeError)
    for (const base of [0, 1.3, 1.9, Infinity, NaN]) expect(() => buildHouse('machiya', 5, { base })).toThrow(RangeError)
    expect(() => buildGhost('machiya')).toThrow(TypeError)
  })
})
