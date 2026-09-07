export const COLOR_SWATCHES=[
  ['暖瓷白','#f3eee4'],['珍珠灰','#dce0df'],['燕麦米','#d3c4aa'],['沙岩褐','#aa937b'],['摩卡棕','#71574b'],['焦糖棕','#a06e49'],['陶土橙','#b1785f'],['烟粉','#c5a29c'],['酒红','#713e49'],['鼠尾草','#96a08b'],['苔藓绿','#657463'],['森林绿','#365b4a'],['雾蓝','#8da5b0'],['深海蓝','#3e5770'],['靛青','#304957'],['灰紫','#8f8496'],['银灰','#a6acb0'],['石墨灰','#606b6e'],['暖黑','#363b3b'],['曜石黑','#242b2e'],
];
export const PATTERNS={derucciAI:'DeRUCCI AI 标识',derucci:'DeRUCCI 标识',t11:'T11+ 型号标识',performance:'横向提花织纹',microMesh:'细菱网织',ribbon:'细罗纹织带',wave:'波浪绗缝',diamond:'菱格绗缝',channel:'纵向绗缝',honeycomb:'六角绗缝',herringbone:'人字织纹',plain:'细密针织',grid:'小方格绗缝',grain:'细纹皮革',pebble:'荔枝纹皮革',smooth:'柔光皮革',foam:'微孔泡棉'};
export const PATTERN_OPTIONS={retainer:['grain','pebble','smooth'],brand:['derucciAI'],modelMark:['t11'],retainerLogo:['derucci'],fabric:['performance','wave','diamond','channel','honeycomb','herringbone','plain'],side:['microMesh','grid','channel','diamond','herringbone','plain'],waistband:['ribbon'],leather:['grain','pebble','smooth'],surround:['grain','pebble','smooth'],frame:[],foam:['foam'],piping:[]};
export const HEADBOARD_STYLES={cushion:'双靠包软包',channel:'竖向分格软包'};
export const DEFAULT_COLLECTION='indigoWeave';
// Colors stay coordinated across the mattress, headboard, surround and tailored edge.
export const COLLECTIONS=[
  {id:'indigoWeave',name:'暮蓝织序',mood:'参考图 · 靛蓝织纹 × 米色腰线',colors:['#263044','#222938','#343947','#242329','#c6bbaa'],patterns:['performance','microMesh','grain'],headboard:'channel',waistband:true,bandColor:'#cfc5b2',surroundAccents:false,roughness:[.94,.92,.8,.8,.78]},
  {id:'ivory',name:'云栖奶油',mood:'暖白 × 燕麦皮革',colors:['#f3eee4','#d7cbb7','#c8b59a','#a48d71','#8e7c65'],patterns:['wave','grid','grain']},
  {id:'oat',name:'燕麦亚麻',mood:'米灰 × 织物肌理',colors:['#eae1d1','#b9ae9a','#b0a38b','#807563','#827b6d'],patterns:['herringbone','plain','pebble']},
  {id:'sage',name:'鼠尾草',mood:'米白 × 柔和灰绿',colors:['#e9eadb','#a1ac94','#8e9b86','#586855','#677960'],patterns:['wave','channel','grain']},
  {id:'clay',name:'暖陶赤褐',mood:'象牙白 × 陶土色',colors:['#f1e1cf','#bc8b70','#ae6e51','#744737','#8e604c'],patterns:['diamond','grid','smooth']},
  {id:'mocha',name:'可可摩卡',mood:'暖米 × 深巧克力',colors:['#e9dece','#a99884','#71574b','#46352f','#796553'],patterns:['channel','herringbone','pebble']},
  {id:'midnight',name:'午夜靛蓝',mood:'冷白 × 靛蓝皮革',colors:['#e1e8e9','#82929f','#3d546b','#283a4e','#6c7e8d'],patterns:['wave','channel','grain']},
  {id:'basalt',name:'玄岩银灰',mood:'银灰 × 石墨灰',colors:['#e0e2e1','#98a2a4','#606d73','#35434b','#616d72'],patterns:['honeycomb','grid','pebble']},
  {id:'mist',name:'雾蓝海盐',mood:'浅灰白 × 雾蓝',colors:['#edf0e8','#acbdc1','#889ea5','#607b85','#7c9095'],patterns:['herringbone','plain','smooth']},
  {id:'charcoal',name:'黑曜石',mood:'暖白 × 黑色皮革',colors:['#e5e3da','#7b7c78','#373c3d','#202628','#555b59'],patterns:['diamond','channel','grain']},
  {id:'merlot',name:'酒红暖金',mood:'奶白 × 深酒红',colors:['#efe2cd','#b2968a','#713b44','#48262e','#9e8565'],patterns:['diamond','herringbone','smooth']},
  {id:'saddle',name:'焦糖马鞍',mood:'奶咖 × 马鞍棕',colors:['#eee4d4','#ba9b7e','#a06e49','#684b37','#806144'],patterns:['honeycomb','channel','pebble']},
  {id:'blush',name:'烟粉砂岩',mood:'柔白 × 低饱和烟粉',colors:['#f0e7df','#c9b9af','#bc9d96','#8b736e','#9b8278'],patterns:['wave','plain','grain']},
];
