import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { Loading } from './components/ui/basics';
import { AppLayout } from './screens/app-layout';
import { LoginScreen, RegisterScreen } from './screens/auth/auth-screens';
import { CaptureScreen } from './screens/claim/capture-screen';
import { ClaimScreen } from './screens/claim/claim-screen';
import { MyClaimsScreen } from './screens/claim/my-claims-screen';
import { StartClaimScreen } from './screens/claim/start-claim-screen';
import { JudgeHub } from './screens/judge/judge-hub';
import { LandingScreen } from './screens/landing-screen';
import { NotFound } from './screens/not-found';

// The desk pulls in AG Studio, so it loads only when a manager opens it.
const DeskScreen = lazy(() => import('./screens/desk/desk-screen'));

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <LandingScreen /> },
      { path: '/judge', element: <JudgeHub /> },
      { path: '/login', element: <LoginScreen /> },
      { path: '/register', element: <RegisterScreen /> },
      { path: '/claim', element: <StartClaimScreen /> },
      { path: '/claim/:id', element: <ClaimScreen /> },
      { path: '/claim/:id/capture', element: <CaptureScreen /> },
      { path: '/me', element: <MyClaimsScreen /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/desk',
    element: (
      <Suspense fallback={<Loading label="Loading the desk…" />}>
        <DeskScreen />
      </Suspense>
    ),
  },
]);
