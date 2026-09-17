import type {PageSize} from './hwp-engine';
export function gridLayout(pages:readonly PageSize[],cols:number,viewportWidth:number,zoom:number){
  // Equal display widths keep portrait pages from leaving landscape-sized gutters.
  const width=pages[0]?.width||1;
  const heights=pages.map(p=>width*p.height/p.width);
  const gap=24,pad=28;const fit=Math.max(.04,(viewportWidth-pad*2)/(cols*width+(cols-1)*gap));const scale=fit*zoom;
  const gridWidth=(cols*width+(cols-1)*gap)*scale;
  const left=Math.max(pad,(viewportWidth-gridWidth)/2);
  const items:{left:number;top:number;width:number;height:number}[]=[];
  let top=pad;
  for(let start=0;start<pages.length;start+=cols){
    const row=heights.slice(start,start+cols);
    row.forEach((height,col)=>items.push({left:left+col*(width+gap)*scale,top,width:width*scale,height:height*scale}));
    top+=(Math.max(...row)+gap)*scale;
  }
  return {scale,fit,width:Math.max(viewportWidth,gridWidth+pad*2),height:pages.length?top-gap*scale+pad:pad*2,items};
}

export function pageAtScroll(items:readonly {top:number}[],cols:number,scrollTop:number){
  let page=1;
  for(let i=0;i<items.length;i+=cols){if(items[i].top>scrollTop+28.5)break;page=i+1;}
  return page;
}
