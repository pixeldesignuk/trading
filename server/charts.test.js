import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { MEDIA_DIR } from './config.js'
import { chartMediaPath } from './charts.js'

test('chartMediaPath returns correct rel and dest', () => {
  const result = chartMediaPath('hub', '/x/y/abc.png')
  assert.deepEqual(result, {
    rel: 'media/hub/abc.png',
    dest: path.join(MEDIA_DIR, 'hub', 'abc.png'),
  })
})

test('chartMediaPath works with bare filename', () => {
  const result = chartMediaPath('moneytaur', 'chart.jpg')
  assert.deepEqual(result, {
    rel: 'media/moneytaur/chart.jpg',
    dest: path.join(MEDIA_DIR, 'moneytaur', 'chart.jpg'),
  })
})
