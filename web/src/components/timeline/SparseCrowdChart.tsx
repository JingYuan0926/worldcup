"use client";

import { useEffect, useRef, useState } from "react";

interface SparseCrowdChartProps {
  homeCounts: readonly number[];
  awayCounts: readonly number[];
  homeName: string;
  awayName: string;
  resolution: "minute" | "second";
  /** Space occupied by the separate time ruler above the graph. */
  topInset?: number;
}

/**
 * Canvas keeps the exact-second view light: a sparse match can contain 7,201
 * possible timestamps per team without creating thousands of DOM elements.
 */
export function SparseCrowdChart({
  homeCounts,
  awayCounts,
  homeName,
  awayName,
  resolution,
  topInset = 0,
}: SparseCrowdChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const pointCount = Math.max(homeCounts.length, awayCounts.length);
  const intervalCount = Math.max(1, pointCount - 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const maximum = Math.max(1, ...homeCounts, ...awayCounts);
      const graphHeight = Math.max(1, rect.height - topInset);
      const center = topInset + graphHeight / 2;
      const maximumHeight = graphHeight * 0.42;
      const step = rect.width / intervalCount;
      const barWidth = resolution === "second"
        ? Math.max(0.7, Math.min(1.6, step))
        : Math.max(1, step - 1);

      context.fillStyle = "rgba(27, 79, 156, 0.62)";
      homeCounts.forEach((count, index) => {
        if (count <= 0) return;
        const height = Math.max(2, (count / maximum) * maximumHeight);
        const x = Math.min(rect.width - barWidth, index * step);
        context.fillRect(x, center - height, barWidth, height);
      });

      context.fillStyle = "rgba(201, 41, 59, 0.58)";
      awayCounts.forEach((count, index) => {
        if (count <= 0) return;
        const height = Math.max(2, (count / maximum) * maximumHeight);
        const x = Math.min(rect.width - barWidth, index * step);
        context.fillRect(x, center, barWidth, height);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [awayCounts, homeCounts, intervalCount, resolution, topInset]);

  const hoverLeft = hoverIndex == null ? 0 : (hoverIndex / intervalCount) * 100;
  const timeLabel = hoverIndex == null
    ? ""
    : resolution === "second"
      ? exactTimeLabel(hoverIndex)
      : `${hoverIndex}'`;

  return (
    <div
      className="absolute inset-0"
      role="img"
      aria-label={`Simulated exact-time prediction distribution. ${homeName} is shown above the line and ${awayName} below it. Empty timestamps have no simulated picks.`}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-[4] h-full w-full cursor-crosshair"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          setHoverIndex(Math.min(intervalCount, Math.floor(fraction * intervalCount)));
        }}
        onPointerLeave={() => setHoverIndex(null)}
        onPointerDown={(event) => event.stopPropagation()}
        aria-hidden="true"
      />
      {hoverIndex != null && (
        <div
          className="num pointer-events-none absolute z-50 min-w-max -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[10px] font-semibold shadow-lg backdrop-blur"
          style={{
            left: `${Math.max(4, Math.min(96, hoverLeft))}%`,
            top: `calc(50% + ${topInset / 2}px)`,
          }}
        >
          <div className="mb-1 text-center text-slate-500">{timeLabel}</div>
          <div className="text-[#1B4F9C]">{homeName} {homeCounts[hoverIndex] ?? 0}</div>
          <div className="text-[#A51F32]">{awayName} {awayCounts[hoverIndex] ?? 0}</div>
        </div>
      )}
    </div>
  );
}

function exactTimeLabel(second: number): string {
  const minutes = Math.floor(second / 60);
  const seconds = Math.floor(second % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
