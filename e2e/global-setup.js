// 端對端測試開始前建兩個版本：
//   a：跟正式部署一樣的建置（「使用者手上的舊版」）
//   b：檔名全部多一段 -b 的建置（「之後部署上去的新版」，見 vite.config.js 的 HIYORI_BUILD_TAG）
import { execFileSync } from 'node:child_process'
import { OUT } from './builds.js'

export default function globalSetup() {
  for (const tag of ['a', 'b']) {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', OUT[tag], '--emptyOutDir', '--logLevel', 'warn'], {
      stdio: 'inherit',
      env: { ...process.env, HIYORI_BUILD_TAG: tag === 'b' ? 'b' : '' },
    })
  }
}
