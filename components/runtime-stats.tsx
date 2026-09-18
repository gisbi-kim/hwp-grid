import {useEffect,useState} from 'react';
import {engineMemoryBytes} from '@/lib/hwp-engine';

type HeapPerformance=Performance&{memory?:{usedJSHeapSize?:number}};
const mb=(bytes:number)=>(bytes/1_000_000).toFixed(1);

export function RuntimeStats({documentMs}:{documentMs:number|null}){
  const [loadMs,setLoadMs]=useState<number|null>(null);
  const [memory,setMemory]=useState<{js:number|null;engine:number}>({js:null,engine:0});
  useEffect(()=>{
    let loadTimer:ReturnType<typeof setTimeout>|undefined;
    // Read after the load handler returns so loadEventEnd has been recorded.
    const loaded=()=>{loadTimer=setTimeout(()=>{
      const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
      if(navigation&&navigation.loadEventEnd>0)setLoadMs(navigation.loadEventEnd-navigation.startTime);
    },0);};
    const sample=()=>{
      if(document.hidden)return;
      let js:number|null=null;
      try{const value=(performance as HeapPerformance).memory?.usedJSHeapSize;
        if(typeof value==='number'&&Number.isFinite(value)&&value>=0)js=value;
      }catch{/* Some browsers restrict memory measurements. */}
      setMemory({js,engine:engineMemoryBytes()});
    };
    if(document.readyState==='complete')loaded();else window.addEventListener('load',loaded,{once:true});
    sample();const timer=setInterval(sample,2000);
    document.addEventListener('visibilitychange',sample);
    return()=>{clearTimeout(loadTimer);clearInterval(timer);window.removeEventListener('load',loaded);document.removeEventListener('visibilitychange',sample);};
  },[]);
  return <div className="runtime-stats" role="group" aria-label="로딩 시간 및 메모리 정보">
    <span data-stat="load">최초 로딩 {loadMs===null?'측정 중…':`${(loadMs/1000).toFixed(2)}초`}</span>
    {documentMs!==null&&<span data-stat="document">문서 준비 {(documentMs/1000).toFixed(2)}초</span>}
    <span data-stat="memory">메모리(JS) {memory.js===null?'측정 미지원':`약 ${mb(memory.js)} MB`}</span>
    <span data-stat="engine">엔진 할당 {mb(memory.engine)} MB</span>
    <details><summary>측정 안내</summary><p>최초 로딩은 이번 접속 시작부터 사이트 로드 완료까지입니다. 문서 준비는 파일 읽기·엔진 초기화·문서 분석 시간이며, 페이지 그림·글꼴 표시와 저장 시간은 제외합니다. 메모리는 2초마다 갱신합니다. JS는 화면 측의 추정 사용량(worker JS 힙 제외), 엔진 할당은 백그라운드 문서 엔진이 확보한 메모리 공간입니다. 두 수치는 전체 탭 메모리가 아니며 합산하지 않습니다. MB는 1,000,000바이트입니다.</p></details>
  </div>;
}
