"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { C } from "@/lib/tokens";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: (active: boolean) => React.ReactNode;
}

/**
 * One grouped container with a sliding selection.
 *
 * The pill is measured from the real buttons rather than assuming equal slots:
 * the labels differ in width ("Goal" vs "Yellow card"), and a fixed 1/n stride
 * drifts off the target and clips the icon. Re-measures on selection, on
 * resize, and once webfonts land — Archivo swapping in changes every width.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const btn = btnRefs.current.get(value);
    if (!wrap || !btn) return;
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [value]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    for (const b of btnRefs.current.values()) ro.observe(b);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    // Webfont swap resizes every label after first paint.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let alive = true;
    void fonts.ready.then(() => alive && measure());
    return () => {
      alive = false;
    };
  }, [measure]);

  return (
    <div
      ref={wrapRef}
      role="tablist"
      style={{
        position: "relative",
        display: "flex",
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: 3,
        background: C.surface,
      }}
    >
      {pill && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 3,
            bottom: 3,
            left: pill.left,
            width: pill.width,
            background: C.ink,
            borderRadius: 6,
            transition: "left 0.18s cubic-bezier(.3,.8,.4,1), width 0.18s cubic-bezier(.3,.8,.4,1)",
            pointerEvents: "none",
          }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            ref={(el) => {
              if (el) btnRefs.current.set(o.value, el);
              else btnRefs.current.delete(o.value);
            }}
            onClick={() => onChange(o.value)}
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              gap: 7,
              border: "none",
              background: "none",
              borderRadius: 6,
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              color: active ? C.white : C.ink2,
              transition: "color 0.18s",
              whiteSpace: "nowrap",
            }}
          >
            {o.icon?.(active)}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
