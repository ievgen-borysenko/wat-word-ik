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
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
