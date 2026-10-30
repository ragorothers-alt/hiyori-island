import { buildFlorist } from './florist.js'
import { buildLibrary } from './library.js'
import { buildClockTower } from './clock.js'
import { buildBathhouse } from './bathhouse.js'
import { buildCafe } from './cafe.js'
import { buildPostOffice } from './post.js'
import { buildTanuki } from '../residents/tanuki.js'
import { buildOwl } from '../residents/owl.js'
import { buildSquirrel } from '../residents/squirrel.js'
import { buildCapybara } from '../residents/capybara.js'
import { buildRabbit } from '../residents/rabbit.js'
import { buildFox } from '../residents/fox.js'

// ひより町的建築與居民模型登記處
// 建築：build(stage 1..5) → Group，原點在地面、正面朝 +z；userData { front, top, anim(t, dt, { night, hour }), ownedMaterials, ownedTextures }
// 居民：build() → Group，userData { joints, headTop, anim(t, dt, { walk, wave, talk, night }), ownedMaterials, ownedTextures }
const BUILDINGS = { florist: buildFlorist, library: buildLibrary, clock: buildClockTower, bathhouse: buildBathhouse, cafe: buildCafe, post: buildPostOffice }
const RESIDENTS = { tanuki: buildTanuki, owl: buildOwl, squirrel: buildSquirrel, capybara: buildCapybara, rabbit: buildRabbit, fox: buildFox }

export const buildBuilding = (key, stage) => BUILDINGS[key](stage)
export const buildResident = (kind) => RESIDENTS[kind]()
