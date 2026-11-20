import { Button, Card, EmptyState, PageHeader, Skeleton, usePhone } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';

type Saved = {
  id: string;
  name: string;
  summary: string;
  visibility: string;
};

export function ReportsHome({ navigate }: { navigate: Navigate }) {
  const phone = usePhone();
  const [ready, setReady] = useState<Saved[] | null>(null);
  const [mine, setMine] = useState<Saved[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/reports').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'Reports did not load.'));
        setReady([]);
        return;
      }
      const payload = body as { readyMade?: Saved[]; mine?: Saved[] };
      setReady(payload.readyMade ?? []);
      setMine(payload.mine ?? []);
    });
  }, [navigate]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Pick a ready-made report, or build one from the records you can see."
        actions={
          phone ? undefined : <Button onClick={() => navigate('/reports/new')}>New Report</Button>
        }
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {ready === null ? <Skeleton lines={4} /> : null}
      {ready && ready.length === 0 && mine.length === 0 && !error ? (
        <EmptyState title="No reports yet" body="Start with New Report and choose a data source." />
      ) : null}
      {ready && ready.length > 0 ? (
        <section className="report-home">
          <h2>Ready-Made Reports</h2>
          <div className="report-cards">
            {ready.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => navigate(`/reports/${report.id}`)}
              >
                <strong>{report.name}</strong>
                <span>{report.summary}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {mine.length > 0 ? (
        <section className="report-home">
          <h2>My Reports</h2>
          <Card>
            <ul className="report-mine">
              {mine.map((report) => (
                <li key={report.id}>
                  <button type="button" onClick={() => navigate(`/reports/${report.id}`)}>
                    <strong>{report.name}</strong>
                    <span>{report.summary}</span>
                  </button>
                  <span className="report-visibility">
                    {report.visibility === 'roles' ? 'Shared' : 'Private'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
