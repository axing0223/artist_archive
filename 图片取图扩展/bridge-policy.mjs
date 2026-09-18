export function allowedSender(sender,id){
  try{return sender.id===id&&Number.isInteger(sender.tab?.id)&&sender.frameId===0&&new URL(sender.url).protocol==='file:';}catch{return false;}
}
