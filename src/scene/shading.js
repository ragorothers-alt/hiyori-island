import * as THREE from 'three'

// 全場景的光影質感：直接改 three 內建的 shader 片段，所有 MeshStandard／Physical 材質（含縮圖用的離屏渲染）一起生效。
// 必須在任何材質第一次編譯前載入（world.js 最上面 import）。
// - 包裹式漫射：受光面到陰影面的過渡拉長，明暗交界柔和，像手繪的大塊光影
// - 天空色的邊緣光：輪廓被天光鑲一圈，顏色直接取半球光的天空色，跟著時段變（白天水藍、黃昏橘粉、夜晚藍紫）
// - 高度霧：比雲海頂面（CLOUD_TOP）低的東西漸漸融進霧色（＝雲海的顏色），浮島從雲海升起、雲鯨下潛、瀑布落進雲裡都靠它
const WRAP = 0.35
const RIM = 0.32
export const CLOUD_TOP = -13

const chunk = THREE.ShaderChunk
const direct = 'vec3 irradiance = dotNL * directLight.color;'
if (chunk.lights_physical_pars_fragment.includes(direct)) {
  chunk.lights_physical_pars_fragment = chunk.lights_physical_pars_fragment.replace(
    direct,
    `vec3 irradiance = saturate( ( dot( geometryNormal, directLight.direction ) + ${WRAP.toFixed(2)} ) / ${(1 + WRAP).toFixed(2)} ) * directLight.color;`,
  )
} else console.warn('[hiyori] shading: lights_physical_pars_fragment 改版了，包裹式漫射沒有套用')

// 世界座標的高度從 mvPosition 反推（Sprite 沒有 transformed，所以不用它）：world = Rᵀ · (mv - t)
chunk.fog_pars_vertex += '\n#ifdef USE_FOG\n\tvarying float vFogWorldY;\n#endif\n'
chunk.fog_vertex += /* glsl */ `
#ifdef USE_FOG
	vFogWorldY = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).y;
#endif
`
chunk.fog_pars_fragment += '\n#ifdef USE_FOG\n\tvarying float vFogWorldY;\n#endif\n'
const fogMix = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );'
if (chunk.fog_fragment.includes(fogMix)) {
  chunk.fog_fragment = chunk.fog_fragment.replace(
    fogMix,
    `fogFactor = max( fogFactor, smoothstep( ${(CLOUD_TOP + 0.6).toFixed(1)}, ${(CLOUD_TOP - 2.4).toFixed(1)}, vFogWorldY ) );\n\t${fogMix}`,
  )
} else console.warn('[hiyori] shading: fog_fragment 改版了，高度霧沒有套用')

chunk.lights_fragment_end += /* glsl */ `
#if NUM_HEMI_LIGHTS > 0
	{
		float hiyoriRim = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular += hemisphereLights[ 0 ].skyColor * ( hiyoriRim * hiyoriRim * hiyoriRim * ${RIM.toFixed(2)} );
	}
#endif
`
