import * as THREE from 'three'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

// 最後一道後製，取代 OutputPass：
// 1. 太陽光暈與光芒（線性 HDR，色調映射之前加；太陽在畫面外時從那一側漏光進來）
// 2. 曝光 → NeutralToneMapping → sRGB
// 3. 調色：lift/gamma/gain 分離色調（陰影偏藍、亮部偏暖）、輕微提高飽和
// 4. 暗角
// 5. 抖色，藍天漸層不會出現色階
export class FinalPass extends Pass {
  constructor() {
    super()
    this.uniforms = {
      tDiffuse: { value: null },
      toneMappingExposure: { value: 1 },
      uAspect: { value: 1 },
      uSun: { value: new THREE.Vector2(0.5, 1.4) },
      uSunColor: { value: new THREE.Color('#fff1d6') },
      uGlare: { value: 0 },
      uLift: { value: new THREE.Vector3() },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 },
      uVignette: { value: 0 },
      uSeed: { value: 0 },
    }
    this.material = new THREE.RawShaderMaterial({
      name: 'HiyoriFinal',
      uniforms: this.uniforms,
      defines: { NEUTRAL_TONE_MAPPING: '', SRGB_TRANSFER: '' },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        attribute vec3 position;
        attribute vec2 uv;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uAspect, uGlare, uSat, uVignette, uSeed;
        uniform vec2 uSun;
        uniform vec3 uSunColor, uLift, uGamma, uGain;
        varying vec2 vUv;
        #include <tonemapping_pars_fragment>
        #include <colorspace_pars_fragment>

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec3 col = texture2D(tDiffuse, vUv).rgb;

          if (uGlare > 0.001) {
            vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
            float r = length(d);
            float ang = atan(d.y, d.x);
            // 大範圍的暖光 + 太陽附近的亮核 + 細細的放射光芒
            float halo = exp(-r * 1.6) * 0.45 + exp(-r * 6.0) * 0.7 + exp(-r * 24.0) * 1.2;
            float rays = pow(0.5 + 0.5 * sin(ang * 11.0 + sin(ang * 3.0) * 2.0), 8.0)
                       + pow(0.5 + 0.5 * sin(ang * 7.0 - 1.3), 12.0) * 0.6;
            rays *= exp(-r * 2.2) * 0.32;
            col += uSunColor * (halo + rays) * uGlare;
          }

          #ifdef NEUTRAL_TONE_MAPPING
            col = NeutralToneMapping(col);
          #endif
          #ifdef SRGB_TRANSFER
            col = sRGBTransferOETF(vec4(col, 1.0)).rgb;
          #endif

          col = clamp(col, 0.0, 1.0);
          col = pow(col * uGain + uLift * (1.0 - col), 1.0 / uGamma);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat);

          vec2 q = (vUv - 0.5) * vec2(uAspect * 0.8, 1.0);
          col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));

          col += (hash(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
    this._quad = new FullScreenQuad(this.material)
  }

  // look：{ exposure, glare, sunColor, lift, gamma, gain, sat, vignette }（向量都是 [r, g, b]）
  apply(look) {
    const u = this.uniforms
    u.toneMappingExposure.value = look.exposure
    u.uGlare.value = look.glare
    u.uSunColor.value.copy(look.sunColor)
    u.uLift.value.fromArray(look.lift)
    u.uGamma.value.fromArray(look.gamma)
    u.uGain.value.fromArray(look.gain)
    u.uSat.value = look.sat
    u.uVignette.value = look.vignette
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.uSeed.value = (u.uSeed.value + 17.3) % 1000
    const size = renderer.getSize(_size)
    u.uAspect.value = size.x / Math.max(1, size.y)
    if (this.renderToScreen) renderer.setRenderTarget(null)
    else {
      renderer.setRenderTarget(writeBuffer)
      if (this.clear) renderer.clear()
    }
    this._quad.render(renderer)
  }

  dispose() {
    this.material.dispose()
    this._quad.dispose()
  }
}

const _size = new THREE.Vector2()
