import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export default function useTutorial({
  steps,
  activePage,
  onPageChange,
  onFinish,
  onDismiss
}) {
  const activePageRef = useRef(activePage)
  const [session, setSession] = useState({
    open: false,
    index: 0,
    mode: 'manual',
    originPage: activePage
  })

  useEffect(() => {
    activePageRef.current = activePage
  }, [activePage])

  const currentStep = useMemo(
    () => (session.open ? steps[session.index] || null : null),
    [session.open, session.index, steps]
  )

  useEffect(() => {
    if (!session.open || !currentStep?.page || currentStep.page === activePageRef.current) return
    onPageChange(currentStep.page)
  }, [session.open, currentStep, onPageChange])

  const start = useCallback((mode = 'manual') => {
    setSession({
      open: true,
      index: 0,
      mode,
      originPage: activePageRef.current
    })
  }, [])

  const previous = useCallback(() => {
    setSession(current => ({ ...current, index: Math.max(0, current.index - 1) }))
  }, [])

  const next = useCallback(() => {
    if (session.index >= steps.length - 1) {
      onFinish?.()
      setSession(current => ({ ...current, open: false }))
      return
    }
    setSession(current => ({ ...current, index: current.index + 1 }))
  }, [session.index, steps.length, onFinish])

  const pause = useCallback(() => {
    if (session.originPage && session.originPage !== activePageRef.current) {
      onPageChange(session.originPage)
    }
    setSession(current => ({ ...current, open: false }))
  }, [session.originPage, onPageChange])

  const dismiss = useCallback(() => {
    if (session.originPage && session.originPage !== activePageRef.current) {
      onPageChange(session.originPage)
    }
    setSession(current => ({ ...current, open: false }))
    onDismiss?.()
  }, [session.originPage, onDismiss, onPageChange])

  return {
    open: session.open,
    mode: session.mode,
    index: session.index,
    total: steps.length,
    step: currentStep,
    start,
    previous,
    next,
    pause,
    dismiss
  }
}
