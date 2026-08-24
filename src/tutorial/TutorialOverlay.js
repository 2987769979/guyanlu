import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

const TARGET_PADDING = 7
const CARD_GAP = 14
const VIEWPORT_PADDING = 16
const TARGET_RETRY_LIMIT = 30

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function paddedRect(rect) {
  if (!rect) return null
  const left = Math.max(0, rect.left - TARGET_PADDING)
  const top = Math.max(0, rect.top - TARGET_PADDING)
  const right = Math.min(window.innerWidth, rect.right + TARGET_PADDING)
  const bottom = Math.min(window.innerHeight, rect.bottom + TARGET_PADDING)
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }
}

function cardPosition(rect) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(430, viewportWidth - VIEWPORT_PADDING * 2)

  if (!rect) {
    return {
      width,
      left: (viewportWidth - width) / 2,
      top: Math.max(VIEWPORT_PADDING, viewportHeight * 0.22)
    }
  }

  const estimatedHeight = 250
  const belowSpace = viewportHeight - rect.bottom
  const aboveSpace = rect.top
  const placeBelow = belowSpace >= estimatedHeight + CARD_GAP || belowSpace >= aboveSpace
  const top = placeBelow
    ? Math.min(rect.bottom + CARD_GAP, viewportHeight - estimatedHeight - VIEWPORT_PADDING)
    : Math.max(VIEWPORT_PADDING, rect.top - estimatedHeight - CARD_GAP)
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    VIEWPORT_PADDING,
    viewportWidth - width - VIEWPORT_PADDING
  )

  return { width, left, top }
}

export default function TutorialOverlay({
  open,
  step,
  index,
  total,
  onPrevious,
  onNext,
  onPause,
  onDismiss
}) {
  const [rect, setRect] = useState(null)
  const [targetMissing, setTargetMissing] = useState(false)
  const nextButtonRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !step) return undefined

    let cancelled = false
    let retryTimer = null
    let frame = null
    let resizeObserver = null
    let targetElement = null
    let attempts = 0

    const updateRect = () => {
      if (cancelled) return
      if (!targetElement?.isConnected) {
        targetElement = document.querySelector(step.target)
      }
      if (!targetElement) {
        setRect(null)
        return
      }
      setRect(paddedRect(targetElement.getBoundingClientRect()))
    }

    const locateTarget = () => {
      if (cancelled) return
      targetElement = document.querySelector(step.target)
      if (!targetElement) {
        attempts += 1
        if (attempts >= TARGET_RETRY_LIMIT) {
          setTargetMissing(true)
          setRect(null)
          return
        }
        retryTimer = window.setTimeout(locateTarget, 50)
        return
      }

      setTargetMissing(false)
      targetElement.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
      frame = window.requestAnimationFrame(() => {
        updateRect()
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(updateRect)
          resizeObserver.observe(targetElement)
        }
      })
    }

    const handleViewportChange = () => updateRect()
    window.addEventListener('resize', handleViewportChange)
    document.addEventListener('scroll', handleViewportChange, true)
    locateTarget()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (frame) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', handleViewportChange)
      document.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open, step])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = event => {
      if (event.key === 'Escape') onPause()
      if (event.key === 'ArrowLeft' && index > 0) onPrevious()
      if (event.key === 'ArrowRight') onNext()
    }
    document.addEventListener('keydown', handleKeyDown)
    const focusTimer = window.setTimeout(() => nextButtonRef.current?.focus(), 80)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, index, onNext, onPause, onPrevious])

  const position = useMemo(() => {
    if (typeof window === 'undefined') return { width: 430, left: 16, top: 16 }
    return cardPosition(rect)
  }, [rect, step])

  if (!open || !step || typeof document === 'undefined') return null

  const progress = total > 0 ? ((index + 1) / total) * 100 : 0
  const lastStep = index === total - 1

  return createPortal(
    <Box className='tutorial-layer' role='dialog' aria-modal='true' aria-label={step.title}>
      {rect ? (
        <>
          <Box className='tutorial-dimmer' sx={{ left: 0, top: 0, width: '100vw', height: rect.top }} />
          <Box className='tutorial-dimmer' sx={{ left: 0, top: rect.bottom, width: '100vw', bottom: 0 }} />
          <Box className='tutorial-dimmer' sx={{ left: 0, top: rect.top, width: rect.left, height: rect.height }} />
          <Box className='tutorial-dimmer' sx={{ left: rect.right, right: 0, top: rect.top, height: rect.height }} />
          <Box
            className='tutorial-target-blocker'
            sx={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <Box className='tutorial-dimmer tutorial-dimmer-full' />
      )}

      <Paper
        className='tutorial-card'
        elevation={12}
        sx={{
          width: position.width,
          left: position.left,
          top: position.top,
          maxHeight: `calc(100vh - ${position.top + VIEWPORT_PADDING}px)`
        }}
      >
        <Box className='tutorial-card-head'>
          <Box>
            <Typography variant='caption' color='primary' fontWeight={800}>
              功能教程 · {index + 1}/{total}
            </Typography>
            <Typography variant='h6' fontWeight={800}>{step.title}</Typography>
          </Box>
          <IconButton size='small' onClick={onPause} aria-label='暂时关闭教程'>
            <CloseIcon fontSize='small' />
          </IconButton>
        </Box>

        <LinearProgress variant='determinate' value={progress} className='tutorial-progress' />
        <Typography variant='body1' className='tutorial-content'>{step.content}</Typography>
        {step.details?.length > 0 && (
          <Box component='ul' className='tutorial-details'>
            {step.details.map(detail => (
              <Typography component='li' variant='body2' color='text.secondary' key={detail}>{detail}</Typography>
            ))}
          </Box>
        )}
        {targetMissing && (
          <Typography variant='caption' color='warning.main'>
            当前页面暂未找到对应控件，您仍可以继续下一步。
          </Typography>
        )}

        <Box className='tutorial-card-actions'>
          <Button size='small' color='inherit' onClick={onDismiss}>跳过且不再自动提示</Button>
          <Stack direction='row' spacing={1}>
            <Button variant='outlined' onClick={onPrevious} disabled={index === 0}>上一步</Button>
            <Button ref={nextButtonRef} variant='contained' onClick={onNext}>
              {lastStep ? '完成教程' : '下一步'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>,
    document.body
  )
}
