import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Tripo 生成、在 Blender 綁好骨架的貓娘（GLB）→ 和程序化模型一樣的 userData 介面。
// 骨架只取每根骨頭的位置，重建成沒有旋轉的關節，character.js 才能照舊直接轉 rotation.x／z。
// 表情貼片、季節髮飾和圍巾沿用程序化模型（base）的那一份，搬到新模型上。

const PARENT = {
  hips: null, torso: 'hips', head: 'torso', earL: 'head', earR: 'head', armL: 'torso', armR: 'torso',
  legL: 'hips', legR: 'hips', tail0: 'hips', tail1: 'tail0', tail2: 'tail1', tail3: 'tail2',
}
const ANCHOR_JOINT = { headTop: 'head', forehead: 'head', face: 'head', hairR: 'head', neck: 'torso', handR: 'armR', handL: 'armL' }

const v3 = (a) => new THREE.Vector3().fromArray(a)

export async function loadRig(url) {
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  return gltf.scene
}

// 從正前方（+z）往後打的射線碰到頭部表面的 z；只看權重主要在 head 的三角形
function surface(tris) {
  return (x, y) => {
    let best = -Infinity
    for (let i = 0; i < tris.length; i += 9) {
      const ax = tris[i], ay = tris[i + 1], bx = tris[i + 3], by = tris[i + 4], cx = tris[i + 6], cy = tris[i + 7]
      if ((x < ax && x < bx && x < cx) || (x > ax && x > bx && x > cx) || (y < ay && y < by && y < cy) || (y > ay && y > by && y > cy)) continue
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(d) < 1e-12) continue
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d
      const w = 1 - u - v
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue
      const z = u * tris[i + 2] + v * tris[i + 5] + w * tris[i + 8]
      if (z > best) best = z
    }
    return best
  }
}

