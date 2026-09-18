type Job={run:()=>void;priority:boolean};
const jobs:Job[]=[];
let scheduled=false;
function pump(){
  if(scheduled||!jobs.length)return;
  scheduled=true;
  const next=()=>{
    scheduled=false;
    const index=jobs.findIndex(job=>job.priority);
    const job=jobs.splice(index<0?0:index,1)[0];
    try{job?.run();}finally{pump();}
  };
  // Yield between pages so a newly arriving scroll/pinch can be handled first.
  if('requestIdleCallback' in window)window.requestIdleCallback(next,{timeout:150});
  else requestAnimationFrame(()=>setTimeout(next,0));
}
export function queuePageRender(run:()=>void,priority:boolean){
  const job={run,priority};jobs.push(job);pump();
  return()=>{const i=jobs.indexOf(job);if(i>=0)jobs.splice(i,1);};
}
