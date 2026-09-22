// Metres. The mattress follows the 160 × 190 cm nominal size of the supplied STEP.
export const DIMENSIONS = Object.freeze({width:1.60,length:1.90,deckHeight:.36,mattressHeight:.21});
export const AIR_LAYOUT = Object.freeze({centerX:.39,spreadX:.30,pouchWidth:.65,valveOffset:.334,bottom:.066,minHalfHeight:.025,halfHeightRange:.057});
// Effects stay on the assembled mattress; only small surface offsets prevent z-fighting.
export const SHOWROOM_LAYOUT = Object.freeze({surfaceTop:.228,heatGap:.009,airFlowGap:.004,coverOpacity:.38});
export const HEADBOARD_LAYOUT = Object.freeze({height:1.10,bedRear:-DIMENSIONS.length/2-.015,bedOpening:-DIMENSIONS.length/2+.010});
// T12 photo-fit tailoring, measured from the cover's top; not a production drawing.
export const TAILORED_COVER = Object.freeze({height:.26,bottom:.018,bandOffset:.026,bandHalfWidth:.012,lowerWeltOffset:.040,weltHalfWidth:.0028,quiltRows:30,quiltDepth:.0025,strapPositions:Object.freeze([-.48,.48]),strapCenter:.130,strapWidth:.108,strapHeight:.204,strapLift:.005,strapFold:.032,stitchWidth:.0012,strapLogoWidth:.092,strapLogoHeight:.039,labelZ:.34,labelY:.218,labelWidth:.034,labelHeight:.035});
export const SURROUND_STYLES = Object.freeze({
  wide:Object.freeze({label:'内嵌床邦',outerWidth:1.76,foot:1.025,innerWidth:1.64,innerFoot:.968,deckWidth:1.59,headboardWidth:1.82}),
  flush:Object.freeze({label:'齐边床邦',outerWidth:1.60,foot:.95,innerWidth:1.48,innerFoot:.906,deckWidth:1.43,headboardWidth:1.72}),
});
export const SURROUND_HEIGHT = Object.freeze({bottom:.078,top:.350});

// T12 photo-fit placement, independent of the T11+ marks. Not measured product dimensions.
export const T12_FRONT_MARKS=Object.freeze([
  Object.freeze({name:'Mattress_DeRUCCI',material:'brand',text:'DeRUCCI AI',x:-.53,y:.135,width:.260,height:.052}),
  Object.freeze({name:'Mattress_T12',material:'modelMark',text:'T12',x:.51,y:.110,width:.082,height:.055}),
]);

// T12 visual fit: lower cushions start above the 638 mm mattress surface.
export const T12_HEADBOARD_LAYOUT=Object.freeze({
  height:1.29,bottom:.028,rear:-1.115,bodyFront:-.973,upperBodyFront:-1.055,
  upperBottom:.896,upperHeight:.394,lowerBottom:.650,lowerHeight:.240,
  centerGap:.008,edgeInset:.006,radius:.042,
  upperFront:-.985,upperCrown:.028,upperLean:.025,lowerFront:-.970,lowerCrown:.012,
  seamDepth:.0025,seamHalfWidth:.009,
});

// Massage layout is fitted to the supplied schematic, not measured hardware dimensions.
export const T12_MASSAGE_LAYOUT=Object.freeze({
  surfaceInset:.062,minHeight:.010,lift:.034,radius:.043,
  surfaceSpread:2.6,glowDiameter:5.6,
  sideX:.40,rows:Object.freeze([-.56,-.24,.49]),padWidth:.50,padDepth:.22,
  clusterX:.135,clusterSpread:.038,clusterDepth:.043,
  defaultIntensity:.7,defaultCycleSeconds:9,fadeSeconds:.8,
});

// T11+ circuit counts are confirmed; spacing and pouch dimensions are visual-fit values.
export const T11_AIR_LAYOUT=Object.freeze({
  centerX:.39,width:.65,depth:.15,spreadX:.30,spread:.085,
  groups:Object.freeze([
    Object.freeze({id:'shoulder',name:'肩部',centers:Object.freeze([-.64,-.46])}),
    Object.freeze({id:'lumbar',name:'腰部',centers:Object.freeze([-.23,-.05])}),
    Object.freeze({id:'hip',name:'臀部',centers:Object.freeze([.18,.36,.54])}),
  ]),
});

export const T12_SUPPORT_LAYOUT=Object.freeze({
  centerX:.40,firstRowZ:-.72,rowPitch:.14,width:.74,depth:.12,
  controlBayStartZ:.49,controlBayEndZ:.91,manifoldEndZ:.69,
  spreadX:.35,spread:.06,minHalfHeight:.018,halfHeightRange:.045,
});
