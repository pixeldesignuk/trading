import fs from 'node:fs'
import path from 'node:path'
import { MEDIA_DIR } from './config.js'
import { appendEvent } from './events.js'

/**
 * Pure helper — derive the app-relative path and absolute destination path
 * for a chart image given a source name and an absolute (or relative) src filename.
 *
 * @param {string} source  e.g. 'hub', 'moneytaur', 'lives'
 * @param {string} srcFile absolute or relative path; only the basename is used
 * @returns {{ rel: string, dest: string }}
 */
export function chartMediaPath(source, srcFile) {
  const base = path.basename(srcFile)
  const rel = `media/${source}/${base}`
  const dest = path.join(MEDIA_DIR, source, base)
  return { rel, dest }
}

/**
 * Copy a chart image into the media directory.
 * Creates the target sub-directory if needed.
 *
 * @param {string} srcAbsPath  Absolute path to the source image file
 * @param {string} source      e.g. 'hub'
 * @returns {Promise<string|null>}  rel path on success, null if src missing
 */
export async function copyChartImage(srcAbsPath, source) {
  if (!fs.existsSync(srcAbsPath)) return null
  const { rel, dest } = chartMediaPath(source, srcAbsPath)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await fs.promises.copyFile(srcAbsPath, dest)
  return rel
}

/**
 * Copy a chart image and append a chart event to the events table.
 *
 * @param {{
 *   symbol: string,
 *   source: string,
 *   srcFile: string,
 *   occurred_at?: string|null,
 *   native_id?: string|null,
 *   caption?: string|null,
 *   levels?: Array|null
 * }} opts
 * @returns {Promise<void>}
 */
export async function addChartEvent({ symbol, source, srcFile, occurred_at = null, native_id = null, caption = null, levels = null }) {
  const rel = await copyChartImage(srcFile, source)
  await appendEvent({
    ticker: symbol,
    source,
    kind: 'chart',
    occurred_at,
    native_id,
    payload: {
      chart: rel,
      caption,
      levels,
    },
  })
}
