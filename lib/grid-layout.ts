import type {PageSize} from './hwp-engine';
export function gridLayout(pages:readonly PageSize[],cols:number,viewportWidth:number,zoom:number){
  const width=Math.max(1,...pages.map(p=>p.width)),height=Math.max(1,...pages.map(p=>p.height));
  const gap=24,pad=28;const fit=Math.max(.04,(viewportWidth-pad*2)/(cols*width+(cols-1)*gap));const scale=fit*zoom;
  const gridWidth=(cols*width+(cols-1)*gap)*scale;
  const left=Math.max(pad,(viewportWidth-gridWidth)/2);
  return {scale,fit,width:Math.max(viewportWidth,gridWidth+pad*2),height:Math.ceil(pages.length/cols)*(height+gap)*scale-gap*scale+pad*2,rowHeight:(height+gap)*scale,
    items:pages.map((p,i)=>({left:left+(i%cols)*(width+gap)*scale+(width-p.width)*scale/2,top:pad+Math.floor(i/cols)*(height+gap)*scale,width:p.width*scale,height:p.height*scale}))};
}
