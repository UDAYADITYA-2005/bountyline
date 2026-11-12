import { Link } from 'react-router';
import { EmptyState } from '../components/ui/basics';

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      body="That page doesn't exist."
      action={
        <Link to="/" className="bl-touch inline-flex items-center font-semibold underline">
          Go home
        </Link>
      }
    />
  );
}
