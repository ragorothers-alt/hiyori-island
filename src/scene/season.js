import { parseDate } from '../store.js'

// 四季色票：清透路線，飽和度刻意壓低
export const SEASONS = {
  spring: {
    name: '春', jp: 'はる',
    grass: '#bde5b6', rim: '#a9db9f', top: '#c5e6b4', tuft: ['#9fd38f', '#d6efb4'],
    canopy: ['#f9c9d6', '#f5b5c8', '#fbd8e2', '#f7bfd0', '#fde6ec'], glow: '#ffd6e2', fallen: '#f8c3d1',
    particle: { kind: 'petal', colors: ['#f9c3d2', '#fbd5df', '#f6b3c6'], count: 180, fall: 1, spin: 1, size: 1 },
    flowers: true, clip: '#f7b3c6', water: '#bfe9f7',
  },
  summer: {
    name: '夏', jp: 'なつ',
    grass: '#a9dc9f', rim: '#93d08a', top: '#b4e3a6', tuft: ['#7fc47a', '#b9e6a0'],
    canopy: ['#9fd69a', '#8acb8a', '#b3e2a5', '#a2d79a', '#c2eab2'], glow: '#d9f7c8', fallen: '#a9d99c',
    particle: { kind: 'leaf', colors: ['#a6dc9a', '#c8eeb0', '#8fd08c'], count: 45, fall: 0.8, spin: 1, size: 1.1 },
    flowers: true, clip: '#9ec2f0', water: '#aee6f7',
  },
  autumn: {
    name: '秋', jp: 'あき',
    grass: '#d3e1a5', rim: '#c4d68f', top: '#dbe5ad', tuft: ['#c6d687', '#ecd9a0'],
    canopy: ['#f4a483', '#ef9077', '#f6c784', '#ec8a7c', '#f8d596'], glow: '#ffd2b8', fallen: '#f1a27f',
    particle: { kind: 'maple', colors: ['#f29a76', '#f5bd78', '#e9806f', '#f7d08a'], count: 130, fall: 1.15, spin: 1.2, size: 1.15 },
    flowers: true, clip: '#f2a27e', water: '#c3e6f2',
  },
  winter: {
    name: '冬', jp: 'ふゆ',
    grass: '#eef3f7', rim: '#dce6ee', top: '#f3f6fa', tuft: ['#e8eff4', '#cfe0cf'],
    canopy: ['#f5f8fc', '#e9f0f8', '#ffffff', '#e2eaf4', '#f0f4fa'], glow: '#ffffff', fallen: '#ffffff',
    particle: { kind: 'snow', colors: ['#ffffff', '#f2f7ff', '#e8f1ff'], count: 260, fall: 0.5, spin: 0.25, size: 0.7 },
    flowers: false, clip: '#dfe9f7', water: '#e3f3fa', scarf: '#ef8e93',
  },
}

export function seasonOf(date) {
  const m = parseDate(date).getMonth() + 1
  if (m >= 3 && m <= 5) return 'spring'
  if (m >= 6 && m <= 8) return 'summer'
  if (m >= 9 && m <= 11) return 'autumn'
  return 'winter'
}
