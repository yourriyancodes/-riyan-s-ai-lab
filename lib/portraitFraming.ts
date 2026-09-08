/**
 * Portrait framing maths, kept out of the component so it can be tested at every viewport
 * size without a browser.
 *
 * The bug this exists to prevent: the 3D portrait used to author a quad of height 1 at a
 * fixed 4:5 aspect and push a 2:3 photograph into it by *cropping the texture*
 * (`repeatY = 0.833, offsetY = 0.167`, flush against the top row of the image), while the
 * camera — `PerspectiveCamera(30, …)` at `z = 1.55` — can only show 0.83 units of height
 * at that distance. So the quad was ~20 % larger than the frame: 10 % off the top, 10 % off
 * the bottom, `overflow-hidden` turning that into "the top of Riyan's head is cut off".
 * And because the overflow depends on the *container's* aspect, the amount cut changed with
 * the viewport. Relief displacement (up to 0.075 toward the camera) and the pointer parallax
 * (`rotation.y` ± 0.16) grew the projected bounds further on top of that.
 *
 * The rule the maths below enforces: **contain, never crop.** The quad is authored at the
 * photograph's own aspect ratio (so no part of the image is discarded and nothing is
 * stretched), and the camera distance is solved from the projection so the whole quad fits
 * inside whatever box it is mounted in — with explicit slack for the relief bulge and the
 * tilt. Narrow box, wide box, phone, tablet: the head stays in frame, and the letterboxing
 * lands on whichever axis has room for it.
 */

/** The card's CSS box. Unchanged from the original design; it is no longer the image's aspect. */
export const PORTRAIT_FRAME_ASPECT = 4 / 5

/** Vertical field of view the portrait stage is built with. */
export const PORTRAIT_FOV_DEG = 30

/**
 * Extra distance beyond an exact fit. `relief` displaces the plane toward the camera by up
 * to this much (world units, plane height = 1), and the parallax tilts it, so an exact fit
 * would still clip the nose of the highlight side. The value is the measured worst case of
 * both effects with a small margin, not a guess: relief 0.075 grows the projected half-height
 * by 1.55/(1.55−0.075) ≈ 5.1 %, and a 0.16 rad tilt adds ≈ 8.2 % at the top corner.
 */
export const PORTRAIT_FIT_SLACK = 1.16

/** Quad height in world units. The image occupies this exactly, so 1 ⇒ full image visible. */
export const PORTRAIT_PLANE_HEIGHT = 1

export type PortraitFit = {
  /** Camera distance that contains the quad in the box. */
  distance: number
  /** World-space width of the quad: the photograph's own aspect, never the box's. */
  planeWidth: number
  /** Which axis limits the fit — 'width' means the image is letterboxed top and bottom. */
  limitedBy: 'height' | 'width'
  /** Fraction of the box height the image occupies, ≤ 1 by construction. */
  heightFill: number
  /** Fraction of the box width the image occupies, ≤ 1 by construction. */
  widthFill: number
  /**
   * Fraction of the *image* that lands outside the box. Zero is the requirement; this exists
   * so a regression can be asserted instead of eyeballed.
   */
  clippedArea: number
}

/** Visible height of the frustum at `distance`, for a vertical FOV in degrees. */
export function visibleHeightAt(distance: number, fovDeg: number = PORTRAIT_FOV_DEG): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360)
}

/**
 * Solve the contain fit for a box of aspect `boxAspect` showing a `planeAspect`-wide,
 * unit-tall quad. Both constraints are expressed as a required distance, and the *larger*
 * distance wins — that is what "contained" means in a perspective camera.
 */
