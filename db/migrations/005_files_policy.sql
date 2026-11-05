-- External users may only read files that belong to a drawing revision they can see (approved ones).
DROP POLICY p_files ON files;
CREATE POLICY p_files ON files FOR SELECT USING (tenant_id = app_tenant() AND (project_id IS NULL OR project_visible(project_id)) AND
  (NOT is_external() OR EXISTS (SELECT 1 FROM drawing_revisions r WHERE r.file_id = files.id)));
CREATE POLICY p_files_w ON files FOR INSERT WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
