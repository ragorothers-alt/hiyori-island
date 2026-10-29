import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildRigged } from '../src/scene/models/rigged.js'
import { buildCatMochi } from '../src/scene/models/catMochi.js'
import { buildCatFuji } from '../src/scene/models/catFuji.js'
import mochiFit from '../src/scene/models/mochiRig.js'
import fujiFit from '../src/scene/models/fujiRig.js'

const AT = {
  hips: [0, 0.3, 0], torso: [0, 0.48, 0], head: [0, 0.6, 0], earL: [0.24, 1.14, 0], earR: [-0.24, 1.14, 0],
  armL: [0.3, 0.52, 0], armR: [-0.3, 0.52, 0], legL: [0.08, 0.3, 0], legR: [-0.08, 0.3, 0],
  tail0: [0, 0.34, -0.14], tail1: [0.1, 0.38, -0.22], tail2: [0.2, 0.46, -0.26], tail3: [0.26, 0.56, -0.26],
}
const PARENT = { torso: 'hips', head: 'torso', earL: 'head', earR: 'head', armL: 'torso', armR: 'torso', legL: 'hips', legR: 'hips', tail0: 'hips', tail1: 'tail0', tail2: 'tail1', tail3: 'tail2' }

// 仿 Blender 匯出的 GLB：骨頭帶任意旋轉，頭是一顆蒙在 head 上的球、身體是蒙在 hips 上的方塊
function fakeTemplate() {
  const scene = new THREE.Group()
  const bones = {}
  for (const name of Object.keys(AT)) {
    const b = new THREE.Bone()
    b.name = name
    bones[name] = b
  }
  for (const [name, b] of Object.entries(bones)) {
    const parent = PARENT[name]
    const world = new THREE.Vector3(...AT[name])
    if (parent) {
      bones[parent].add(b)
      bones[parent].updateMatrixWorld(true)
      b.position.copy(bones[parent].worldToLocal(world))
    } else {
      scene.add(b)
      b.position.copy(world)
    }
    b.rotation.set(0.3, -0.2, 0.5)
    b.updateMatrixWorld(true)
  }
  const head = new THREE.SphereGeometry(0.33, 16, 12).translate(0, 0.9, 0)
  const body = new THREE.BoxGeometry(0.4, 0.5, 0.3).translate(0, 0.35, 0)
  const geo = mergeTwo(head, body)
  const order = Object.keys(AT)
  const n = geo.attributes.position.count
  const headCount = head.attributes.position.count
  const ids = new Uint16Array(n * 4)
  const ws = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    ids[i * 4] = order.indexOf(i < headCount ? 'head' : 'hips')
    ws[i * 4] = 1
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(ids, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(ws, 4))
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.DataTexture(new Uint8Array(4), 1, 1) }))
  mesh.name = 'cat-body'
  scene.add(mesh)
  scene.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(order.map((k) => bones[k])))
  scene.updateMatrixWorld(true)
  return scene
}

function mergeTwo(a, b) {
  const pos = [...a.attributes.position.array, ...b.attributes.position.array]
  const nor = [...a.attributes.normal.array, ...b.attributes.normal.array]
  const off = a.attributes.position.count
  const index = [...a.index.array, ...b.index.array].map((v, i) => (i >= a.index.count ? v + off : v))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(index)
  return g
}

describe('rigged：Tripo 模型組裝', () => {
  for (const [who, build, fit] of [['もち', buildCatMochi, mochiFit], ['ふじ', buildCatFuji, fujiFit]]) {
    it(`${who}：關節沒有旋轉、位置正確，介面和程序化模型相同`, () => {
      const g = buildRigged(fakeTemplate(), build(), fit)
      g.updateMatrixWorld(true)
      const { joints, anchors } = g.userData
      for (const [name, p] of Object.entries(AT)) {
        const j = name.startsWith('tail') ? joints.tail[+name.slice(4)] : joints[name]
        expect(j.rotation.x + j.rotation.y + j.rotation.z).toBe(0)
        expect(j.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...p))).toBeLessThan(1e-5)
      }
      for (const k of ['setFace', 'setBlush', 'setMouth', 'setClip', 'setClipVisible']) expect(typeof g.userData[k]).toBe('function')
      for (const k of ['headTop', 'forehead', 'face', 'hairR', 'neck', 'handR', 'handL']) expect(anchors[k].parent).toBeTruthy()
      expect(anchors.headTop.parent).toBe(joints.head)
      expect(anchors.handR.parent).toBe(joints.armR)
      expect(g.userData.scarf.parent).toBe(joints.torso)
      for (const name of fit.face.meshes) expect(g.getObjectByName(name).parent).toBe(joints.head)
      expect(() => ['open', 'happy', 'closed', 'half', 'shy'].forEach((f) => g.userData.setFace(f))).not.toThrow()
      g.userData.setClipVisible(false)
      expect(g.getObjectByName(fit.clip.node).visible).toBe(false)
    })
  }

  it('站姿頂點不變，轉頭時頭跟著動、身體不動', () => {
    const g = buildRigged(fakeTemplate(), buildCatMochi(), mochiFit)
    const mesh = g.children.find((o) => o.isSkinnedMesh)
    g.updateMatrixWorld(true)
    const top = mesh.geometry.attributes.position
    let headTop = 0
    for (let i = 1; i < top.count; i++) if (top.getY(i) > top.getY(headTop)) headTop = i
    const v = (i) => mesh.getVertexPosition(i, new THREE.Vector3())
    expect(v(headTop).y).toBeCloseTo(1.23, 2)
    const feet = top.count - 1
    const before = v(feet)
    g.userData.joints.head.rotation.x = 0.5
    g.updateMatrixWorld(true)
    expect(v(headTop).z).toBeGreaterThan(0.2)
    expect(v(feet).distanceTo(before)).toBeLessThan(1e-6)
  })

  it('表情貼片貼在頭部表面前方', () => {
    const g = buildRigged(fakeTemplate(), buildCatMochi(), mochiFit)
    g.updateMatrixWorld(true)
    const face = g.getObjectByName('face-markings')
    const pos = face.geometry.attributes.position
    const c = new THREE.Vector3()
    // 中央的頂點應該落在球面（半徑 0.33、中心 y=0.9）外一點點
    let best = Infinity
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(face.matrixWorld)
      const d = Math.abs(p.x) + Math.abs(p.y - 0.9)
      if (d < best) { best = d; c.copy(p) }
    }
    expect(c.z).toBeGreaterThan(0.33)
    expect(c.z).toBeLessThan(0.34)
  })
})
