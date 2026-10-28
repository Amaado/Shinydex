// Identificadores estables para los objetivos adicionales.
// La captura shiny sin tamaño específico satisface la base de PvP; XXS y XXL
// la satisfacen también, sin confundirla con el tamaño genérico.
import {GOALS, matchedGoals} from './domain.mjs';
export const PVP_SIZES=Object.freeze(['','XXS','XXL']);
export const pvpVariantKey=(league,destinationKey,size='')=>`${league}:${destinationKey}${size?`#${size}`:''}`;
export const costumeGoalKey=(rowKey,goal)=>`${rowKey}#${goal}`;
export const isCostumeRow=row=>row.kind==='costume'||row.kind==='both';
export const goalIdsForCapture=capture=>matchedGoals(capture);
export function pvpMarkValid(target,record,size='') {
  return Boolean(record&&typeof record==='object'&&Array.isArray(record.iv)&&record.iv.length===3
    &&record.iv.every((v,i)=>v===target.iv[i])
    &&target.candidates.some(candidate=>candidate.key===record.candidateKey)
    &&(!('size' in record)||['','XXS','XS','M','XL','XXL'].includes(record.size))
    &&(!size||record.size===size));
}
export function pvpCompletedSizes(league,target,local,remote){
  return PVP_SIZES.filter(size=>{
    const key=pvpVariantKey(league,target.destination.key,size);
    if(size)return Boolean(local[key]||remote[key]);
    return Boolean(local[key]||remote[key]||['XXS','XXL'].some(s=>local[pvpVariantKey(league,target.destination.key,s)]||remote[pvpVariantKey(league,target.destination.key,s)]));
  });
}
export function costumeCompletedGoals(row,local,remote){
  if(!isCostumeRow(row))return [];
  return GOALS.map(g=>g.id).filter(goal=>Boolean(local[costumeGoalKey(row.key,goal)]||remote[costumeGoalKey(row.key,goal)]));
}
export function costumeGoalTotals(rows,local,remote){
  const total=rows.reduce((sum,row)=>sum+(isCostumeRow(row)?GOALS.length:1),0);
  const done=rows.reduce((sum,row)=>sum+(isCostumeRow(row)?costumeCompletedGoals(row,local,remote).length:Number(Boolean(local[row.key]?.date||remote[row.key]?.date))),0);
  return {done,total};
}
export function validCostumeBackupKey(key){
  return /^(?:c:seed:\d+:[a-z0-9-]+|c:external:[a-z0-9_-]+|b:[a-z0-9_-]+:[a-z0-9_-]+)(?:#(?:shundo|shundo_xxs|shundo_xxl|snundo_l1|snundo_xxs|snundo_xxl|snundo_xxs_l1|snundo_xxl_l1))?$/.test(key);
}
