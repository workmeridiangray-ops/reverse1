import { redirect } from 'next/navigation';
export default async function V({ params }: { params: Promise<{ projectId: string }> }) { redirect(`/p/${(await params).projectId}/e/variations`); }
