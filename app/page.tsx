import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const Dashboard = dynamic(() => import('@/components/Dashboard'), {
  ssr: false,
  loading: () => <LoadingState />,
});

function LoadingState() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#080c14',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '24px',
            height: '24px',
            border: '2px solid rgba(2, 132, 199, 0.2)',
            borderTopColor: '#0284c7',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span style={{ fontSize: '13px', fontWeight: '500', color: '#64748b' }}>
          Loading Swarm Hub...
        </span>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Dashboard />
    </Suspense>
  );
}

