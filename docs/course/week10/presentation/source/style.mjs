import {fileURLToPath} from 'node:url';

export const ROOT=fileURLToPath(new URL('../../../../../',import.meta.url));

const C={ink:'#122C35',deep:'#102A33',white:'#FFFFFF',paper:'#F7F6F1',muted:'#50676C',line:'#D4DEDA',mint:'#8FF0CB',teal:'#08786E',pale:'#E0F2E9',amber:'#9D5F22',soft:'#D1E0DF',mid:'#294750'};

const F='Microsoft YaHei';

let seq=0;

function shape(s,x,y,w,h,fill='none',stroke='none',radius=0,sw=1){return s.shapes.add({name:`shape-${++seq}`,geometry:radius?'roundRect':'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:sw,style:'solid'},...(radius?{borderRadius:radius}:{})});}

function text(s,t,x,y,w,h,size=24,color=C.ink,bold=false,align='left'){

 const a=shape(s,x,y,w,h); a.text=t; a.text.style={fontSize:size,typeface:F,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'none',wrap:'square',insets:0}; return a;

}

function line(s,x,y,w,color=C.line,sw=1){return shape(s,x,y,w,sw,color);}

function dot(s,x,y,r,fill){return s.shapes.add({name:`dot-${++seq}`,geometry:'ellipse',position:{left:x,top:y,width:r,height:r},fill,line:{fill:'none',width:0}});}

function pill(s,t,x,y,w,fill=C.pale,color=C.teal,fs=18){shape(s,x,y,w,34,fill,'none',17);text(s,t,x+12,y,w-24,34,fs,color,true,'center');}

function arrow(s,x,y,w=28,col=C.teal){return s.shapes.add({name:`arrow-${++seq}`,geometry:'rightArrow',position:{left:x,top:y,width:w,height:15},fill:col,line:{fill:'none',width:0}});}

function cursor(s,x,y,k=1,color=C.mint){return s.shapes.add({name:`cursor-${++seq}`,geometry:'custom',position:{left:x,top:y,width:44*k,height:57*k},fill:color,line:{fill:C.deep,width:2},customPaths:[{width:44,height:57,commands:[{moveTo:{x:2,y:2}},{lineTo:{x:39,y:27}},{lineTo:{x:24,y:30}},{lineTo:{x:33,y:49}},{lineTo:{x:24,y:54}},{lineTo:{x:15,y:34}},{lineTo:{x:4,y:46}},{close:{}}]}]});}

function footer(s,i,dark=false){line(s,64,665,1152,dark?C.mid:C.line);text(s,'WebGuide AI',64,678,230,20,14,dark?C.soft:C.muted);text(s,String(i).padStart(2,'0'),1116,674,100,26,16,dark?C.soft:C.muted,false,'right');}

function heading(s,i,title,sub='',dark=false){s.background.fill=dark?C.deep:C.paper;text(s,title,64,59,1148,66,42,dark?C.white:C.ink,true);if(sub)text(s,sub,65,133,1140,34,21,dark?C.soft:C.muted);footer(s,i,dark);}

function browser(s,x,y,w,h,title='github.com / team / repository',dark=false){shape(s,x,y,w,h,dark?C.mid:C.white,dark?'#42606A':C.line,14);shape(s,x,y,w,42,dark?'#36535B':'#EDF1EE','none',14);shape(s,x,y+25,w,17,dark?'#36535B':'#EDF1EE');for(let k=0;k<3;k++)dot(s,x+17+k*16,y+17,7,dark?'#87A3A8':'#AEC0BA');text(s,title,x+82,y+5,w-103,31,15,dark?C.soft:C.muted);}

export {C,F,shape,text,line,dot,pill,arrow,cursor,footer,heading,browser};
