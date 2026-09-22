// App embedding has its own UI-free entry.
const query=new URLSearchParams(location.search);
if(query.has('studio'))await import('./main.js');
else if(query.has('embed')){
  document.querySelector('#app').classList.add('embedded');
  document.querySelector('#app').style.cssText='position:fixed;inset:0;overflow:hidden';
  document.querySelector('#app').innerHTML='<div id="model-viewport" style="width:100%;height:100%"></div>';
  window.mattressBootError=(code,message)=>window.dispatchEvent(new CustomEvent('mattress:bridge',{detail:{protocolVersion:1,type:'event',name:'bridge.failed',data:{code,message}}}));
  await import('./embed-app.js');
}else await import('./model-app.js');
