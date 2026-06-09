// Block-level "tidy layout" solver for Map Studio.
//
// Once Gemini gives us the STRUCTURE of each block (prefix / rows / cols /
// centroid), we stop tracing the messy scan and re-flow each block as its own
// clean, uniform grid. Blocks are sized from their lot counts at a chosen
// aspect ratio, then separated with iterative AABB (axis-aligned bounding box)
// repulsion along their centroid vectors — preserving the neighbourhood's
// topology while guaranteeing no overlap.
//
// Pure + framework-free so it can be unit-tested directly. N is small (one node
// per block, typically 10-30 even for a 500-lot plan), so the O(N^2) pass per
// iteration is negligible.

import type { BoundingBox } from './grid-parser'

export interface SolverBlock {
  id: string
  centroid: { x: number; y: number }
  lots: { rows: number; cols: number }
  // Desired ON-SCREEN aspect of a single lot (width / height). Corrected for
  // image aspect inside the solver so it holds in rendered pixels, not in the
  // normalised coordinate space.
  idealAspect: number
  // Manually-moved blocks act as infinite-mass anchors on a re-run.
  pinned?: boolean
}

export interface SolverOptions {
  // REQUIRED for visual accuracy: imagePixelWidth / imagePixelHeight (the frame
  // the canvas renders through). Normalised-square != screen-square unless this
  // is 1. Defaults to 1 (square frame) when unknown.
  imageAspect?: number
  padding?: number          // inter-block road/gutter gap (default 0.02)
  baseUnitScale?: number    // baseline normalised size of a single lot (default 0.015)
  maxIterations?: number    // hard cap so the solver always terminates (default 100)
  maxScale?: number         // cap so a 1-block plan doesn't fill the whole canvas (default 3)
  targetBounds?: { min: number; max: number } // post-solve safe zone (default 0.02-0.98)
}

const DEFAULTS = {
  imageAspect: 1,
  padding: 0.02,
  baseUnitScale: 0.015,
  maxIterations: 100,
  maxScale: 3,
  targetBounds: { min: 0.02, max: 0.98 },
} as const

interface SolverNode {
  id: string
  cx: number
  cy: number
  width: number
  height: number
  pinned: boolean
}

/**
 * Resolves overlaps between structural block grids using iterative centroid
 * repulsion. Returns a map of idealised, collision-free bounding boxes keyed by
 * block id, normalised into the target safe zone.
 */
export function layoutSolver(
  blocks: SolverBlock[],
  options: SolverOptions = {}
): Map<string, BoundingBox> {
  const imageAspect = options.imageAspect ?? DEFAULTS.imageAspect
  const padding = options.padding ?? DEFAULTS.padding
  const baseUnitScale = options.baseUnitScale ?? DEFAULTS.baseUnitScale
  const maxIterations = options.maxIterations ?? DEFAULTS.maxIterations
  const maxScale = options.maxScale ?? DEFAULTS.maxScale
  const targetBounds = options.targetBounds ?? DEFAULTS.targetBounds

  const result = new Map<string, BoundingBox>()
  if (blocks.length === 0) return result

  // 1. Idealised, screen-aspect-corrected block dimensions.
  const nodes: SolverNode[] = blocks.map(b => {
    const lotH = baseUnitScale
    // Divide by imageAspect so the lot reads as `idealAspect` AFTER the
    // normalised->screen stretch the renderer applies.
    const lotW = (baseUnitScale * b.idealAspect) / imageAspect
    return {
      id: b.id,
      cx: b.centroid.x,
      cy: b.centroid.y,
      width: Math.max(1, b.lots.cols) * lotW,
      height: Math.max(1, b.lots.rows) * lotH,
      pinned: !!b.pinned,
    }
  })

  // 2. Full-strength deterministic resolution (run to convergence; the cooling
  // animation lives in the UI layer, never in the geometry solve).
  for (let iter = 0; iter < maxIterations; iter++) {
    let hasCollisions = false

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        if (a.pinned && b.pinned) continue

        const dx = b.cx - a.cx
        const dy = b.cy - a.cy
        const distance = Math.hypot(dx, dy)

        // Coincident centroids (e.g. two same-prefix blocks split by a road that
        // the AI placed near-identically) have no repulsion direction — nudge
        // them apart deterministically along x so they separate next iteration.
        if (distance < 1e-4) {
          const eps = 1e-3
          const dir = i < j ? -1 : 1
          if (!a.pinned) a.cx += dir * eps
          if (!b.pinned) b.cx -= dir * eps
          hasCollisions = true
          continue
        }

        const minSpacingX = (a.width + b.width) / 2 + padding
        const minSpacingY = (a.height + b.height) / 2 + padding
        const overlapX = minSpacingX - Math.abs(dx)
        const overlapY = minSpacingY - Math.abs(dy)

        if (overlapX > 0 && overlapY > 0) {
          hasCollisions = true
          const pushX = (dx / distance) * overlapX
          const pushY = (dy / distance) * overlapY

          if (!a.pinned && !b.pinned) {
            a.cx -= pushX * 0.5
            a.cy -= pushY * 0.5
            b.cx += pushX * 0.5
            b.cy += pushY * 0.5
          } else if (a.pinned) {
            b.cx += pushX
            b.cy += pushY
          } else {
            a.cx -= pushX
            a.cy -= pushY
          }
        }
      }
    }

    if (!hasCollisions) break
  }

  // 3. Topology snapping: fit the settled union bbox into the target safe zone
  // with a single uniform scale (no distortion of the chosen lot aspect).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - n.width / 2)
    maxX = Math.max(maxX, n.cx + n.width / 2)
    minY = Math.min(minY, n.cy - n.height / 2)
    maxY = Math.max(maxY, n.cy + n.height / 2)
  }

  const currentW = maxX - minX || 1
  const currentH = maxY - minY || 1
  const targetSpan = targetBounds.max - targetBounds.min
  const scale = Math.min(targetSpan / currentW, targetSpan / currentH, maxScale)

  const srcCenterX = (minX + maxX) / 2
  const srcCenterY = (minY + maxY) / 2
  const dstCenter = (targetBounds.min + targetBounds.max) / 2

  for (const n of nodes) {
    const cx = dstCenter + (n.cx - srcCenterX) * scale
    const cy = dstCenter + (n.cy - srcCenterY) * scale
    const width = n.width * scale
    const height = n.height * scale
    result.set(n.id, {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
    })
  }

  return result
}
