import { ClerkProvider, useAuth } from '@clerk/react';
import { StrictMode } from 'react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type AuthState } from './App';
import { setAuthTokenProvider } from './lib/api';
import './styles.css';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const unauthenticatedState: AuthState = {
  enabled: false,
  loaded: true,
  signedIn: true,
};

function ClerkSessionApp() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setAuthTokenProvider(undefined);
      return;
    }

    setAuthTokenProvider(() => getToken());
    return () => setAuthTokenProvider(undefined);
  }, [getToken, isLoaded, isSignedIn]);

  return (
    <App
      auth={{
        enabled: true,
        loaded: isLoaded,
        signedIn: Boolean(isSignedIn),
      }}
    />
  );
}

const app = clerkPublishableKey ? (
  <ClerkProvider publishableKey={clerkPublishableKey}>
    <ClerkSessionApp />
  </ClerkProvider>
) : (
  <App auth={unauthenticatedState} />
);

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
