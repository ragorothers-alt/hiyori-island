// ふじ的 Tripo 模型對位設定（src/assets/cats/fuji.glb，見 rigged.js）。
// 座標都是站姿的模型空間：腳底 y=0、面向 +z、左手在 +x。
export default {
  // 貼圖材質的自發光強度
  glow: 0.32,
  // 歡呼、伸懶腰時手臂舉多高（弧度）：肩膀窄、站姿手臂朝外，舉太高手會穿進髮尾
  lift: { cheer: 1.4, stretch: 1.55 },
  // 拾取碰撞體：[關節局部 x, y, z, 半徑 x, y, z]
  hit: { head: [0, 0.30, 0.015, 0.39, 0.34, 0.31], hips: [0, 0.025, 0, 0.30, 0.32, 0.22] },
  // 表情貼片：程序化模型的臉部網格（眼睛、嘴巴、腮紅），以 from 為中心縮放後移到 to，再投影到頭部表面
  face: { meshes: ['eyes', 'mouth', 'blush'], from: [0, 0.89], to: [-0.022, 0.880], scale: 0.88, lift: 0.003 },
  // 季節櫻花髮飾（程序化模型的 'seasonal-sakura'）
  clip: { node: 'seasonal-sakura', position: [0.235, 1.103, 0.223], rotation: [0, 0.45, -0.10], scale: 0.88 },
  // 冬天圍巾
  scarf: { position: [-0.01, 0.674, 0.025], scale: [0.85, 0.90, 0.85] },
  // 衣裝與泡泡的掛點；可加 rotation: [x, y, z]、scale
  anchors: {
    headTop: { position: [-0.018, 1.280, 0.005], scale: [0.95, 1, 1.12] },
    forehead: { position: [-0.022, 1.100, 0.326], scale: [0.90, 1, 0.88] },
    face: { position: [-0.022, 0.887, 0.316] },
    hairR: { position: [-0.315, 1.013, 0.170], scale: 0.92 },
    neck: { position: [-0.01, 0.695, 0] },
    handR: { position: [-0.373, 0.405, 0.090] },
    handL: { position: [0.373, 0.405, 0.090] },
  },
}
