// Metres. The mattress follows the 160 × 190 cm nominal size of the supplied STEP.
export const DIMENSIONS = Object.freeze({
  width: 1.6,
  length: 1.9,
  deckHeight: 0.36,
  mattressHeight: 0.21,
});
export const AIR_LAYOUT = Object.freeze({
  centerX: 0.39,
  spreadX: 0.3,
  pouchWidth: 0.65,
  valveOffset: 0.334,
  bottom: 0.066,
  minHalfHeight: 0.025,
  halfHeightRange: 0.057,
});
// Effects stay on the assembled mattress; only small surface offsets prevent z-fighting.
export const SHOWROOM_LAYOUT = Object.freeze({
  surfaceTop: 0.228,
  heatGap: 0.009,
  airFlowGap: 0.004,
  coverOpacity: 0.38,
});
export const HEADBOARD_LAYOUT = Object.freeze({
  height: 1.1,
  bedRear: -DIMENSIONS.length / 2 - 0.015,
  bedOpening: -DIMENSIONS.length / 2 + 0.01,
});
// T12 photo-fit tailoring, measured from the cover's top; not a production drawing.
export const TAILORED_COVER = Object.freeze({
  height: 0.26,
  bottom: 0.018,
  bandOffset: 0.026,
  bandHalfWidth: 0.012,
  lowerWeltOffset: 0.04,
  weltHalfWidth: 0.0028,
  quiltRows: 30,
  quiltDepth: 0.0025,
  strapPositions: Object.freeze([-0.48, 0.48]),
  strapCenter: 0.13,
  strapWidth: 0.108,
  strapHeight: 0.204,
  strapLift: 0.005,
  strapFold: 0.032,
  stitchWidth: 0.0012,
  strapLogoWidth: 0.092,
  strapLogoHeight: 0.039,
  labelZ: 0.34,
  labelY: 0.218,
  labelWidth: 0.034,
  labelHeight: 0.035,
});
export const SURROUND_STYLES = Object.freeze({
  wide: Object.freeze({
    label: '内嵌床邦',
    outerWidth: 1.76,
    foot: 1.025,
    innerWidth: 1.64,
    innerFoot: 0.968,
    deckWidth: 1.59,
    headboardWidth: 1.82,
  }),
  flush: Object.freeze({
    label: '齐边床邦',
    outerWidth: 1.6,
    foot: 0.95,
    innerWidth: 1.48,
    innerFoot: 0.906,
    deckWidth: 1.43,
    headboardWidth: 1.72,
  }),
});
export const SURROUND_HEIGHT = Object.freeze({ bottom: 0.078, top: 0.35 });

// T12 photo-fit placement, independent of the T11+ marks. Not measured product dimensions.
export const T12_FRONT_MARKS = Object.freeze([
  Object.freeze({
    name: 'Mattress_DeRUCCI',
    material: 'brand',
    text: 'DeRUCCI AI',
    x: -0.53,
    y: 0.135,
    width: 0.26,
    height: 0.052,
  }),
  Object.freeze({
    name: 'Mattress_T12',
    material: 'modelMark',
    text: 'T12',
    x: 0.51,
    y: 0.11,
    width: 0.082,
    height: 0.055,
  }),
]);

// T12 visual fit: lower cushions start above the 638 mm mattress surface.
export const T12_HEADBOARD_LAYOUT = Object.freeze({
  height: 1.29,
  bottom: 0.028,
  rear: -1.115,
  bodyFront: -0.973,
  upperBodyFront: -1.055,
  upperBottom: 0.896,
  upperHeight: 0.394,
  lowerBottom: 0.65,
  lowerHeight: 0.24,
  centerGap: 0.008,
  edgeInset: 0.006,
  radius: 0.042,
  upperFront: -0.985,
  upperCrown: 0.028,
  upperLean: 0.025,
  lowerFront: -0.97,
  lowerCrown: 0.012,
  seamDepth: 0.0025,
  seamHalfWidth: 0.009,
});

// Massage layout is fitted to the supplied schematic, not measured hardware dimensions.
export const T12_MASSAGE_LAYOUT = Object.freeze({
  surfaceInset: 0.062,
  minHeight: 0.01,
  lift: 0.034,
  radius: 0.043,
  surfaceSpread: 2.6,
  glowDiameter: 5.6,
  sideX: 0.4,
  rows: Object.freeze([-0.56, -0.24, 0.49]),
  padWidth: 0.5,
  padDepth: 0.22,
  clusterX: 0.135,
  clusterSpread: 0.038,
  clusterDepth: 0.043,
  defaultIntensity: 0.7,
  defaultCycleSeconds: 9,
  fadeSeconds: 0.8,
});

// T11+ circuit counts are confirmed; spacing and pouch dimensions are visual-fit values.
export const T11_AIR_LAYOUT = Object.freeze({
  centerX: 0.39,
  width: 0.65,
  depth: 0.15,
  spreadX: 0.3,
  spread: 0.085,
  groups: Object.freeze([
    Object.freeze({ id: 'shoulder', name: '肩部', centers: Object.freeze([-0.64, -0.46]) }),
    Object.freeze({ id: 'lumbar', name: '腰部', centers: Object.freeze([-0.23, -0.05]) }),
    Object.freeze({ id: 'hip', name: '臀部', centers: Object.freeze([0.18, 0.36, 0.54]) }),
  ]),
});

export const T12_SUPPORT_LAYOUT = Object.freeze({
  centerX: 0.4,
  firstRowZ: -0.72,
  rowPitch: 0.14,
  width: 0.74,
  depth: 0.12,
  controlBayStartZ: 0.49,
  controlBayEndZ: 0.91,
  manifoldEndZ: 0.69,
  spreadX: 0.35,
  spread: 0.06,
  minHalfHeight: 0.018,
  halfHeightRange: 0.045,
});
