type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function TeacherReportSessionPage({ params }: PageProps) {
  const { sessionId } = await params;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Session Report: {sessionId}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Report scaffolded for v2</p>
    </div>
  );
}