// fit：每位角色的對位設定（mochiRig.js／fujiRig.js），座標都是站姿的模型空間
export function buildRigged(template, base, fit) {
  const skinned = []
  template.traverse((o) => o.isSkinnedMesh && skinned.push(o))
  if (!skinned.length) throw new Error('rig: 找不到 SkinnedMesh')
  const source = new Map(skinned[0].skeleton.bones.map((b) => [b.name, b]))

  const group = new THREE.Group()
  group.name = 'cat-rig'
  const at = {}
  const bones = {}
  for (const [name, parent] of Object.entries(PARENT)) {
    const b = source.get(name)
    if (!b) throw new Error(`rig: 缺少骨頭 ${name}`)
    at[name] = b.getWorldPosition(new THREE.Vector3())
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.copy(at[name])
    if (parent) bone.position.sub(at[parent])
    ;(parent ? bones[parent] : group).add(bone)
    bones[name] = bone
  }
  const list = Object.values(bones)
  const index = new Map(list.map((b, i) => [b.name, i]))
  const headIndex = index.get('head')
  group.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(list)

  const ownedMaterials = [...(base.userData.ownedMaterials ?? [])]
  const headTris = []
  const v = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()
  for (const s of skinned) {
    const geo = s.geometry.clone()
    const pos = geo.attributes.position
    const nor = geo.attributes.normal
    const si = geo.attributes.skinIndex
    const sw = geo.attributes.skinWeight
    // 頂點換成站姿的模型空間（Blender 匯出時骨架與網格都已套用變形，通常只是原樣）
    normalMatrix.getNormalMatrix(s.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      s.applyBoneTransform(i, v).applyMatrix4(s.matrixWorld)
      pos.setXYZ(i, v.x, v.y, v.z)
      if (nor) {
        v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
        nor.setXYZ(i, v.x, v.y, v.z)
      }
    }
    // 骨頭編號改成新骨架的順序；不認得的骨頭併到 hips
    const remap = s.skeleton.bones.map((b) => index.get(b.name) ?? 0)
    const ids = new Uint16Array(si.count * 4)
    for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) ids[i * 4 + k] = remap[si.getComponent(i, k)] ?? 0
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(ids, 4))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()

    // 臉部投影用：三個頂點的 head 權重都過半、朝前的三角形
    const headWeight = (i) => {
      let w = 0
      for (let k = 0; k < 4; k++) if (ids[i * 4 + k] === headIndex) w += sw.getComponent(i, k)
      return w
    }
    const idx = geo.index
    const tri = idx ? (t, k) => idx.getX(t * 3 + k) : (t, k) => t * 3 + k
    const count = (idx ? idx.count : pos.count) / 3
    for (let t = 0; t < count; t++) {
      const a = tri(t, 0), b = tri(t, 1), c = tri(t, 2)
      if (headWeight(a) < 0.5 || headWeight(b) < 0.5 || headWeight(c) < 0.5) continue
      if (pos.getZ(a) < 0 && pos.getZ(b) < 0 && pos.getZ(c) < 0) continue
      for (const p of [a, b, c]) headTris.push(pos.getX(p), pos.getY(p), pos.getZ(p))
    }

    const material = s.material.clone()
    // 貼圖材質的自發光強度（character.js 的 _glow 會讀）
    material.userData.glow = fit.glow ?? 0.24
    ownedMaterials.push(material)
    const mesh = new THREE.SkinnedMesh(geo, material)
    mesh.name = s.name || 'cat-body'
    mesh.castShadow = true
    mesh.frustumCulled = false
    // 蒙皮網格逐頂點拾取太貴，交給下面的隱形碰撞體
    mesh.raycast = () => {}
    group.add(mesh)
    mesh.bind(skeleton)
  }

  // 拾取用的隱形碰撞體：頭一顆、身體一顆
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false })
  ownedMaterials.push(hitMaterial)
  for (const [joint, [x, y, z, rx, ry, rz]] of Object.entries(fit.hit ?? { head: [0, 0.32, 0.02, 0.4, 0.38, 0.36], hips: [0, 0.02, 0, 0.26, 0.32, 0.24] })) {
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), hitMaterial)
    hit.name = `hit-${joint}`
    hit.position.set(x, y, z)
    hit.scale.set(rx, ry, rz)
    bones[joint].add(hit)
  }

  // 程序化模型的零件搬過來：先記住原本的模型空間位置
  base.updateMatrixWorld(true)
  const keep = new Set()
  const move = (obj, joint, { position, rotation, scale } = {}) => {
    keep.add(obj)
    obj.traverse((o) => keep.add(o))
    bones[joint].add(obj)
    if (position) obj.position.copy(v3(position).sub(at[joint]))
    if (rotation) obj.rotation.set(...rotation)
    if (scale !== undefined) Array.isArray(scale) ? obj.scale.set(...scale) : obj.scale.setScalar(scale)
  }

  // 表情貼片：平移縮放到新臉上，再沿 z 投影到頭部表面
  const face = fit.face
  const frontZ = surface(headTris)
  for (const name of face.meshes) {
    const m = base.getObjectByName(name)
    if (!m) throw new Error(`rig: base 沒有 ${name}`)
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld)
    const pos = geo.attributes.position
    const zs = []
    for (let i = 0; i < pos.count; i++) {
      const x = face.to[0] + (pos.getX(i) - face.from[0]) * face.scale
      const y = face.to[1] + (pos.getY(i) - face.from[1]) * face.scale
      const z = frontZ(x, y)
      zs.push(z)
      pos.setXYZ(i, x, y, z + (face.lift ?? 0.003))
    }
    // 打不到表面的頂點（貼片超出臉的範圍）往後藏
    const hitZ = zs.filter(Number.isFinite)
    const fallback = hitZ.length ? Math.min(...hitZ) - 0.05 : at.head.z
    for (let i = 0; i < pos.count; i++) if (!Number.isFinite(zs[i])) pos.setZ(i, fallback)
    geo.translate(-at.head.x, -at.head.y, -at.head.z)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    m.geometry.dispose()
    m.geometry = geo
    m.position.set(0, 0, 0)
    m.rotation.set(0, 0, 0)
    m.scale.set(1, 1, 1)
    move(m, 'head')
  }
  const clip = base.getObjectByName(fit.clip.node)
  if (clip) move(clip, 'head', fit.clip)
  if (base.userData.scarf) move(base.userData.scarf, 'torso', fit.scarf)

  // 掛點：衣裝與頭頂泡泡用，可帶旋轉與縮放（例如頭比較大，帽子跟著放大）
  const anchors = {}
  for (const [name, joint] of Object.entries(ANCHOR_JOINT)) {
    const a = new THREE.Object3D()
    a.name = `anchor-${name}`
    move(a, joint, fit.anchors[name])
    anchors[name] = a
  }

  // 沒搬走的程序化網格用不到了，釋放幾何（材質與貼圖可能還被表情切換用到，留著）
  base.traverse((o) => o.isMesh && !keep.has(o) && o.geometry.dispose())

  group.userData = {
    ...base.userData,
    rigged: true,
    lift: fit.lift,
    joints: {
      hips: bones.hips, torso: bones.torso, head: bones.head, earL: bones.earL, earR: bones.earR,
      armL: bones.armL, armR: bones.armR, legL: bones.legL, legR: bones.legR,
      tail: [bones.tail0, bones.tail1, bones.tail2, bones.tail3],
    },
    anchors,
    ownedMaterials,
  }
  return group
}
