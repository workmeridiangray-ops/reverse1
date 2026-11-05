import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/Layout";
import { requireCtx } from "@/lib/server/auth";
import { createProject } from "../actions";

export const metadata = { title: "New project" };
export default async function NewProject() {
  await requireCtx("project.create");
  return (
    <>
      <PageHeader title="New project" description="A project starts at the tender stage; award it once the contract is approved." />
      <div className="max-w-xl">
        <ActionForm action={createProject} submitLabel="Create project" pendingLabel="Creating…">
          <TextField label="Project code" name="code" placeholder="P-001" />
          <TextField label="Project name" name="name" placeholder="Riverside Tower — Block A" />
          <TextField label="Client" name="client_name" />
          <TextField label="Site location" name="location" optional />
          <div className="grid gap-4 sm:grid-cols-2"><TextField label="Planned start" name="start_date" type="date" optional /><TextField label="Planned finish" name="end_date" type="date" optional /></div>
        </ActionForm>
      </div>
    </>
  );
}
