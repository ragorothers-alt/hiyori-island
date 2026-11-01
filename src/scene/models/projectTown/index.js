import { createHouse } from './house.js'
import * as THREE from 'three'

export const HOUSE_KINDS = ['machiya', 'shop', 'workshop', 'inn', 'teahouse', 'watchtower']
export const KINDS_BY_HEIGHT = {
  low: ['machiya', 'teahouse'],
  mid: ['machiya', 'shop', 'workshop', 'inn'],
  tall: ['watchtower'],
}

function validate(kind, base) {
  if (!HOUSE_KINDS.includes(kind)) throw new RangeError(`Unknown house kind: ${kind}`)
  if (!Number.isFinite(base) || base < 1.4 || base > 1.8) throw new RangeError('House base must be 1.4–1.8')
}

/** Ground-centred, +Z entrance. Geometry is private; dispose only ownedMaterials/Textures. */
export function buildHouse(kind, stage, { color = '#f2a3b8', base = 1.6 } = {}) {
  validate(kind, base)
  if (!Number.isInteger(stage) || stage < 0 || stage > 5) throw new RangeError('House stage must be 0–5')
  return createHouse(kind, stage, color, base)
}

/** Architectural outline; caller retains ownership of the supplied line material. */
export function buildGhost(kind, { base = 1.6, material } = {}) {
  validate(kind, base)
  if (!material?.isMaterial) throw new TypeError('buildGhost requires a line material')
  // Retain the finished silhouette, including balcony, ladder and furnishings.
  // Omit only the roof's repeated tile ribs to keep the outline legible.
  const source = createHouse(kind, 5, '#ffffff', base, true)
  const group = new THREE.Group()
  group.name = `project-house-ghost-${kind}`
  source.updateMatrixWorld(true)
  source.traverse((o) => {
    if (!o.isMesh) return
    const edges = new THREE.EdgesGeometry(o.geometry, 25)
    // EdgesGeometry retains its constructor input in r186. The baked line
    // positions are independent; do not keep the discarded solid model alive.
    edges.parameters.geometry = null
    edges.applyMatrix4(o.matrixWorld)
    group.add(new THREE.LineSegments(edges, material))
    o.geometry.dispose()
  })
  source.userData.ownedMaterials.forEach((m) => m.dispose())
  source.userData.ownedTextures.forEach((t) => t.dispose())
  return group
}
