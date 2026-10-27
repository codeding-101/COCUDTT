/** Small complete-profile synthetic case; no business approval or production restore authority. */
import {feeRecoveryFixture} from './fee-recovery-cases';
import {sampleProjectFile} from '../src/data/sample-project';
import {serializeProject} from '../src/data/project-file';
import {booksToRows} from '../src/ui/fx-rows';
export function feeReopenFixture(){
 const f=feeRecoveryFixture(),project=sampleProjectFile(),rows=booksToRows(project.fx_books),r=f.parts.retained_root as Record<string,unknown>;
 r.project_raw=project;r.project_file={name:null,saved_at:null,dirty:true,saved_raw_known:false};
 f.supplement.workflow.state_initialized=true;f.parts.capture_shell.sources.project_json=serializeProject(project);
 f.parts.capture_shell.fx={rows_json:JSON.stringify(rows),preserved_row_key:JSON.stringify(rows),preserved_books_json:JSON.stringify(project.fx_books)};
 return f;
}
