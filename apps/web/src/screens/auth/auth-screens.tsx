import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../../api/client';
import { useLogin, useRegister } from '../../api/hooks';
import { Button, ErrorNote } from '../../components/ui/basics';

function Field(props: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="block font-semibold">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        required
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="bl-touch mt-1 w-full rounded-md border border-line bg-surface px-3 text-base"
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
      />
      {props.hint ? (
        <p id={`${props.id}-hint`} className="mt-1 text-sm text-muted">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-line bg-surface p-6 shadow-card">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function LoginScreen() {
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function submit(e: FormEvent): void {
    e.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: (r) => void navigate(r.user.role === 'manager' ? '/desk' : '/claim') },
    );
  }

  return (
    <Card title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {login.error ? <ErrorNote message={errorMessage(login.error)} /> : null}
        <Button type="submit" disabled={login.isPending} className="w-full">
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        New here?{' '}
        <Link to="/register" className="font-semibold underline">
          Create an account
        </Link>{' '}
        or try{' '}
        <Link to="/judge" className="font-semibold underline">
          Judge mode
        </Link>
        .
      </p>
    </Card>
  );
}

export function RegisterScreen() {
  const register = useRegister();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: '', displayName: '', password: '', paypalEmail: '' });
  const [age, setAge] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  function submit(e: FormEvent): void {
    e.preventDefault();
    register.mutate({ ...f, ageAttested: age }, { onSuccess: () => void navigate('/claim') });
  }

  return (
    <Card title="Create a claimant account">
      <form onSubmit={submit} className="space-y-4">
        <Field
          id="displayName"
          label="Name"
          value={f.displayName}
          onChange={set('displayName')}
          autoComplete="name"
        />
        <Field
          id="email"
          label="Email"
          type="email"
          value={f.email}
          onChange={set('email')}
          autoComplete="email"
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={f.password}
          onChange={set('password')}
          autoComplete="new-password"
          hint="At least 10 characters."
        />
        <Field
          id="paypalEmail"
          label="PayPal email for rewards"
          type="email"
          value={f.paypalEmail}
          onChange={set('paypalEmail')}
          hint="Approved claims are paid to this PayPal account (sandbox in this demo)."
        />
        <label className="bl-touch flex items-center gap-3">
          <input
            type="checkbox"
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
            className="h-6 w-6"
          />
          <span>I am 17 or older (required by some programs)</span>
        </label>
        {register.error ? <ErrorNote message={errorMessage(register.error)} /> : null}
        <Button type="submit" disabled={register.isPending} className="w-full">
          {register.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </Card>
  );
}
