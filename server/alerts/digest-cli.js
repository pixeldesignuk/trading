// Local digest run. Dry-run by default (prints the Telegram message instead of
// sending); pass --send to actually deliver.
//
//   node server/alerts/digest-cli.js            # dry-run
//   node server/alerts/digest-cli.js --send     # real Telegram
import { runDigest } from './digest.js'

const send = process.argv.includes('--send')
const sender = send
  ? undefined // use the real sendTelegram default
  : async (text) => { console.log('\n--- would send to Telegram ---\n' + text + '\n------------------------------'); return { ok: true, dryRun: true } }

runDigest({ sender })
  .then((r) => { console.log('\n' + JSON.stringify(r, null, 2)); process.exit(0) })
  .catch((e) => { console.error(e); process.exit(1) })
