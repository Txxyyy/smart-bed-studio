// Metres. The mattress follows the 160 × 190 cm nominal size of the supplied STEP.
export const DIMENSIONS = Object.freeze({width:1.60,length:1.90,deckHeight:.36,mattressHeight:.21});
export const AIR_LAYOUT = Object.freeze({centerX:.39,spreadX:.30,pouchWidth:.65,valveOffset:.334});
export const HEADBOARD_LAYOUT = Object.freeze({height:1.25,bedRear:-DIMENSIONS.length/2-.015,bedOpening:-DIMENSIONS.length/2+.010});
export const SURROUND_STYLES = Object.freeze({
  wide:Object.freeze({label:'内嵌床邦',outerWidth:1.76,foot:1.025,innerWidth:1.64,innerFoot:.968,deckWidth:1.59,headboardWidth:1.82}),
  flush:Object.freeze({label:'齐边床邦',outerWidth:1.60,foot:.95,innerWidth:1.48,innerFoot:.906,deckWidth:1.43,headboardWidth:1.72}),
});
export const SURROUND_HEIGHT = Object.freeze({bottom:.078,top:.350});
