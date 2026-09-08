import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type FocusEvent } from 'react'
import { highlightFormula } from '../engine/highlight.ts'

interface Props {
  value: string
  caret?: number
  placeholder?: string
  className?: string
  autoFocus?: boolean
  'aria-label': string
  onChange(text: string, caret: number): void
  onCaret?(caret: number): void
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void
  onFocus?(e: FocusEvent<HTMLInputElement>): void
  onBlur?(e: FocusEvent<HTMLInputElement>): void
  inputProps?: Record<string, string>
}

/**
 * A single-line input whose text is transparent, layered over a mirror that
 * renders the same text with syntax colours (references, functions, strings).
 * Formulas colour; plain values render as ink.
 */
export function ColoredInput({ value, caret, placeholder, className, autoFocus, onChange, onCaret, onKeyDown, onFocus, onBlur, inputProps, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const spans = useMemo(() => highlightFormula(value), [value])

  // Keep the caret where the store says it is (after programmatic inserts).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el || caret === undefined) return
    if (el.selectionStart !== caret || el.selectionEnd !== caret) {
      try {
        el.setSelectionRange(caret, caret)
      } catch {
        /* not focused yet */
      }
    }
  }, [caret, value])

  useEffect(() => {
    if (autoFocus) {
      const el = inputRef.current
      el?.focus({ preventScroll: true })
      if (el && caret !== undefined) el.setSelectionRange(caret, caret)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  // Mirror the horizontal scroll of the input so long formulas stay aligned.
  const syncScroll = (): void => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
  }

  const reportCaret = (): void => {
    const el = inputRef.current
    if (el && onCaret) onCaret(el.selectionStart ?? el.value.length)
  }

  return (
    <div className={`colored-input ${className ?? ''}`}>
      <div className="mirror" ref={mirrorRef} aria-hidden="true">
        {spans.map((s, i) => (
          <span key={i} className={spanClass(s.kind, s.colorIndex)}>
            {s.text}
          </span>
        ))}
        {value === '' && placeholder ? <span className="text-ink-muted">{placeholder}</span> : null}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-label={rest['aria-label']}
        onChange={(e) => {
          onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
          syncScroll()
        }}
        onKeyDown={onKeyDown}
        onKeyUp={reportCaret}
        onClick={reportCaret}
        onSelect={reportCaret}
        onScroll={syncScroll}
        onFocus={onFocus}
        onBlur={onBlur}
        {...inputProps}
      />
    </div>
  )
}

function spanClass(kind: string, colorIndex?: number): string {
  switch (kind) {
    case 'ref':
      return `tok-ref-${(colorIndex ?? 0) % 5}`
    case 'fn':
      return 'tok-fn'
    case 'num':
      return 'tok-num'
    case 'str':
      return 'tok-str'
    case 'err':
      return 'tok-err'
    case 'op':
      return 'tok-op'
    default:
      return ''
  }
}
