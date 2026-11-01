// 專案町：每個專案在島上的小鎮蓋一棟房子。
// 總平面（町心廣場、街道、20 塊地、街燈和樹）由 Codex 規劃並驗證過，原始檔與示意圖在 art/town-plan/；
// 座標保留原本的精度（最窄處只差 0.01），不要四捨五入。
// 城鎮依努力長大：每完成一個里程碑 +1 點、每落成一個專案 +3 點，點數到了就升一級——多開幾塊地、街道往外鋪、多些街燈和樹
import PLAN_DATA from './projectTown.plan.json'

// { plaza, growth: 各級累計地數, lots: [{ id, level, x, z, rot, size, height }]（陣列順序就是開放順序）,
//   streets: [{ id, level, width, kind, points }], props: [{ type, level, x, z, rot }], bridges: [{ point, level }] }
// rot：房子正面朝 (sin rot, cos rot)，直接當 rotation.y 用
export const PLAN = PLAN_DATA

// 各種小物的佔地半徑（角色繞開、擺設不能壓上去；和規劃驗證用的尺寸一致，模型不要做得比這大）
// 町門只算兩根柱子（中間要能走過去）；噴水池在廣場正中央，比規劃時的 0.48 大一點也不會碰到地
export const PROP_R = { lamp: 0.13, tree: 0.38, bench: 0.29, planter: 0.23, sign: 0.17, fountain: 0.6, gate: 0.11 }
export const GATE_HALF = 0.79

// 各級門檻（點數）
export const TOWN_POINTS = [0, 5, 15, 30, 50, 80]
export const MAX_TOWN_LEVEL = TOWN_POINTS.length

export const townPoints = (stats) => (stats.milestonesDone || 0) + (stats.projectsDone || 0) * 3
export const lotsAt = (level) => PLAN.growth[Math.min(Math.max(level, 1), MAX_TOWN_LEVEL) - 1]

// { level, points, lots：可用的地數, next：下一級的門檻（滿級是 null） }
export function townLevel(stats) {
  const points = townPoints(stats)
  let level = 1
  while (level < MAX_TOWN_LEVEL && points >= TOWN_POINTS[level]) level++
  return { level, points, lots: lotsAt(level), next: level < MAX_TOWN_LEVEL ? TOWN_POINTS[level] : null }
}

// 點 (x, z) 在不在地塊（依 rot 轉的正方形，四周再加 pad）裡
export function inLot(lot, x, z, pad = 0) {
  const dx = x - lot.x
  const dz = z - lot.z
  const c = Math.cos(lot.rot)
  const s = Math.sin(lot.rot)
  const h = lot.size / 2 + pad
  return Math.abs(dx * c - dz * s) <= h && Math.abs(dx * s + dz * c) <= h
}

function segDist(x, z, [ax, az], [bx, bz]) {
  const vx = bx - ax
  const vz = bz - az
  const len = vx * vx + vz * vz
  const t = len ? Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / len)) : 0
  return Math.hypot(x - ax - vx * t, z - az - vz * t)
}

// 點 (x, z) 在不在街道或廣場上（只算 level 以內開通的）
export function onStreet(x, z, pad = 0, level = MAX_TOWN_LEVEL) {
  const { plaza } = PLAN
  if (Math.hypot(x - plaza.x, z - plaza.z) <= plaza.r + pad) return true
  for (const s of PLAN.streets) {
    if (s.level > level) continue
    for (let i = 1; i < s.points.length; i++) if (segDist(x, z, s.points[i - 1], s.points[i]) <= s.width / 2 + pad) return true
  }
  return false
}

// 一件小物的佔地 [[x, z, r], ...]
export function propPrints(p) {
  const r = PROP_R[p.type] ?? 0.3
  if (p.type !== 'gate') return [[p.x, p.z, r]]
  const c = Math.cos(p.rot) * GATE_HALF
  const s = Math.sin(p.rot) * GATE_HALF
  return [[p.x + c, p.z - s, r], [p.x - c, p.z + s, r]]
}

// 點 (x, z) 有沒有碰到專案町：20 塊地、所有街道與廣場、所有小物，不管開放了沒（以後要長出來的地方先留著）
export function inTown(x, z, pad = 0) {
  if (PLAN.lots.some((l) => inLot(l, x, z, pad))) return true
  if (onStreet(x, z, pad)) return true
  return PLAN.props.some((p) => propPrints(p).some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + pad))
}
