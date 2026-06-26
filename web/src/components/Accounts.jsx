import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

// Accounts admin — households → owners → accounts. Add owners and accounts of any
// provider; credentials are sent once and stored encrypted server-side (never read
// back). Adding an account runs a sync, so a bad key surfaces immediately.

const REL = {
  self: { label: 'You', c: '#34d399' },
  child: { label: 'Child', c: '#a78bfa' },
  family: { label: 'Family', c: '#fbbf24' },
}
const ACCOUNT_TYPES = ['', 'isa', 'jisa', 'gia', 'crypto', 'sipp']
const fmtGBP = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }))
const ago = (ts) => {
  if (!ts) return 'never'
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export default function Accounts() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [addAccount, setAddAccount] = useState(false)
  const [addOwner, setAddOwner] = useState(false)

  const load = () => api.accounts().then(setData).catch(() => setData({ households: [], owners: [], accounts: [], providers: [] }))
  useEffect(() => { load() }, [])

  const syncNow = async () => { setBusy(true); try { await api.syncBrokers(); await load() } finally { setBusy(false) } }
  const remove = async (id) => { setBusy(true); try { await api.removeAccount(id); await load() } finally { setBusy(false) } }

  const byOwner = useMemo(() => {
    const m = {}
    for (const a of data?.accounts || []) (m[a.owner_id] ||= []).push(a)
    return m
  }, [data])

  if (!data) return <div className="px-3 py-10 text-center font-mono text-sm text-zinc-600">Loading…</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Accounts &amp; owners</span>
        <div className="flex gap-1.5">
          <button onClick={syncNow} disabled={busy}
            className="rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-400 hover:bg-white/5 disabled:opacity-40">⟳ Sync now</button>
          <button onClick={() => setAddOwner(true)}
            className="rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-400 hover:bg-white/5">+ Owner</button>
          <button onClick={() => setAddAccount(true)}
            className="rounded-md border border-emerald-700/50 bg-emerald-600/10 px-2.5 py-1 font-mono text-[10px] text-emerald-300 hover:bg-emerald-600/20">+ Account</button>
        </div>
      </div>

      <div className="space-y-3">
        {data.owners.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-8 text-center font-mono text-[11px] text-zinc-600">
            No owners yet — add yourself, then connect an account.
          </div>
        )}
        {data.owners.map((o) => {
          const rel = REL[o.relationship] || REL.self
          const accts = byOwner[o.id] || []
          return (
            <div key={o.id} className="overflow-hidden rounded-xl border border-zinc-900 bg-black/20">
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: `${o.color || rel.c}12` }}>
                <span className="h-2 w-2 rounded-full" style={{ background: o.color || rel.c }} />
                <span className="font-mono text-[12px] font-semibold text-zinc-100">{o.name}</span>
                <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-zinc-400">{rel.label}</span>
                {o.role === 'managed' && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-400">managed</span>}
                <span className="ml-auto font-mono text-[10px] text-zinc-600">{accts.length} account{accts.length === 1 ? '' : 's'}</span>
              </div>
              {accts.length === 0 ? (
                <div className="px-4 py-2.5 font-mono text-[10px] text-zinc-700">No accounts — add one with the provider's API key.</div>
              ) : accts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-t border-zinc-900/70 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <span className="text-[12px] font-semibold text-zinc-100">{a.label}</span>
                      <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-zinc-400">{a.provider}</span>
                      {a.account_type && <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-zinc-500">{a.account_type}</span>}
                      {!a.has_creds && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-400">no creds</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-zinc-600">
                      {a.error
                        ? <span className="text-red-400">⚠ {a.error.slice(0, 80)}</span>
                        : <>synced {ago(a.synced_at)} · {fmtGBP(a.total_value)}</>}
                    </div>
                  </div>
                  <button onClick={() => remove(a.id)} disabled={busy}
                    className="shrink-0 font-mono text-[10px] text-zinc-600 hover:text-red-400 disabled:opacity-40">remove</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {addOwner && <AddOwnerDialog households={data.households} onClose={() => setAddOwner(false)} onSaved={() => { setAddOwner(false); load() }} />}
      {addAccount && <AddAccountDialog data={data} onClose={() => setAddAccount(false)} onSaved={() => { setAddAccount(false); load() }} />}
    </div>
  )
}

// ---- add owner ----------------------------------------------------------
function AddOwnerDialog({ households, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [relationship, setRel] = useState('self')
  const [household_id, setHousehold] = useState(households[0]?.id || 'my-family')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const role = relationship === 'family' ? 'managed' : 'owner'
      await api.addOwner({ name, relationship, role, household_id })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  return (
    <Dialog title="Add owner" onClose={onClose}>
      <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Aisha" /></Field>
      <Field label="Relationship">
        <select value={relationship} onChange={(e) => setRel(e.target.value)} className={inputCls}>
          <option value="self">You</option>
          <option value="child">Child</option>
          <option value="family">Friend / family (managed)</option>
        </select>
      </Field>
      <Field label="Household">
        <select value={household_id} onChange={(e) => setHousehold(e.target.value)} className={inputCls}>
          {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </Field>
      {err && <div className="mb-2 font-mono text-[10px] text-red-400">{err}</div>}
      <SaveRow onClose={onClose} onSave={save} saving={saving} disabled={!name} />
    </Dialog>
  )
}

// ---- add account --------------------------------------------------------
function AddAccountDialog({ data, onClose, onSaved }) {
  const providers = data.providers || []
  const [owner_id, setOwner] = useState(data.owners[0]?.id || '')
  const [provider, setProvider] = useState(providers[0]?.key || '')
  const [label, setLabel] = useState('')
  const [account_type, setType] = useState('')
  const [creds, setCreds] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  // SnapTrade: brokerages are linked once in SnapTrade, then imported here.
  const [linked, setLinked] = useState(null)
  const [snapId, setSnapId] = useState('')

  const pdef = providers.find((p) => p.key === provider)
  const fields = pdef?.credentialFields || []
  const isConnect = !!pdef?.connect

  // When SnapTrade is picked, fetch the already-linked brokerage accounts.
  useEffect(() => {
    if (!isConnect) { setLinked(null); return }
    setLinked('loading'); setErr(null)
    api.snaptradeAccounts()
      .then((rows) => { setLinked(Array.isArray(rows) ? rows : []); if (rows?.error) setErr(rows.error) })
      .catch((e) => { setLinked([]); setErr(e.message) })
  }, [isConnect, provider])

  const pickSnap = (id) => {
    setSnapId(id)
    const a = (linked || []).find((x) => x.id === id)
    if (a) { setLabel(`${a.institution} ${a.name}`.trim()); if (/junior/i.test(a.name)) setType('jisa'); else if (/isa/i.test(a.name)) setType('isa') }
  }

  const linkNew = async () => {
    setSaving(true); setErr(null)
    try {
      const res = await api.snaptradeConnect()
      if (res.error) { setErr(res.error); return }
      if (res.portalUrl) window.open(res.portalUrl, '_blank', 'noopener')
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      if (isConnect) {
        const res = await api.importSnapTrade({ owner_id, snaptrade_account_id: snapId, label, account_type: account_type || null })
        if (res.error) { setErr(res.error); return }
        onSaved()
        return
      }
      const res = await api.addAccount({ owner_id, provider, account_type: account_type || null, label, credentials: creds })
      if (res.error) { setErr(res.error); return }
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <Dialog title="Add account" onClose={onClose}>
      <Field label="Owner">
        <select value={owner_id} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
          {data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <Field label="Provider">
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setCreds({}) }} className={inputCls}>
          {providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </Field>
      {isConnect ? (
        <>
          <Field label="Linked SnapTrade account">
            {linked === 'loading' ? (
              <div className="font-mono text-[10px] text-zinc-600">Loading linked accounts…</div>
            ) : (linked || []).length === 0 ? (
              <div className="font-mono text-[10px] text-zinc-600">No linked brokerages yet.</div>
            ) : (
              <select value={snapId} onChange={(e) => pickSnap(e.target.value)} className={inputCls}>
                <option value="">— pick an account —</option>
                {linked.map((a) => (
                  <option key={a.id} value={a.id}>{a.institution} · {a.name} · {fmtGBP(a.total)}</option>
                ))}
              </select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="e.g. AJ Bell Junior ISA" /></Field>
            <Field label="Type">
              <select value={account_type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t ? t.toUpperCase() : '—'}</option>)}
              </select>
            </Field>
          </div>
          <p className="mb-2 font-mono text-[9px] leading-relaxed text-zinc-600">
            Your brokerages are linked once inside SnapTrade. Pick one to import it here — no re-login. <button type="button" onClick={linkNew} className="text-zinc-400 underline hover:text-zinc-200">Link a new brokerage →</button>
          </p>
          {err && <div className="mb-2 font-mono text-[10px] text-red-400">⚠ {err}</div>}
          <SaveRow onClose={onClose} onSave={save} saving={saving} saveLabel="Import account" savingLabel="Importing…" disabled={!owner_id || !snapId || !label} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="e.g. Spot crypto" /></Field>
            <Field label="Type">
              <select value={account_type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t ? t.toUpperCase() : '—'}</option>)}
              </select>
            </Field>
          </div>
          {fields.map((f) => (
            <Field key={f.name} label={f.label + (f.optional ? ' (optional)' : '')}>
              <input type={f.secret ? 'password' : 'text'} autoComplete="off"
                value={creds[f.name] || ''} placeholder={f.placeholder || ''}
                onChange={(e) => setCreds((c) => ({ ...c, [f.name]: e.target.value }))} className={inputCls} />
            </Field>
          ))}
          <p className="mb-2 font-mono text-[9px] leading-relaxed text-zinc-600">
            Use a <span className="text-zinc-400">read-only</span> API key. Credentials are encrypted on the server and never shown again. Saving runs a sync to validate them.
          </p>
          {err && <div className="mb-2 font-mono text-[10px] text-red-400">⚠ {err}</div>}
          <SaveRow onClose={onClose} onSave={save} saving={saving} saveLabel="Save" savingLabel="Saving…" disabled={!owner_id || !provider || !label} />
        </>
      )}
    </Dialog>
  )
}

// ---- small shared bits --------------------------------------------------
const inputCls = 'w-full rounded-md border border-zinc-800 bg-[#0b0d10] px-2.5 py-1.5 font-mono text-[12px] text-zinc-100 outline-none focus:border-zinc-600'
const Field = ({ label, children }) => (
  <label className="mb-2 block">
    <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">{label}</div>
    {children}
  </label>
)
const Dialog = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true">
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
    <div className="relative z-10 my-10 w-full max-w-sm rounded-xl border border-zinc-900 bg-[#0b0d10] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-400">{title}</span>
        <button onClick={onClose} className="font-mono text-[11px] text-zinc-500 hover:text-zinc-200">✕</button>
      </div>
      {children}
    </div>
  </div>
)
const SaveRow = ({ onClose, onSave, saving, disabled, saveLabel = 'Save', savingLabel = 'Saving…' }) => (
  <div className="mt-3 flex items-center gap-3">
    <button onClick={onSave} disabled={saving || disabled}
      className="rounded-md border border-emerald-700/50 bg-emerald-600/10 px-3 py-1.5 font-mono text-[11px] text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-40">
      {saving ? savingLabel : saveLabel}
    </button>
    <button onClick={onClose} className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400">cancel</button>
  </div>
)
