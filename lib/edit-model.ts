import type {HwpDocument} from '@rhwp/core';

export type CellPath = {controlIndex:number;cellIndex:number;cellParaIndex:number}[];
export type EditPosition = {sectionIndex:number;paragraphIndex:number;charOffset:number;parentParaIndex?:number;cellPath?:CellPath};
export type EditRect = {pageIndex:number;x:number;y:number;height:number;width?:number};
export type TextStyle = {fontFamily:string;fontSize:number;textColor:string;bold:boolean;italic:boolean;underline:boolean};
export type ImageMode='inline'|'square'|'topBottom'|'front'|'behind';
export type EditObject={type:'image'|'table';secIdx:number;paraIdx:number;controlIdx:number;pageIndex:number;x:number;y:number;w:number;h:number;mode?:ImageMode;row?:number;col?:number;rowSpan?:number;colSpan?:number;rowCount?:number;colCount?:number;cellIdx?:number;width:number;height:number;fillColor?:string;selectedCells?:number};
type ControlLayout={type:string;secIdx:number;paraIdx:number;controlIdx:number;x:number;y:number;w:number;h:number};
export type EditCommand =
  | {kind:'pick';page:number;x:number;y:number;extend?:boolean;textOnly?:boolean}
  | {kind:'insert';text:string}
  | {kind:'cellColor';color:string}
  | {kind:'tableInsert';rows:number;cols:number;width:number;height:number}
  | {kind:'newPage'}
  | {kind:'pageNumbers';startPage:number|null}
  | {kind:'paste';html:string;internal?:boolean}
  | {kind:'key';key:string;extend?:boolean;ctrl?:boolean}
  | {kind:'format';style:Partial<TextStyle>}
  | {kind:'fontSizeStep';delta:-1|1}
  | {kind:'imageInsert';bytes:Uint8Array;width:number;height:number;extension:string;name:string}
  | {kind:'imageMode';mode:ImageMode}
  | {kind:'objectResize';width:number;height:number}
  | {kind:'imageMove';x:number;y:number;drop?:{page:number;x:number;y:number}}
  | {kind:'cutImage';revision:number;secIdx:number;paraIdx:number;controlIdx:number}
  | {kind:'table';operation:'splitRows'|'splitCols'|'mergeRight'|'mergeDown'|'addRow'|'addCol'|'splitTable'|'mergeTable'}
  | {kind:'undo'|'redo'|'selectParagraph'};
export type EditState = {revision:number;caret:EditRect|null;selection:EditRect[];style:TextStyle;canUndo:boolean;canRedo:boolean;pages:{width:number;height:number}[];object:EditObject|null;checkpoints?:{id:number;time:number}[]};
type History = {doc:HwpDocument;snapshot:number;position:EditPosition|null;anchor:EditPosition|null};
const parse = <T>(json:string):T => JSON.parse(json);
type CellBox={cellIdx:number;row:number;col:number;rowSpan:number;colSpan:number;pageIndex:number;x:number;y:number;w:number;h:number};
const sameTable=(a:EditPosition,b:EditPosition)=>a.sectionIndex===b.sectionIndex&&a.parentParaIndex===b.parentParaIndex&&a.cellPath?.length===1&&b.cellPath?.length===1&&a.cellPath[0].controlIndex===b.cellPath[0].controlIndex;
const copy = <T>(value:T):T => structuredClone(value);
const sameBody=(a:EditPosition,b:EditPosition)=>!a.cellPath&&!b.cellPath&&a.sectionIndex===b.sectionIndex;
const sameParagraph = (a:EditPosition,b:EditPosition) => a.sectionIndex===b.sectionIndex&&a.paragraphIndex===b.paragraphIndex&&a.parentParaIndex===b.parentParaIndex&&JSON.stringify(a.cellPath)===JSON.stringify(b.cellPath);

