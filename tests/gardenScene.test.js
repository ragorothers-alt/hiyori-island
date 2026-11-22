import * as THREE from 'three'
import { expect, it } from 'vitest'
import { Garden } from '../src/scene/garden.js'
import { updateTweens } from '../src/scene/util.js'

it('勾選一件任務時，只更新那盆花；隔天還是會更新逾期的花', () => {
  const garden = new Garden({ scene: new THREE.Scene(), addPickable() {}, add() {} }, { night: 0 })
  const date = '2026-11-20'
  const tasks = [{ id: 'a', date, priority: 1 }, { id: 'b', date, priority: 1 }]
  garden.sync(tasks, date, date)
  updateTweens(1)
  const a = garden.plants.get('a')
  const b = garden.plants.get('b')
  const oldColor = b.color

  tasks[0].done = true
  garden.sync(tasks, date, date)
  expect(garden.plants.get('a')).toBe(a)
  expect(a.look).toBeTruthy()
  expect(b.color).toBe(oldColor)

  garden.sync(tasks, date, '2026-11-21')
  updateTweens(1)
  expect(b.wilt).toBeGreaterThan(0)
})
