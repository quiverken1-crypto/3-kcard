import { getCardArtUrl } from './cardRenderer.js';

/** Visible combat cards first, then only the decks participating in this match. */
export function matchArtRequests(state, viewer) {
  const urls=new Map();
  const add=(cards,priority)=>{
    for(const card of cards || []) {
      const url=getCardArtUrl(card);
      if(url && (!urls.has(url) || priority==='high'))urls.set(url,priority);
    }
  };
  for(const seat of ['WEI','SHU'])add(state.battlefield?.support?.[seat]?.slots,'high');
  for(const zone of Object.values(state.battlefield?.frontline || {}))add(zone.units,'high');
  add(state.players?.[viewer]?.hand,'high');
  for(const seat of ['WEI','SHU']) {
    add(state.players?.[seat]?.hand,'low');
    add(state.players?.[seat]?.deck,'low');
  }
  return [...urls].map(([url,priority])=>({url,priority})).sort((a,b)=>(a.priority==='high'?0:1)-(b.priority==='high'?0:1));
}

export class MatchArtLoader {
  constructor(ImageType=globalThis.Image) {
    this.ImageType=ImageType;this.loaded=new Set();this.pending=new Map();this.queue=new Map();this.active=0;
  }
  update(state,viewer) {
    if(!this.ImageType)return;
    if(this.matchId!==state.matchId){this.queue.clear();this.matchId=state.matchId;}
    for(const item of matchArtRequests(state,viewer)) {
      if(this.loaded.has(item.url))continue;
      const pending=this.pending.get(item.url);
      if(pending){if(item.priority==='high')pending.fetchPriority='high';continue;}
      this.queue.set(item.url,item);
    }
    this.drain();
  }
  drain() {
    while(this.active<3 && this.queue.size) {
      const items=[...this.queue.values()];
      const item=items.find(i=>i.priority==='high') || items[0];
      this.queue.delete(item.url);
      const img=new this.ImageType();
      this.active++;this.pending.set(item.url,img);
      img.fetchPriority=item.priority;img.decoding='async';
      const done=()=>{
        if(!this.pending.has(item.url))return;
        this.loaded.add(item.url);this.pending.delete(item.url);this.active--;this.drain();
      };
      img.onload=img.onerror=done;img.src=item.url;
    }
  }
}