/** Owns only the separately opened edit copy. Viewer workers cannot call this class. */
export class DocumentEditor {
  private position:EditPosition|null=null;
  private anchor:EditPosition|null=null;
  private pending:Partial<TextStyle>={};
  private cellLane:{row:number;col:number}|null=null;
  private undo:History[]=[];
  private redo:History[]=[];
  private revision=0;
  private pages:EditState['pages']|undefined;
  private image:{secIdx:number;paraIdx:number;controlIdx:number;pageIndex:number}|null=null;
  private maxHistory:number;
  private documents=new Set<HwpDocument>();
  get document(){return this.doc;}
  replaceDocument(doc:HwpDocument){this.documents.add(this.doc);this.documents.add(doc);this.transaction(()=>{this.doc=doc;this.position=null;this.anchor=null;this.image=null;});this.collectDocuments();}
  private collectDocuments(){const used=new Set([this.doc,...this.undo.map(h=>h.doc),...this.redo.map(h=>h.doc)]);for(const doc of this.documents)if(!used.has(doc)){doc.free();this.documents.delete(doc);}}
  dispose(){this.documents.add(this.doc);for(const doc of this.documents)doc.free();this.documents.clear();}
  constructor(private doc:HwpDocument,fileBytes:number,revision=0){this.revision=revision;this.maxHistory=Math.max(1,Math.min(20,Math.floor(64*1024*1024/Math.max(fileBytes,1))));}
  private path(p:EditPosition){return JSON.stringify(p.cellPath);}
  private length(p:EditPosition){return p.cellPath?this.doc.getCellParagraphLengthByPath(p.sectionIndex,p.parentParaIndex!,this.path(p)):this.doc.getParagraphLength(p.sectionIndex,p.paragraphIndex);}
  private text(p:EditPosition){return p.cellPath?this.doc.getTextInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),0,this.length(p)):this.doc.getTextRange(p.sectionIndex,p.paragraphIndex,0,this.length(p));}
  private rect(p:EditPosition):EditRect{return parse(p.cellPath?this.doc.getCursorRectByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),p.charOffset):this.doc.getCursorRect(p.sectionIndex,p.paragraphIndex,p.charOffset));}
  private style(p:EditPosition):TextStyle {
    const props=parse<TextStyle>(p.cellPath?this.doc.getCellCharPropertiesAtByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),p.charOffset):this.doc.getCharPropertiesAt(p.sectionIndex,p.paragraphIndex,p.charOffset));
    return {fontFamily:props.fontFamily,fontSize:props.fontSize/100,textColor:props.textColor,bold:!!props.bold,italic:!!props.italic,underline:!!props.underline};
  }
  private range(){const p=this.position!,a=this.anchor&&(sameParagraph(p,this.anchor)||sameBody(p,this.anchor))?this.anchor:p;const [first,last]=a.paragraphIndex<p.paragraphIndex||a.paragraphIndex===p.paragraphIndex&&a.charOffset<p.charOffset?[a,p]:[p,a];return {start:first.charOffset,end:last.charOffset,startPara:first.paragraphIndex,endPara:last.paragraphIndex,multi:first.paragraphIndex!==last.paragraphIndex};}

  private normalize(raw:EditPosition&{controlIndex?:number;cellIndex?:number;cellParaIndex?:number}):EditPosition {
    const p:EditPosition={sectionIndex:raw.sectionIndex,paragraphIndex:raw.paragraphIndex,charOffset:raw.charOffset};
    if(raw.parentParaIndex!==undefined){p.parentParaIndex=raw.parentParaIndex;p.cellPath=raw.cellPath??[{controlIndex:raw.controlIndex!,cellIndex:raw.cellIndex!,cellParaIndex:raw.cellParaIndex!}];}
    if(![p.sectionIndex,p.paragraphIndex,p.charOffset].every(n=>Number.isInteger(n)&&n>=0))throw new Error('이 위치에는 입력할 수 없습니다. 본문이나 표 안의 글자를 눌러 주세요.');
    return p;
  }
  private setPosition(p:EditPosition,extend=false){
    if(extend&&this.position){
      if(!sameParagraph(this.position,p)&&!sameBody(this.position,p)&&!sameTable(this.position,p))throw new Error('본문과 표 내부 사이를 가로지르는 선택은 지원하지 않습니다.');
      this.anchor??=copy(this.position);
    }else this.anchor=null;
    this.position=p;this.pending={};this.image=null;this.cellLane=null;
  }
  private controls(page:number){return parse<{controls:ControlLayout[]}>(this.doc.getPageControlLayout(page)).controls;}
  private selectedObject():EditObject|null {
    if(this.image){
      const r=this.image,match=(c:ControlLayout)=>c.type==='image'&&c.secIdx===r.secIdx&&c.paraIdx===r.paraIdx&&c.controlIdx===r.controlIdx;
      let layout=r.pageIndex<this.doc.pageCount()?this.controls(r.pageIndex).find(match):undefined;
      if(!layout)for(let page=0;page<this.doc.pageCount();page++){layout=this.controls(page).find(match);if(layout){r.pageIndex=page;break;}}
      if(!layout)return null;
      const props=parse<{width:number;height:number;treatAsChar:boolean;textWrap:string}>(this.doc.getPictureProperties(r.secIdx,r.paraIdx,r.controlIdx));
      const mode:ImageMode=props.treatAsChar?'inline':props.textWrap==='InFrontOfText'?'front':props.textWrap==='BehindText'?'behind':props.textWrap==='TopAndBottom'?'topBottom':'square';
      return {...layout,...r,type:'image',mode,width:props.width/75,height:props.height/75};
    }
    const p=this.position;if(!p?.cellPath||p.cellPath.length!==1)return null;
    const cell=p.cellPath[0],page=this.rect(p).pageIndex;
    const layout=this.controls(page).find(c=>c.type==='table'&&c.secIdx===p.sectionIndex&&c.paraIdx===p.parentParaIndex&&c.controlIdx===cell.controlIndex);
    if(!layout)return null;
    const info=parse<{row:number;col:number;rowSpan:number;colSpan:number}>(this.doc.getCellInfo(p.sectionIndex,p.parentParaIndex!,cell.controlIndex,cell.cellIndex));
    const props=parse<{tableWidth:number;tableHeight:number}>(this.doc.getTableProperties(p.sectionIndex,p.parentParaIndex!,cell.controlIndex));
    const dims=parse<{rowCount:number;colCount:number}>(this.doc.getTableDimensions(p.sectionIndex,p.parentParaIndex!,cell.controlIndex));
    return {...layout,type:'table',pageIndex:page,...info,...dims,cellIdx:cell.cellIndex,width:props.tableWidth/75,height:props.tableHeight/75,fillColor:parse<{fillColor:string}>(this.doc.getCellProperties(p.sectionIndex,p.parentParaIndex!,cell.controlIndex,cell.cellIndex)).fillColor,selectedCells:new Set(this.cellSelection().map(c=>c.cellIdx)).size};
  }
  private cellBoxes(p:EditPosition){return parse<CellBox[]>(this.doc.getTableCellBboxes(p.sectionIndex,p.parentParaIndex!,p.cellPath![0].controlIndex));}
  private cellSelection():CellBox[]{
    const p=this.position,a=this.anchor;if(!p||!a||!sameTable(p,a)||p.cellPath![0].cellIndex===a.cellPath![0].cellIndex)return [];
    const boxes=this.cellBoxes(p),first=boxes.find(b=>b.cellIdx===a.cellPath![0].cellIndex),last=boxes.find(b=>b.cellIdx===p.cellPath![0].cellIndex);if(!first||!last)return [];
    let r0=Math.min(first.row,last.row),c0=Math.min(first.col,last.col),r1=Math.max(first.row+first.rowSpan,last.row+last.rowSpan),c1=Math.max(first.col+first.colSpan,last.col+last.colSpan);
    for(let i=0;i<boxes.length;i++){const included=boxes.filter(b=>b.row<r1&&b.row+b.rowSpan>r0&&b.col<c1&&b.col+b.colSpan>c0);const next=[Math.min(...included.map(b=>b.row)),Math.min(...included.map(b=>b.col)),Math.max(...included.map(b=>b.row+b.rowSpan)),Math.max(...included.map(b=>b.col+b.colSpan))];if(next.join() === [r0,c0,r1,c1].join())break;[r0,c0,r1,c1]=next;}
    return boxes.filter(b=>b.row>=r0&&b.row<r1&&b.col>=c0&&b.col<c1);
  }
  private clearCells(){
    const cells=this.cellSelection(),p=this.position!;if(!cells.length)return;
    for(const cell of new Map(cells.map(c=>[c.cellIdx,c])).values()){const c=p.cellPath![0].controlIndex,last=this.doc.getCellParagraphCount(p.sectionIndex,p.parentParaIndex!,c,cell.cellIdx)-1;const path=JSON.stringify([{controlIndex:c,cellIndex:cell.cellIdx,cellParaIndex:last}]);const length=this.doc.getCellParagraphLengthByPath(p.sectionIndex,p.parentParaIndex!,path);this.doc.deleteRangeInCell(p.sectionIndex,p.parentParaIndex!,c,cell.cellIdx,0,0,last,length);}
    const first=cells[0];p.cellPath![0].cellIndex=first.cellIdx;p.cellPath![0].cellParaIndex=0;p.paragraphIndex=0;p.charOffset=0;this.anchor=null;
  }
  private bodyPosition(){
    if(this.position&&!this.position.cellPath&&!this.image)return copy(this.position);
    const o=this.selectedObject();const section=o?.secIdx??this.doc.getSectionCount()-1;let paragraph=o?o.paraIdx+1:this.doc.getParagraphCount(section)-1;
    if(paragraph>=this.doc.getParagraphCount(section)||this.bodyObjects(section,paragraph).length)this.doc.insertParagraph(section,paragraph);
    return {sectionIndex:section,paragraphIndex:paragraph,charOffset:0} as EditPosition;
  }
  private objectPosition(){
    const p=this.bodyPosition();
    // Keep the empty paragraph carrying a page break: the engine's object insertion replaces its host header.
    if(this.length(p)===0&&this.rect(p).pageIndex>0){this.doc.insertParagraph(p.sectionIndex,p.paragraphIndex+1);p.paragraphIndex++;p.charOffset=0;}
    return p;
  }
  private settlePastePosition(){
    const p=this.position;if(!p||p.cellPath)return;
    const table=this.bodyObjects(p.sectionIndex,p.paragraphIndex).find(c=>c.ctrlId==='tbl');
    if(table){this.setPosition({sectionIndex:p.sectionIndex,parentParaIndex:p.paragraphIndex,paragraphIndex:0,charOffset:0,cellPath:[{controlIndex:table.controlIndex,cellIndex:0,cellParaIndex:0}]});return;}
    if(this.bodyObjects(p.sectionIndex,p.paragraphIndex).some(c=>c.ctrlId==='gso'))for(let page=0;page<this.doc.pageCount();page++){const image=this.controls(page).find(c=>c.type==='image'&&c.secIdx===p.sectionIndex&&c.paraIdx===p.paragraphIndex);if(image){this.image={secIdx:image.secIdx,paraIdx:image.paraIdx,controlIdx:image.controlIdx,pageIndex:page};this.position=null;this.anchor=null;return;}}
    try{this.rect(p);}catch{const paragraph=p.paragraphIndex+1;this.doc.insertParagraph(p.sectionIndex,paragraph);this.setPosition({sectionIndex:p.sectionIndex,paragraphIndex:paragraph,charOffset:0});}
  }
  private resizeTable(s:number,p:number,c:number,width:number,height:number){
    const props=parse<{tableWidth:number;tableHeight:number}>(this.doc.getTableProperties(s,p,c));const dims=parse<{cellCount:number}>(this.doc.getTableDimensions(s,p,c));const boxes=parse<CellBox[]>(this.doc.getTableCellBboxes(s,p,c));
    this.doc.resizeTableCells(s,p,c,JSON.stringify(Array.from({length:dims.cellCount},(_,cellIdx)=>{const cell=parse<{width:number;height:number}>(this.doc.getCellProperties(s,p,c,cellIdx));return {cellIdx,widthDelta:Math.round(cell.width*(width*75/props.tableWidth-1)),heightDelta:Math.round((boxes.filter(b=>b.cellIdx===cellIdx).reduce((sum,b)=>sum+b.h*75,0)||cell.height)*(height*75/props.tableHeight-1))};})));
  }
  state():EditState {
    const p=this.position,r=p?this.range():null;
    let selection:EditRect[]=[];
    if(p&&r&&(r.multi||r.start!==r.end)){
      if(p.cellPath){const last=p.cellPath.at(-1)!;selection=parse(this.doc.getSelectionRectsInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),last.cellParaIndex,r.start,last.cellParaIndex,r.end));}
      else selection=parse(this.doc.getSelectionRects(p.sectionIndex,r.startPara,r.start,r.endPara,r.end));
    }
    const cells=this.cellSelection();if(cells.length)selection=cells.map(b=>({pageIndex:b.pageIndex,x:b.x,y:b.y,width:b.w,height:b.h}));
    if(!this.pages){
      const count=this.doc.pageCount();
      if(count<1||count>3000)throw new Error('편집 결과가 지원 페이지 수를 벗어났습니다.');
      this.pages=Array.from({length:count},(_,i)=>{const v=parse<{width:number;height:number}>(this.doc.getPageInfo(i));return {width:v.width,height:v.height};});
    }
    return {revision:this.revision,caret:p&&!this.image?this.rect(p):null,selection:this.image?[]:selection,style:{...(p?this.style(p):{fontFamily:'Noto Sans KR',fontSize:10,textColor:'#000000',bold:false,italic:false,underline:false}),...this.pending},canUndo:!!this.undo.length,canRedo:!!this.redo.length,pages:this.pages,object:this.selectedObject()};
  }
  private capture():History{return {doc:this.doc,snapshot:this.doc.saveSnapshot(),position:copy(this.position),anchor:copy(this.anchor)};}
  private discard(history:History[]){for(const entry of history)entry.doc.discardSnapshot(entry.snapshot);history.length=0;}
  private restore(h:History){this.doc=h.doc;this.doc.restoreSnapshot(h.snapshot);this.doc.discardSnapshot(h.snapshot);this.position=h.position;this.anchor=h.anchor;this.pending={};this.pages=undefined;this.image=null;this.cellLane=null;}
  private transaction(action:()=>void){
    const before=this.capture();
    try{action();this.pages=undefined;this.state();}catch(error){this.restore(before);throw error;}
    this.discard(this.redo);this.undo.push(before);
    while(this.undo.length>this.maxHistory){const old=this.undo.shift()!;old.doc.discardSnapshot(old.snapshot);}
    this.collectDocuments();
    this.revision++;
  }
  private applyStyle(p:EditPosition,start:number,end:number,style:Partial<TextStyle>){
    const props:Record<string,unknown>={};
    if(style.fontFamily)props.fontId=this.doc.findOrCreateFontId(style.fontFamily);
    if(style.fontSize!==undefined){if(!Number.isFinite(style.fontSize)||style.fontSize<6||style.fontSize>96)throw new Error('글자 크기는 6–96 pt로 입력해 주세요.');props.fontSize=Math.round(style.fontSize*100);}
    if(style.textColor!==undefined){if(!/^#[0-9a-f]{6}$/i.test(style.textColor))throw new Error('글자 색상을 확인해 주세요.');props.textColor=style.textColor;}
    for(const key of ['bold','italic','underline'] as const)if(style[key]!==undefined)props[key]=style[key];
    if(!Object.keys(props).length)return;
    if(p.cellPath)this.doc.applyCharFormatInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),start,end,JSON.stringify(props));
    else this.doc.applyCharFormat(p.sectionIndex,p.paragraphIndex,start,end,JSON.stringify(props));
    // rhwp 0.8.6's size-format path can retain an incorrect line origin after a page break.
    // Empty insertion rebuilds just this paragraph's text layout, without changing text or cursor.
    if(props.fontSize!==undefined){
      if(p.cellPath)this.doc.insertTextInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),start,'');
      else this.doc.insertText(p.sectionIndex,p.paragraphIndex,start,'');
    }
  }
  private deleteText(start:number,end:number){
    const range=this.range();
    if(range.multi){
      const p=this.position!;
      for(let paragraph=range.startPara;paragraph<=range.endPara;paragraph++)if(this.bodyObjects(p.sectionIndex,paragraph).length)throw new Error('표나 그림이 있는 문단을 포함한 삭제는 개체를 따로 선택해 주세요.');
      this.doc.deleteRange(p.sectionIndex,range.startPara,range.start,range.endPara,range.end);p.paragraphIndex=range.startPara;p.charOffset=range.start;this.anchor=null;return;
    }
    if(start===end)return;
    const p=this.position!;
    if(p.cellPath)this.doc.deleteTextInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),start,end-start);
    else {
      const positions=parse<number[]>(this.doc.getControlTextPositions(p.sectionIndex,p.paragraphIndex));
      if(this.bodyObjects(p.sectionIndex,p.paragraphIndex).some(control=>positions[control.controlIndex]>=start&&positions[control.controlIndex]<end))throw new Error('표나 도형 자체는 간단 편집에서 삭제할 수 없습니다.');
      this.doc.deleteText(p.sectionIndex,p.paragraphIndex,start,end-start);
    }
    p.charOffset=start;this.anchor=null;
  }
  private bodyObjects(section:number,paragraph:number){
    const offset=parse<number[]>(this.doc.getSectionStarts())[section];
    return parse<{list:number;para:number;ctrlId:string;controlIndex:number}[]>(this.doc.getControls()).filter(control=>control.list===0&&control.para===offset+paragraph&&!['secd','cold'].includes(control.ctrlId));
  }
  private split(){
    const p=this.position!;
    if(p.cellPath){const result=parse<{cellParaIdx?:number;paraIdx?:number}>(this.doc.splitParagraphInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),p.charOffset));const last=p.cellPath.at(-1)!;last.cellParaIndex=result.cellParaIdx??result.paraIdx??last.cellParaIndex+1;p.paragraphIndex=last.cellParaIndex;}
    else {const result=parse<{paraIdx:number}>(this.doc.splitParagraph(p.sectionIndex,p.paragraphIndex,p.charOffset));p.paragraphIndex=result.paraIdx;}
    p.charOffset=0;this.anchor=null;
  }
  private mergeBoundary(backward:boolean){
    const p=this.position!;
    if(p.cellPath){
      const last=p.cellPath.at(-1)!,index=last.cellParaIndex+(backward?0:1);
      if(index===0||index>=this.doc.getCellParagraphCountByPath(p.sectionIndex,p.parentParaIndex!,this.path(p)))return;
      this.transaction(()=>{last.cellParaIndex=index;const result=parse<{cellParaIdx?:number;paraIdx?:number;charOffset:number}>(this.doc.mergeParagraphInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p)));last.cellParaIndex=result.cellParaIdx??result.paraIdx??index-1;p.paragraphIndex=last.cellParaIndex;p.charOffset=result.charOffset;this.anchor=null;});
    }else{
      const index=p.paragraphIndex+(backward?0:1);
      if(index===0||index>=this.doc.getParagraphCount(p.sectionIndex))return;
      // Do not merge paragraphs hosting objects: keep table/shape structure intact.
      for(const paragraph of [index-1,index])if(this.bodyObjects(p.sectionIndex,paragraph).length)throw new Error('표나 도형 경계에서는 문단을 합칠 수 없습니다.');
      this.transaction(()=>{const result=parse<{paraIdx:number;charOffset:number}>(this.doc.mergeParagraph(p.sectionIndex,index));p.paragraphIndex=result.paraIdx;p.charOffset=result.charOffset;this.anchor=null;});
    }
  }
  private moveCell(key:string){
    const p=this.position!;if(!p.cellPath)return;
    const cells=parse<CellBox[]>(this.doc.getTableCellBboxesByPath(p.sectionIndex,p.parentParaIndex!,this.path(p)));
    const last=p.cellPath.at(-1)!,current=cells.find(cell=>cell.cellIdx===last.cellIndex);if(!current)return;
    const lane=this.cellLane??current;
    let row=Math.max(current.row,Math.min(current.row+current.rowSpan-1,lane.row)),col=Math.max(current.col,Math.min(current.col+current.colSpan-1,lane.col));
    if(key==='ArrowLeft')col=current.col-1;
    else if(key==='ArrowRight')col=current.col+current.colSpan;
    else if(key==='ArrowUp')row=current.row-1;
    else if(key==='ArrowDown')row=current.row+current.rowSpan;
    const target=cells.find(cell=>row>=cell.row&&row<cell.row+cell.rowSpan&&col>=cell.col&&col<cell.col+cell.colSpan);
    if(!target)return; // No wrapping or document mutation at a table edge.
    const next=copy(p);next.cellPath!.at(-1)!.cellIndex=target.cellIdx;next.cellPath!.at(-1)!.cellParaIndex=0;next.paragraphIndex=0;next.charOffset=0;
    this.setPosition(next);this.cellLane={row,col};
  }
  private moveHorizontal(direction:number){
    const p=copy(this.position!),length=this.length(p);
    if(direction<0&&p.charOffset>0)p.charOffset--;
    else if(direction>0&&p.charOffset<length)p.charOffset++;
    else if(!p.cellPath){const next=p.paragraphIndex+direction;if(next>=0&&next<this.doc.getParagraphCount(p.sectionIndex)){p.paragraphIndex=next;p.charOffset=direction<0?this.length(p):0;}}
    else {const last=p.cellPath.at(-1)!;const next=last.cellParaIndex+direction;if(next>=0&&next<this.doc.getCellParagraphCountByPath(p.sectionIndex,p.parentParaIndex!,this.path(p))){last.cellParaIndex=next;p.paragraphIndex=next;p.charOffset=direction<0?this.length(p):0;}}
    return p;
  }
  command(command:EditCommand):EditState {
    if(command.kind==='pick'){
      const image=this.controls(command.page).filter(c=>c.type==='image'&&command.x>=c.x&&command.x<=c.x+c.w&&command.y>=c.y&&command.y<=c.y+c.h).at(-1);
      if(image&&!command.extend&&!command.textOnly){this.image={secIdx:image.secIdx,paraIdx:image.paraIdx,controlIdx:image.controlIdx,pageIndex:command.page};this.anchor=null;return this.state();}
      const hf=parse<{hit:boolean}>(this.doc.hitTestHeaderFooter(command.page,command.x,command.y));
      if(hf.hit)throw new Error('현재 간단 편집은 본문과 표 안의 글자를 지원합니다.');
      let hit=this.normalize(parse(this.doc.hitTest(command.page,command.x,command.y)));
      if(hit.cellPath&&!command.extend){
        const tables=this.controls(command.page).filter(c=>c.type==='table');
        if(!tables.some(t=>command.x>=t.x&&command.x<=t.x+t.w&&command.y>=t.y&&command.y<=t.y+t.h)){
          const parent=hit.parentParaIndex!,section=hit.sectionIndex,table=tables.find(t=>t.paraIdx===parent&&t.secIdx===section);
          const after=!table||command.y>=table.y;let para=after?parent+1:parent-1;
          if(para<0||para>=this.doc.getParagraphCount(section)||this.bodyObjects(section,para).length){para=after?parent+1:parent;this.transaction(()=>{this.doc.insertParagraph(section,para);this.setPosition({sectionIndex:section,paragraphIndex:para,charOffset:0});});}
          hit={sectionIndex:section,paragraphIndex:para,charOffset:0};
        }
      }
      this.setPosition(hit,command.extend);
    }else if(command.kind==='undo'||command.kind==='redo'){
      const from=command.kind==='undo'?this.undo:this.redo,to=command.kind==='undo'?this.redo:this.undo;
      const entry=from.pop();if(entry){to.push(this.capture());this.restore(entry);this.revision++;}
    }else if(command.kind==='cellColor'){
      const p=this.position;if(!p?.cellPath||p.cellPath.length!==1)throw new Error('색을 바꿀 셀을 선택해 주세요.');
      if(!/^#[0-9a-f]{6}$/i.test(command.color))throw new Error('셀 색상을 확인해 주세요.');
      const cells=this.cellSelection(),ids=[...new Set(cells.length?cells.map(c=>c.cellIdx):[p.cellPath[0].cellIndex])];
      this.transaction(()=>{for(const id of ids)this.doc.setCellProperties(p.sectionIndex,p.parentParaIndex!,p.cellPath![0].controlIndex,id,JSON.stringify({...parse<Record<string,unknown>>(this.doc.getCellProperties(p.sectionIndex,p.parentParaIndex!,p.cellPath![0].controlIndex,id)),fillType:'solid',fillColor:command.color}));});
    }else if(command.kind==='newPage'){
      this.transaction(()=>{const section=this.doc.getSectionCount()-1;let para=this.doc.getParagraphCount(section)-1;if(this.bodyObjects(section,para).length){para++;this.doc.insertParagraph(section,para);}const result=parse<{paraIdx:number;charOffset:number}>(this.doc.insertPageBreak(section,para,this.doc.getParagraphLength(section,para)));this.setPosition({sectionIndex:section,paragraphIndex:result.paraIdx,charOffset:result.charOffset});});
    }else if(command.kind==='tableInsert'){
      if(!Number.isInteger(command.rows)||!Number.isInteger(command.cols)||command.rows<1||command.cols<1||command.rows>50||command.cols>50||command.rows*command.cols>400||!Number.isFinite(command.width)||!Number.isFinite(command.height)||command.width<command.cols*8||command.height<command.rows*8||command.width>3000||command.height>5000)throw new Error('표는 1–50행·열, 총 400셀 이하로 만들고 각 셀 크기를 8px 이상으로 지정해 주세요.');
      this.transaction(()=>{const p=this.objectPosition(),t=parse<{paraIdx:number;controlIdx:number}>(this.doc.createTable(p.sectionIndex,p.paragraphIndex,p.charOffset,command.rows,command.cols));this.resizeTable(p.sectionIndex,t.paraIdx,t.controlIdx,command.width,command.height);this.setPosition({sectionIndex:p.sectionIndex,parentParaIndex:t.paraIdx,paragraphIndex:0,charOffset:0,cellPath:[{controlIndex:t.controlIdx,cellIndex:0,cellParaIndex:0}]});});
    }else if(command.kind==='paste'){
      if(command.html.length>40_000_000)throw new Error('붙여넣기 내용이 너무 큽니다.');
      this.transaction(()=>{
        if(command.internal&&this.doc.clipboardHasControl()){
          const p=this.objectPosition(),r=parse<{paraIdx:number;controlIdx:number}>(this.doc.pasteControl(p.sectionIndex,p.paragraphIndex,p.charOffset));this.setPosition({sectionIndex:p.sectionIndex,paragraphIndex:r.paraIdx,charOffset:0});
        }else{
          if(!this.position||this.image)this.setPosition(this.bodyPosition());if(!this.position!.cellPath&&/<(?:table|img)\b/i.test(command.html))this.setPosition(this.objectPosition());this.clearCells();const p=this.position!,range=this.range();this.deleteText(range.start,range.end);
          const internal=command.internal&&this.doc.hasInternalClipboard();
          const result=parse<{paraIdx?:number;cellParaIdx?:number;charOffset:number}>(p.cellPath?(internal?this.doc.pasteInternalInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),p.charOffset):this.doc.pasteHtmlInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),p.charOffset,command.html)):(internal?this.doc.pasteInternal(p.sectionIndex,p.paragraphIndex,p.charOffset):this.doc.pasteHtml(p.sectionIndex,p.paragraphIndex,p.charOffset,command.html)));
          if(p.cellPath){p.cellPath.at(-1)!.cellParaIndex=result.cellParaIdx??p.cellPath.at(-1)!.cellParaIndex;p.paragraphIndex=p.cellPath.at(-1)!.cellParaIndex;}else p.paragraphIndex=result.paraIdx??p.paragraphIndex;p.charOffset=result.charOffset??0;this.anchor=null;
        }
        this.settlePastePosition();
      });
     }else if(command.kind==='cutImage'){
      const o=this.selectedObject();
      if(!o||o.type!=='image'||command.revision!==this.revision||o.secIdx!==command.secIdx||o.paraIdx!==command.paraIdx||o.controlIdx!==command.controlIdx)throw new Error('선택이 바뀌어 잘라내기를 취소했습니다.');
      this.transaction(()=>{this.doc.deletePictureControl(o.secIdx,o.paraIdx,o.controlIdx);this.setPosition({sectionIndex:o.secIdx,paragraphIndex:o.paraIdx,charOffset:0});});
    }else if(command.kind==='imageInsert'){

      if(!this.position)throw new Error('그림을 넣을 위치를 먼저 눌러 주세요.');
      let p=this.position;const r=this.rect(p);
      if(!Number.isFinite(command.width)||!Number.isFinite(command.height)||command.width<=0||command.height<=0||command.bytes.length>30_000_000)throw new Error('30 MB 이하의 유효한 그림을 선택해 주세요.');
      this.transaction(()=>{
        if(!p.cellPath)p=this.objectPosition();
        const width=Math.min(400,command.width),height=width*command.height/command.width;
        const result=parse<{paraIdx:number;controlIdx:number}>(this.doc.insertPicture(p.sectionIndex,p.parentParaIndex??p.paragraphIndex,p.charOffset,p.cellPath?this.path(p):'[]',command.bytes,Math.round(width*75),Math.round(height*75),command.width,command.height,command.extension,command.name,Math.round(r.x*75),Math.round(r.y*75)));
        this.image={secIdx:p.sectionIndex,paraIdx:result.paraIdx,controlIdx:result.controlIdx,pageIndex:r.pageIndex};
        this.doc.setPictureProperties(p.sectionIndex,result.paraIdx,result.controlIdx,JSON.stringify({treatAsChar:true}));
        this.position=null;this.anchor=null;
      });
    }else if(command.kind==='imageMode'||command.kind==='imageMove'||command.kind==='objectResize'||command.kind==='table'){
      const object=this.selectedObject();if(!object)throw new Error('그림이나 표를 먼저 선택해 주세요.');
      const {secIdx:s,paraIdx:p,controlIdx:c}=object;
      this.transaction(()=>{
        if(command.kind==='objectResize'){
          if(!Number.isFinite(command.width)||!Number.isFinite(command.height)||command.width<8||command.height<8||command.width>3000||command.height>5000)throw new Error('크기는 너비 8–3,000 px, 높이 8–5,000 px 범위로 설정해 주세요.');
          if(object.type==='image')this.doc.setPictureProperties(s,p,c,JSON.stringify({width:Math.round(command.width*75),height:Math.round(command.height*75)}));
          else {
            this.resizeTable(s,p,c,command.width,command.height);
          }
        }else if(command.kind==='imageMode'&&object.type==='image'){
          const wrap={inline:'Square',square:'Square',topBottom:'TopAndBottom',front:'InFrontOfText',behind:'BehindText'}[command.mode];
          this.doc.setPictureProperties(s,p,c,JSON.stringify({treatAsChar:command.mode==='inline',textWrap:wrap,...(command.mode==='inline'?{}:{horzRelTo:'Paper',vertRelTo:'Paper',horzAlign:'Left',vertAlign:'Top',horzOffset:Math.round(object.x*75),vertOffset:Math.round(object.y*75)})}));
        }else if(command.kind==='imageMove'&&object.type==='image'){
          if(!Number.isFinite(command.x)||!Number.isFinite(command.y))throw new Error('그림 위치를 확인해 주세요.');
          if(object.mode==='inline'){
            const drop=command.drop??{page:object.pageIndex,x:command.x,y:command.y};
            if(!Number.isInteger(drop.page)||!this.pages?.[drop.page]||!Number.isFinite(drop.x)||!Number.isFinite(drop.y))throw new Error('그림을 놓을 쪽을 확인해 주세요.');
            // Resolve the logical destination before removing the source and changing layout.
            const hit=this.normalize(parse<EditPosition>(this.doc.hitTest(drop.page,drop.x,drop.y)));
            let target:EditPosition=hit;
            const table=this.controls(drop.page).find(o=>o.type==='table'&&drop.x>=o.x&&drop.x<=o.x+o.w&&drop.y>=o.y&&drop.y<=o.y+o.h);
            let boundary:number|undefined;
            if(table||hit.cellPath){
              const parent=table?.paraIdx??hit.parentParaIndex!;
              boundary=parent+(table&&drop.y>=table.y+table.h/2?1:0);
              target={sectionIndex:table?.secIdx??hit.sectionIndex,paragraphIndex:boundary,charOffset:0};
            }
            // Native control copy preserves crop, rotation, captions and embedded image data.
            // The UI invalidates its internal-clipboard token after this operation.
            this.doc.copyControl(s,p,'[]',c);
            this.doc.deletePictureControl(s,p,c);
            if(boundary!==undefined)this.doc.insertParagraph(target.sectionIndex,boundary);
            this.setPosition(target);
            const insertion=this.objectPosition();
            const moved=parse<{paraIdx:number;controlIdx:number}>(this.doc.pasteControl(insertion.sectionIndex,insertion.paragraphIndex,insertion.charOffset));
            this.doc.setPictureProperties(insertion.sectionIndex,moved.paraIdx,moved.controlIdx,JSON.stringify({treatAsChar:true}));
            this.image={secIdx:insertion.sectionIndex,paraIdx:moved.paraIdx,controlIdx:moved.controlIdx,pageIndex:drop.page};this.position=null;this.anchor=null;
          }else{
          const page=this.pages![object.pageIndex];
          const x=Math.max(0,Math.min(page.width-object.w,command.x)),y=Math.max(0,Math.min(page.height-object.h,command.y));
          this.doc.setPictureProperties(s,p,c,JSON.stringify({treatAsChar:false,textWrap:object.mode==='front'?'InFrontOfText':object.mode==='behind'?'BehindText':object.mode==='topBottom'?'TopAndBottom':'Square',horzRelTo:'Paper',vertRelTo:'Paper',horzAlign:'Left',vertAlign:'Top',horzOffset:Math.round(x*75),vertOffset:Math.round(y*75)}));
          }
        }else if(command.kind==='table'&&object.type==='table'){
          const row=object.row!,col=object.col!;
          if(command.operation==='splitRows'||command.operation==='splitCols')this.doc.splitTableCellInto(s,p,c,row,col,command.operation==='splitRows'?2:1,command.operation==='splitCols'?2:1,true,false);
          else if(command.operation==='mergeRight'){
            if(col+object.colSpan!>=object.colCount!)throw new Error('오른쪽에 합칠 셀이 없습니다.');
            this.doc.mergeTableCells(s,p,c,row,col,row+object.rowSpan!-1,col+object.colSpan!);
          }else if(command.operation==='mergeDown'){
            if(row+object.rowSpan!>=object.rowCount!)throw new Error('아래쪽에 합칠 셀이 없습니다.');
            this.doc.mergeTableCells(s,p,c,row,col,row+object.rowSpan!,col+object.colSpan!-1);
          }else if(command.operation==='addRow')this.doc.insertTableRow(s,p,c,row,true);
          else if(command.operation==='addCol')this.doc.insertTableColumn(s,p,c,col,true);
          else if(command.operation==='splitTable')this.doc.splitTable(s,p,c,row);
          else this.doc.mergeTableWithNext(s,p,c);
          const cells=parse<{cellIdx:number;row:number;col:number}[]>(this.doc.getTableCellBboxes(s,p,c));const cell=cells.find(cell=>cell.row===row&&cell.col===col)??cells[0];
          this.position=cell?{sectionIndex:s,paragraphIndex:0,charOffset:0,parentParaIndex:p,cellPath:[{controlIndex:c,cellIndex:cell.cellIdx,cellParaIndex:0}]}:null;this.anchor=null;
        }else throw new Error('선택한 개체에는 이 기능을 적용할 수 없습니다.');
      });
    }else {
      if(!this.position)throw new Error('입력할 글자 위치를 먼저 눌러 주세요.');
      const p=this.position,r=this.range();
      if(command.kind==='fontSizeStep'){
        const ranges:{position:EditPosition;start:number;end:number}[]=[],cells=this.cellSelection();
        if(cells.length){for(const cell of new Map(cells.map(c=>[c.cellIdx,c])).values()){const control=p.cellPath![0].controlIndex,count=this.doc.getCellParagraphCount(p.sectionIndex,p.parentParaIndex!,control,cell.cellIdx);for(let i=0;i<count;i++){const position={...copy(p),paragraphIndex:i,charOffset:0,cellPath:[{controlIndex:control,cellIndex:cell.cellIdx,cellParaIndex:i}]};ranges.push({position,start:0,end:this.length(position)});}}}
        else if(r.multi){for(let i=r.startPara;i<=r.endPara;i++){const position={...copy(p),paragraphIndex:i};ranges.push({position,start:i===r.startPara?r.start:0,end:i===r.endPara?r.end:this.length(position)});}}
        else if(r.start!==r.end)ranges.push({position:copy(p),start:r.start,end:r.end});
        const changes:{position:EditPosition;start:number;end:number;fontSize:number}[]=[];
        for(const range of ranges){let run:typeof changes[number]|undefined;for(let i=range.start;i<range.end;i++){const current=this.style({...range.position,charOffset:i}).fontSize,fontSize=Math.max(6,Math.min(96,current+command.delta));if(fontSize===current){run=undefined;continue;}if(run&&run.end===i&&run.fontSize===fontSize)run.end=i+1;else{run={position:range.position,start:i,end:i+1,fontSize};changes.push(run);}}}
        if(changes.length)this.transaction(()=>{for(const change of changes)this.applyStyle(change.position,change.start,change.end,{fontSize:change.fontSize});});
      }else if(command.kind==='format'){
        if(this.cellSelection().length){this.transaction(()=>{for(const cell of new Map(this.cellSelection().map(c=>[c.cellIdx,c])).values()){const c=p.cellPath![0].controlIndex,count=this.doc.getCellParagraphCount(p.sectionIndex,p.parentParaIndex!,c,cell.cellIdx);for(let i=0;i<count;i++){const pos={...p,paragraphIndex:i,charOffset:0,cellPath:[{controlIndex:c,cellIndex:cell.cellIdx,cellParaIndex:i}]};this.applyStyle(pos,0,this.length(pos),command.style);}}});}
        else if(r.multi)this.transaction(()=>{for(let paragraph=r.startPara;paragraph<=r.endPara;paragraph++){const pos={...p,paragraphIndex:paragraph};this.applyStyle(pos,paragraph===r.startPara?r.start:0,paragraph===r.endPara?r.end:this.length(pos),command.style);}});
        else if(r.start===r.end)this.pending={...this.pending,...command.style};
        else this.transaction(()=>this.applyStyle(p,r.start,r.end,command.style));
      }else if(command.kind==='selectParagraph'){
        this.anchor={...copy(p),charOffset:0};p.charOffset=this.length(p);
      }else if(command.kind==='insert'){
        if(command.text.length>100_000)throw new Error('한 번에 입력할 수 있는 글자 수를 넘었습니다.');
        if(command.text)this.transaction(()=>{
          if(this.cellSelection().length){this.clearCells();r.start=0;r.end=0;}
          const style={...this.style(p),...this.pending};
          this.deleteText(r.start,r.end);p.charOffset=r.start;
          const lines=command.text.replace(/\r\n?/g,'\n').split('\n');
          for(let i=0;i<lines.length;i++){
            if(i)this.split();const start=p.charOffset,text=lines[i];
            if(text){
              const result=parse<{charOffset:number}>(p.cellPath?this.doc.insertTextInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),start,text):this.doc.insertText(p.sectionIndex,p.paragraphIndex,start,text));
              p.charOffset=result.charOffset;
              const inherited=this.style({...p,charOffset:start});
              const changes=Object.fromEntries(Object.entries(style).filter(([key,value])=>value!==inherited[key as keyof TextStyle])) as Partial<TextStyle>;
              this.applyStyle(p,start,p.charOffset,changes);
            }
          }
          this.anchor=null;
        });
      }else if(command.kind==='key'){
        if(command.ctrl&&p.cellPath&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(command.key)){this.moveCell(command.key);return this.state();}
        if(command.key==='Backspace'||command.key==='Delete'){
          if(this.cellSelection().length)this.transaction(()=>this.clearCells());
          else if(r.multi||r.start!==r.end)this.transaction(()=>this.deleteText(r.start,r.end));
          else if(command.key==='Backspace'&&p.charOffset>0)this.transaction(()=>this.deleteText(p.charOffset-1,p.charOffset));
          else if(command.key==='Delete'&&p.charOffset<this.length(p))this.transaction(()=>this.deleteText(p.charOffset,p.charOffset+1));
          else this.mergeBoundary(command.key==='Backspace');
        }else if(command.key==='Enter')this.transaction(()=>{if(this.cellSelection().length){this.clearCells();r.start=0;r.end=0;}this.deleteText(r.start,r.end);this.split();});
        else {
          let next=copy(p);
          if(command.key==='ArrowLeft'||command.key==='ArrowRight'){
            if(!command.extend&&(r.multi||r.start!==r.end)){next.paragraphIndex=command.key==='ArrowLeft'?r.startPara:r.endPara;next.charOffset=command.key==='ArrowLeft'?r.start:r.end;}
            else next=this.moveHorizontal(command.key==='ArrowLeft'?-1:1);
          }else if(command.key==='Home')next.charOffset=0;
          else if(command.key==='End')next.charOffset=this.length(p);
          else if(command.key==='ArrowUp'||command.key==='ArrowDown'){
            const delta=command.key==='ArrowUp'?-1:1;
            next=this.normalize(parse(p.cellPath?this.doc.moveVerticalByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),p.charOffset,delta,-1):this.doc.moveVerticalEx(JSON.stringify({sectionIdx:p.sectionIndex,paraIdx:p.paragraphIndex,charOffset:p.charOffset,delta,preferredX:-1}))));
          }
          this.setPosition(next,command.extend);
        }
      }
    }
    return this.state();
  }
  clipboard(forceObject=false):{text:string;html:string}{
    const p=this.position,o=this.selectedObject(),cells=this.cellSelection();
    if(cells.length&&!forceObject){
      this.doc.clearClipboard();const unique=[...new Map(cells.map(c=>[c.cellIdx,c])).values()],rows=[...new Set(unique.map(c=>c.row))].sort((a,b)=>a-b);let text='';
      const html='<table>'+rows.map(row=>{const cols=unique.filter(c=>c.row===row).sort((a,b)=>a.col-b.col);const texts:string[]=[];const tr='<tr>'+cols.map(c=>{const ctrl=p!.cellPath![0].controlIndex,count=this.doc.getCellParagraphCount(p!.sectionIndex,p!.parentParaIndex!,ctrl,c.cellIdx),path=JSON.stringify([{controlIndex:ctrl,cellIndex:c.cellIdx,cellParaIndex:count-1}]),length=this.doc.getCellParagraphLengthByPath(p!.sectionIndex,p!.parentParaIndex!,path),props=parse<{fillColor:string}>(this.doc.getCellProperties(p!.sectionIndex,p!.parentParaIndex!,ctrl,c.cellIdx));const content=this.doc.exportSelectionInCellHtml(p!.sectionIndex,p!.parentParaIndex!,ctrl,c.cellIdx,0,0,count-1,length).replace(/<\/?(?:html|body)[^>]*>/gi,'');texts.push(Array.from({length:count},(_,i)=>this.doc.getTextInCell(p!.sectionIndex,p!.parentParaIndex!,ctrl,c.cellIdx,i,0,100000)).join('\n'));return '<td rowspan="'+c.rowSpan+'" colspan="'+c.colSpan+'" style="background-color:'+props.fillColor+'">'+content+'</td>';}).join('')+'</tr>';text+=(text?'\n':'')+texts.join('\t');return tr;}).join('')+'</table>';return {text,html};
    }
    if(o&&(forceObject||o.type==='image'||!this.selectedText())){const result=parse<{text:string}>(this.doc.copyControl(o.secIdx,o.paraIdx,'[]',o.controlIdx));return {text:result.text,html:this.doc.exportControlHtml(o.secIdx,o.paraIdx,'[]',o.controlIdx)};}
    if(!p)return {text:'',html:''};const r=this.range();
    if(p.cellPath){const i=p.cellPath.at(-1)!.cellParaIndex;this.doc.copySelectionInCellByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),i,r.start,i,r.end);return {text:this.selectedText(),html:this.doc.exportSelectionInCellHtmlByPath(p.sectionIndex,p.parentParaIndex!,this.path(p),i,r.start,i,r.end)};}
    this.doc.copySelection(p.sectionIndex,r.startPara,r.start,r.endPara,r.end);return {text:this.selectedText(),html:this.doc.exportSelectionHtml(p.sectionIndex,r.startPara,r.start,r.endPara,r.end)};
  }
  selectedText(){if(!this.position)return '';const r=this.range();if(r.multi)return Array.from({length:r.endPara-r.startPara+1},(_,i)=>{const paragraph=r.startPara+i,pos={...this.position!,paragraphIndex:paragraph};return Array.from(this.text(pos)).slice(i===0?r.start:0,paragraph===r.endPara?r.end:undefined).join('');}).join('\n');return Array.from(this.text(this.position)).slice(r.start,r.end).join('');}
}
