// A tiny event bus between the desk shell and the custom widgets. Studio renders widgets through
// its own component wrapper, so widgets talk to the shell through window events rather than
// relying on React context reaching them.

const CHANGED = 'bountyline:desk-changed';
const SELECT = 'bountyline:select-claim';

/** Tells every desk view that a claim moved, so Studio and the widgets reload. */
export function emitDeskChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

export function onDeskChanged(handler: () => void): () => void {
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}

/** Opens a claim in the evidence widget and the review drawer. */
export function emitSelectClaim(claimId: string): void {
  window.dispatchEvent(new CustomEvent<string>(SELECT, { detail: claimId }));
}

export function onSelectClaim(handler: (claimId: string) => void): () => void {
  const listener = (e: Event): void => {
    if (e instanceof CustomEvent && typeof e.detail === 'string') handler(e.detail);
  };
  window.addEventListener(SELECT, listener);
  return () => window.removeEventListener(SELECT, listener);
}
