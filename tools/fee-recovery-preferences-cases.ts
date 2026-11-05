/** Small synthetic LOCAL display/navigation cases; no held phase101 fixture dependency. */
import {recoveryReadingFixture} from './fee-recovery-review-cases';
import {FeeRecoveryFormat} from './fee-recovery-format';
import {FeeRecoveryReview} from './fee-recovery-review';
import {FeeRecoveryPreferences,PREFERENCE_GROUPS} from './fee-recovery-preferences';
export type PreferenceCase='supported'|'mixed'|'unknown-only'|'conflict'|'bad-number'|'unread-file'|'untrusted-target'|'drafts';
export function preferenceFixture(kind:PreferenceCase='supported'){
  const f=recoveryReadingFixture(kind==='bad-number'?'bad-number':kind==='unread-file'?'unread-file':kind==='drafts'?'drafts':'baseline');
  f.supplement.workflow.workspace_mode='professional';f.supplement.view.collapsed_sections=['goods','quote'];f.supplement.view.expanded_evidence_sections=['settlement','fee-envelope'];
  if(kind==='mixed'){(f.supplement.view.collapsed_sections as string[]).push('future-collapsed');(f.supplement.view.expanded_evidence_sections as string[]).push('<img onerror="window.preferenceExecuted103=true">');}
  if(kind==='unknown-only'){f.supplement.view.collapsed_sections=['unknown-collapsed'];f.supplement.view.expanded_evidence_sections=['unknown-expanded'];}
  if(kind==='conflict'){f.supplement.view.collapsed_sections=['advanced-settings'];f.supplement.view.expanded_evidence_sections=['advanced-settings'];}
  if(kind==='bad-number'||kind==='unread-file'||kind==='untrusted-target'){
    const p=f.supplement.pending_control;if(p){p.dataset=kind==='bad-number'?{path:'goods.quantity'}:{};p.id=kind==='unread-file'?'fee-tax-file-input':'synthetic-input103';
      const control={tag:p.tag,id:p.id,type:p.type,value:p.value,dataset:p.dataset,connected:p.connected};
      (f.parts.retained_root as Record<string,unknown>).pending_control=control;f.parts.capture_shell.editors.pending_input=JSON.stringify({pending_calculation:false,control});
    }
    if(kind==='untrusted-target'){
      const control={tag:'INPUT',id:'<img onerror="window.preferenceExecuted103=true">',type:'text',value:'PRIVATE_DRAFT103',dataset:{path:'__proto__.querySelector'},connected:true};
      (f.parts.retained_root as Record<string,unknown>).pending_control=control;f.parts.capture_shell.editors.pending_input=JSON.stringify({pending_calculation:false,control});f.supplement.pending_present=true;
      f.supplement.pending_control={...control,checked:false,selection_start:null,selection_end:null,selected_values:null,bad_input:false,validation_message:'',files:null};
    }
  }
  return f;
}
export async function preferenceWire(kind:PreferenceCase='supported'){const f=preferenceFixture(kind);return new FeeRecoveryFormat().encode(f.parts,f.supplement,new AbortController().signal,{captured_at:'2026-10-28T00:00:00.000Z'});}
export async function openPreferenceCase(kind:PreferenceCase='supported'){
  const raw=await preferenceWire(kind),review=new FeeRecoveryReview(),manifest=await review.stage(raw);review.confirm(manifest,'OPEN_ARCHIVE_READING_ONLY');return{raw,review,preferences:new FeeRecoveryPreferences(review)};
}
export async function probeRecoveryPreferences(){
  const cases=[];
  for(const kind of['supported','mixed','unknown-only','conflict','bad-number','unread-file','untrusted-target','drafts'] as const){
    const{review,preferences}=await openPreferenceCase(kind),archive=review.archive()!,source=archive.source_wire,supplement=archive.supplement_json,before=JSON.stringify(preferences.view());let refused=false;
    if(kind==='conflict'){try{await preferences.stage(PREFERENCE_GROUPS);}catch{refused=true;}}
    else{const candidate=await preferences.stage(PREFERENCE_GROUPS);preferences.confirm(candidate,'APPLY_SUPPORTED_DISPLAY_ONLY');}
    const guides=preferences.guides();for(const g of guides)if(g.destination!==null)preferences.navigate(g);
    cases.push({id:kind,guide_count:guides.length,checks:{source_exact:archive.source_wire===source&&archive.supplement_json===supplement,no_financial_write:preferences.state().financial_writes===0,no_customer_approval:preferences.state().customer_approval===false,
      explicit_only:kind==='conflict'?refused&&JSON.stringify(preferences.view())===before:preferences.view().display_applications===1,
      unknown_identifiers_ignored:!JSON.stringify(preferences.view()).includes('unknown-')&&!JSON.stringify(preferences.view()).includes('<img'),
      draft_not_installed:!JSON.stringify(preferences.view()).includes('PRIVATE_'),manual_unknown:kind!=='untrusted-target'||guides.length===1&&guides[0]!.destination===null,
      reentry_not_resolved:kind!=='bad-number'&&kind!=='unread-file'||review.state().input_reentry_required,
      review_still_open:review.state().phase==='OPEN',no_original_navigation:preferences.state().actual_workbench_navigation===false}});
    preferences.dispose();review.dispose();
  }
  return{scope:'INDEPENDENT_DISPLAY_AND_REENTRY',cases,production_integrated:false,financial_writes:0,customer_approval:false};
}
