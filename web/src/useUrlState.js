import { useState, useEffect, useCallback } from 'react'

// Minimal URL-query-param state — keeps filters/tabs in the URL (shareable,
// refresh-stable) without pulling in a router. Reads/writes `?key=value` and
// syncs on browser back/forward.
export function useUrlState(key, defaultValue) {
  const read = () => new URLSearchParams(window.location.search).get(key) || defaultValue
  const [value, setValue] = useState(read)

  useEffect(() => {
    const onPop = () => setValue(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = useCallback(
    (v) => {
      const params = new URLSearchParams(window.location.search)
      if (!v || v === defaultValue) params.delete(key)
      else params.set(key, v)
      const qs = params.toString()
      window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname)
      setValue(v || defaultValue)
    },
    [key, defaultValue],
  )

  return [value, set]
}
