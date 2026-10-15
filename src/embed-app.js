import { createMattressViewer } from './mattress-sdk.js';
import { dispatchModel } from './model-dispatch.js';
import { WebViewBridge } from './webview-bridge.js';

let viewer;
try {
  if(!window.WebGL2RenderingContext||!window.ResizeObserver||!window.structuredClone)throw Object.assign(new Error('当前 WebView 缺少 WebGL 2 或必要的浏览器能力'),{code:'UNSUPPORTED_RUNTIME'});
  viewer=createMattressViewer(document.querySelector('#model-viewport'));
  const send=message=>{
    const serialized=JSON.stringify(message);
    if(window.MattressHost?.postMessage)window.MattressHost.postMessage(serialized);
    window.dispatchEvent(new CustomEvent('mattress:bridge',{detail:message}));
  };
  const configure=options=>{
    if(!options||typeof options!=='object'||Array.isArray(options))throw Object.assign(new Error('初始化配置无效'),{code:'INVALID_CONFIG'});
    for(const [key,value] of Object.entries(options)){
      if(!['background','interactionEnabled','followCamera'].includes(key)||key==='background'&&!/^#[0-9a-f]{6}$/i.test(value)||key!=='background'&&typeof value!=='boolean')throw Object.assign(new Error(`初始化字段无效: ${key}`),{code:'INVALID_CONFIG'});
    }
    if(options.background){viewer.scene.background.set(options.background);viewer.scene.fog.color.set(options.background);}
    if(options.interactionEnabled!==undefined)viewer.setInteractionEnabled(options.interactionEnabled);
    if(options.followCamera!==undefined)viewer.camera.setFollow(options.followCamera);
    viewer.invalidate();return options;
  };
  const bridge=new WebViewBridge(viewer,{send,configure,instanceId:`page-${Date.now()}-${Math.random().toString(36).slice(2)}`});
  window.MattressBridge=Object.freeze({receive:request=>bridge.receive(request),info:()=>bridge.info()});
  bridge.ready();
  // Preserve the existing browser embedding API while the dedicated Flutter
  // entry waits for its host to choose a model.
  if(new URLSearchParams(location.search).has('embed')){
    window.mattress=viewer;
    window.mattressDispatch=request=>dispatchModel(viewer,request);
    viewer.on('*',event=>window.dispatchEvent(new CustomEvent('mattress:event',{detail:event})));
    try{await viewer.setModel(new URLSearchParams(location.search).get('model')||'T11+');}
    finally{window.dispatchEvent(new CustomEvent('mattress:ready'));}
  }
}catch(error){viewer?.dispose();window.mattressBootError(error.code||'RENDERER_INIT_FAILED',error.message);}
