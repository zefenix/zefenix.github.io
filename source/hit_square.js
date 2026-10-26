// The phone rig's sampled hit square, copied unchanged from its sampler.js. A square centred on the control grows
// until a sampled point no longer hits it; the passed span is the lower bound, the failed point the upper bound.
function hitSquare(element,cap=64){
 const r=element.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;
 const inset=1/32,axis=[0];let lowerBound=0,nominalSide=0,samples=0,probeKind='centre';
 const hits=(x,y)=>{
  samples++;
  if(x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
  const target=document.elementFromPoint(x,y);return !!target&&(target===element||element.contains(target));
 };
 const finish=(upperBound,failedPoint)=>({lowerBound,upperBound,nominalSide,probeKind,cap,boundaryInset:inset,nominalResolution:1,maximumPointSpacing:.5,samples,failedPoint,contract44:lowerBound>=44?'pass':upperBound<44?'below':'uncertain'});
 if(!hits(cx,cy))return finish(0,{x:cx,y:cy,offsetX:0,offsetY:0});
 const candidates=Array.from({length:cap},(_,i)=>({radius:(i+1)/2-inset,nominal:i+1,kind:'inset'}));
 if(cap>44)candidates.push({radius:22,nominal:44,kind:'exact threshold'});
 candidates.push({radius:cap/2,nominal:cap,kind:'exact cap'});
 candidates.sort((a,b)=>a.radius-b.radius);
 for(const {radius,nominal,kind}of candidates){
  const expanded=[...axis,-radius,radius];
  for(const offset of expanded)for(const [x,y]of [[-radius,offset],[radius,offset],[offset,-radius],[offset,radius]]){
   if(!hits(cx+x,cy+y))return finish(radius*2,{x:cx+x,y:cy+y,offsetX:x,offsetY:y});
  }
  axis.push(-radius,radius);lowerBound=radius*2;nominalSide=nominal;probeKind=kind;
 }
 return finish(cap,null);
}
module.exports={hitSquare};
