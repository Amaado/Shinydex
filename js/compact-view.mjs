/** Miniaturas de la Pokédex. Mantener separado del DOM para poder verificar la vista sin navegador. */
import {escapeHtml,GOALS} from './domain.mjs';

export const COMPACT_PAGE_SIZE=120;
export const STANDARD_PAGE_SIZE=24;

export function renderCompactCard(entry,{hasData=false,monochrome=true,portrait=()=>''}={}){
  const progress=Math.min(GOALS.length,Math.max(0,entry.completed?.size||0));
  const unregistered=Boolean(hasData&&progress===0);
  const normal=entry.form_key==='normal';
  const name=escapeHtml(entry.name);
  const form=escapeHtml(entry.form_label||'Forma normal');
  const number=String(entry.id).padStart(4,'0');
  const progressLabel=hasData?`${progress}/${GOALS.length}`:`—/${GOALS.length}`;
  const accessibleProgress=hasData?`${progress} de ${GOALS.length} objetivos completados`:'Progreso no sincronizado';
  return `<article class="mini-pokemon-card ${unregistered&&monochrome?'mini-monochrome':''} ${progress===GOALS.length&&hasData?'mini-complete':''}" data-unregistered="${unregistered}">
    <button type="button" class="mini-pokemon-hit" data-detail="${escapeHtml(entry.key)}" aria-label="#${number} ${name}, ${form}. ${accessibleProgress}. Abrir ficha" title="#${number} ${name}${normal?'':` · ${form}`} · ${progressLabel}">
      <span class="mini-dex" aria-hidden="true">#${number}</span>
      <span class="mini-portrait" aria-hidden="true">${portrait(entry)}</span>
      <span class="mini-name" aria-hidden="true">${name}</span>
      ${normal?'':`<span class="mini-form" aria-hidden="true">${form}</span>`}
      <span class="mini-progress ${progress>0?'mini-progress-earned':''}" aria-hidden="true">${progressLabel}</span>
    </button>
  </article>`;
}
