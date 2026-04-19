type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function TeacherDashboardSessionPage({ params }: PageProps) {
  const { sessionId } = await params;

  return (
    <div className="p-6">
      <div className="max-w-xl rounded-lg border border-border p-4">
        <h1 className="text-xl font-semibold">Session Dashboard: {sessionId}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Dashboard scaffolded for v2</p>
      </div>
    </div>
  );
}
