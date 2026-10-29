// もち的 Tripo 模型對位設定（src/assets/cats/mochi.glb，見 rigged.js）。
// 座標都是站姿的模型空間：腳底 y=0、面向 +z、左手在 +x。
export default {
  // 貼圖材質的自發光強度
  glow: 0.36,
  // 歡呼、伸懶腰時手臂舉多高（弧度）：肩膀窄，舉太高手會穿進髮尾
  lift: { cheer: 1.65, stretch: 1.75 },
  // 拾取碰撞體：[關節局部 x, y, z, 半徑 x, y, z]
  hit: { head: [0, 0.31, -0.01, 0.37, 0.34, 0.33], hips: [0, 0.04, 0.01, 0.31, 0.3, 0.25] },
  // 表情貼片：程序化模型的臉部網格，以 from 為中心縮放後移到 to，再投影到頭部表面
  face: { meshes: ['face-markings'], from: [0, 0.86], to: [0, 0.882], scale: 0.74, lift: 0.0035 },
  // 季節櫻花髮飾（程序化模型的 'sakura'）
  clip: { node: 'sakura', position: [0.307, 1.128, 0.129], rotation: [0, 0.72, -0.08], scale: 0.9 },
  // 冬天圍巾
  scarf: { position: [0, 0.712, 0.025], scale: [1.05, 0.85, 1.05] },
  // 衣裝與泡泡的掛點；可加 rotation: [x, y, z]、scale
  anchors: {
    headTop: { position: [0, 1.272, -0.035], scale: [1.02, 1, 1.16] },
    forehead: { position: [0, 1.08, 0.245], scale: [0.87, 1, 0.8] },
    face: { position: [0, 0.905, 0.263] },
    hairR: { position: [-0.285, 0.945, -0.005], scale: 0.88 },
    neck: { position: [0, 0.712, 0.025], scale: 1.05 },
    handR: { position: [-0.334, 0.426, 0.038] },
    handL: { position: [0.334, 0.426, 0.038] },
  },
}
