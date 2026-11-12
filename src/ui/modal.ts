import { useLayoutEffect, useRef } from 'preact/hooks';

/** Clicks this soon after opening never close the dialog: the second click of a double-click. */
const OPEN_GRACE_MS = 400;

interface ModalOptions {
  /** Element inside the dialog that gets focus when it opens. */
  readonly focusSelector: string;
  /** Turn the app state off (Escape, backdrop click). Must be safe to call twice. */
  readonly onDismiss: () => void;
  /** Where focus goes when the element that opened the dialog is gone. */
  readonly fallbackFocus?: () => HTMLElement | null;
}

/** The control whose click is opening a dialog right now; see openedBy(). */
let opener: HTMLElement | null = null;
let forgetting = false;

function forget(): void {
  opener = null;
}

/**
 * Call from the click handler that opens a dialog: focus goes back to that control when
 * the dialog closes. The focused element cannot tell, because Safari does not focus a
 * button that is clicked or tapped.
 *
 * The dialog that opens next takes the control, however late it renders. A control whose
 * click opened nothing is forgotten on the next pointerdown or keydown (listened to on the
 * window in the capture phase, so before the press reaches any control): a click, a tap
 * and Enter or Space all start with one, so a later dialog never gets it. An open with no
 * input at all before it would still get it; no such open exists, because every control
 * that opens a dialog calls this.
 */
export function openedBy(ev: Event): void {
  opener = ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
  if (!forgetting) {
    forgetting = true;
    window.addEventListener('pointerdown', forget, true);
    window.addEventListener('keydown', forget, true);
  }
}

function onBackdrop(dlg: HTMLDialogElement, ev: MouseEvent): boolean {
  if (ev.target !== dlg) return false;
  const r = dlg.getBoundingClientRect();
  return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
}

/**
 * Shared behaviour of the modal dialogs: showModal() with focus inside, Escape closes,
 * a click on the backdrop closes, focus goes back where it came from.
 */
export function useModalDialog(isOpen: boolean, options: ModalOptions) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const openedAt = useRef(0);
  const downOnBackdrop = useRef(false);
  const opts = useRef(options);
  opts.current = options;

  // Layout effect: the dialog opens in the same task as the click, not a frame later.
  useLayoutEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnTo.current = opener ?? active;
      opener = null;
      dlg.showModal();
      openedAt.current = performance.now();
      document.documentElement.classList.add('has-modal');
      dlg.querySelector<HTMLElement>(opts.current.focusSelector)?.focus();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  return {
    ref,
    onPointerDown(ev: PointerEvent) {
      downOnBackdrop.current = onBackdrop(ev.currentTarget as HTMLDialogElement, ev);
    },
    onClick(ev: MouseEvent) {
      // Close only when the press started AND ended on the backdrop, so dragging a text
      // selection out of the dialog keeps it open.
      const started = downOnBackdrop.current;
      downOnBackdrop.current = false;
      if (!started || !onBackdrop(ev.currentTarget as HTMLDialogElement, ev)) return;
      if (ev.detail > 1 || performance.now() - openedAt.current < OPEN_GRACE_MS) return;
      opts.current.onDismiss();
    },
    onClose() {
      document.documentElement.classList.remove('has-modal');
      opts.current.onDismiss();
      const back = returnTo.current;
      returnTo.current = null;
      const target = back?.isConnected ? back : (opts.current.fallbackFocus?.() ?? null);
      target?.focus();
    },
  };
}