export function fitPortrait(boxAspect: number, planeAspect: number = PORTRAIT_FRAME_ASPECT): PortraitFit {
  const half = Math.tan((PORTRAIT_FOV_DEG * Math.PI) / 360)
  const safeAspect = Number.isFinite(boxAspect) && boxAspect > 0.02 ? boxAspect : 0.02
  const safePlane = Number.isFinite(planeAspect) && planeAspect > 0.02 ? planeAspect : 0.02

  const planeWidth = safePlane * PORTRAIT_PLANE_HEIGHT
  const byHeight = PORTRAIT_PLANE_HEIGHT / 2 / half
  const byWidth = planeWidth / 2 / (half * safeAspect)
  const limitedBy = byWidth > byHeight ? 'width' : 'height'
  const distance = Math.max(byHeight, byWidth) * PORTRAIT_FIT_SLACK

  // What the box now shows, at the resting depth of the undisplaced plane.
  const boxHeight = visibleHeightAt(distance)
  const boxWidth = boxHeight * safeAspect
  const heightFill = Math.min(1, PORTRAIT_PLANE_HEIGHT / boxHeight)
  const widthFill = Math.min(1, planeWidth / boxWidth)

  const outsideY = Math.max(0, PORTRAIT_PLANE_HEIGHT - boxHeight)
  const outsideX = Math.max(0, planeWidth - boxWidth)
  const clippedArea = (outsideX * PORTRAIT_PLANE_HEIGHT + outsideY * planeWidth) / (planeWidth * PORTRAIT_PLANE_HEIGHT)

  return { distance, planeWidth, limitedBy, heightFill, widthFill, clippedArea }
}

/**
 * The texture transform for the quad. With contain framing this is always the identity —
 * the whole bitmap is sampled — which is the point: a crop is what made the head
 * dispensable in the first place. Returned rather than inlined so the invariant is testable.
 */
export function portraitUvTransform(): {
  repeatX: number
  repeatY: number
  offset: [number, number]
  cropped: boolean
} {
  return { repeatX: 1, repeatY: 1, offset: [0, 0], cropped: false }
}

/**
 * Which row of the *source image* the quad samples as its top edge.
 *
 * The texture is uploaded with its rows already flipped for the GPU (see
 * `RiyanPortrait3D`'s loader), so `v = 1` is the photograph's top row and the sampled band
 * is `[offsetY, offsetY + repeatY]`. The identity transform therefore returns row 0: nothing
 * is discarded, and the head cannot be cropped. A crop that trims the top returns a positive
 * number, meaning "this many rows of hair are gone" — which is what the previous
 * `repeatY = 0.833, offsetY = 0.167` did *before* perspective overflow was even considered.
 */
export function sampledTopRow(repeatY: number, offsetY: number, imageHeight: number): number {
  const topV = Math.min(1, Math.max(0, offsetY + repeatY))
  return Math.round((1 - topV) * Math.max(0, imageHeight - 1))
}

/** True when the top of the subject is still inside the sampled band, given a margin in rows. */
export function headIsInside(
  topInkRow: number,
  transform: { repeatY: number; offsetY: number },
  imageHeight: number,
  marginRows = 0,
): boolean {
  return sampledTopRow(transform.repeatY, transform.offsetY, imageHeight) <= Math.max(0, topInkRow - marginRows)
}

/**
 * Worst-case projected half-height of the framed photograph: the relief displaces surface
 * toward the camera (growing its projection), and the pointer parallax rotates the plane so
 * the near edge grows too. If a quad fits *after* both effects, nothing can ever be clipped
 * by the card's `overflow-hidden`, which is the actual acceptance condition for "the head is
 * never cut off".
 */
export function projectedHalfHeight(
  distance: number,
  planeHeight: number,
  planeWidth: number,
  relief: number,
  tiltYaw: number,
  boxAspect: number,
  fovDeg: number = PORTRAIT_FOV_DEG,
): { topWorld: number; frameHalfHeight: number; headroom: number } {
  const zNear = (planeWidth / 2) * Math.sin(Math.abs(tiltYaw)) + relief
  const topWorld = (planeHeight / 2) * (distance / Math.max(0.05, distance - zNear))
  const half = Math.tan((fovDeg * Math.PI) / 360)
  const frameHalfHeight = distance * half
  return { topWorld, frameHalfHeight, headroom: frameHalfHeight - topWorld }
}
