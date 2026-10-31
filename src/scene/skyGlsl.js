// 天空相關 shader 共用的片段：穹頂、雲海、遠景卡片都用同一套天空漸層，彼此在遠方接得起來

// 依方向的高度 h（-1..1）取天空顏色。畫面裡的天空只有地平線上方一小段，漸層要很快轉深，畫面上緣才看得到飽和的藍
export const SKY_GLSL = /* glsl */ `
  uniform vec3 uTop, uMid, uBot;
  vec3 skyColor(float h) {
    return h > 0.0
      ? mix(uMid, uTop, pow(smoothstep(-0.01, 0.2, h), 0.6))
      : mix(uMid, uBot, smoothstep(0.0, -0.05, h));
  }
`

export const NOISE_GLSL = /* glsl */ `
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }
`
