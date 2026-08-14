const DIALOG_KINDS = new Set(['info', 'warning', 'confirm', 'destructive']);

export function normalizeDialogOptions(options = {}) {
  const kind = DIALOG_KINDS.has(options.kind) ? options.kind : 'info';
  const showCancel = Boolean(options.showCancel);
  return {
    kind,
    title: String(options.title || (showCancel ? 'Confirm Action' : 'ForgeOps Notice')),
    message: String(options.message || ''),
    primaryButtonText: String(options.primaryButtonText || (showCancel ? 'Continue' : 'OK')),
    cancelButtonText: String(options.cancelButtonText || 'Cancel'),
    showCancel,
    allowEscape: options.allowEscape !== false,
    allowBackdropCancel: options.allowBackdropCancel !== false,
    focusPrimary: Boolean(options.focusPrimary),
  };
}

export function createDialogSettlement(onSettle) {
  let settled = false;
  return value => {
    if (settled) return false;
    settled = true;
    onSettle(value);
    return true;
  };
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(element => !element.closest('.hidden'));
}

export function createForgeOpsDialogController(documentRef = globalThis.document) {
  const pending = [];
  let active = false;
  let sequence = 0;

  function renderRequest(rawOptions) {
    const options = normalizeDialogOptions(rawOptions);
    const dialogId = `forgeopsAppDialog${++sequence}`;
    const opener = documentRef.activeElement;
    const inertStates = [];

    return new Promise(resolve => {
      const backdrop = documentRef.createElement('div');
      backdrop.className = `modal-backdrop app-dialog-backdrop app-dialog-${options.kind}`;
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-labelledby', `${dialogId}Title`);
      backdrop.setAttribute('aria-describedby', `${dialogId}Message`);

      const card = documentRef.createElement('section');
      card.className = 'modal-card app-dialog-card';
      card.setAttribute('tabindex', '-1');

      const header = documentRef.createElement('header');
      header.className = 'app-dialog-header';
      const icon = documentRef.createElement('span');
      icon.className = 'app-dialog-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = options.kind === 'destructive' ? '!' : options.kind === 'warning' ? '!' : 'i';
      const heading = documentRef.createElement('h2');
      heading.id = `${dialogId}Title`;
      heading.textContent = options.title;
      header.append(icon, heading);

      const body = documentRef.createElement('div');
      body.className = 'app-dialog-body';
      const message = documentRef.createElement('p');
      message.id = `${dialogId}Message`;
      message.className = 'app-dialog-message';
      message.textContent = options.message;
      body.appendChild(message);

      const actions = documentRef.createElement('div');
      actions.className = 'modal-actions app-dialog-actions';
      let cancelButton = null;
      if (options.showCancel) {
        cancelButton = documentRef.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'ghost app-dialog-cancel';
        cancelButton.textContent = options.cancelButtonText;
        actions.appendChild(cancelButton);
      }
      const primaryButton = documentRef.createElement('button');
      primaryButton.type = 'button';
      primaryButton.className = options.kind === 'destructive'
        ? 'app-dialog-primary app-dialog-danger-button'
        : 'primary app-dialog-primary';
      primaryButton.textContent = options.primaryButtonText;
      actions.appendChild(primaryButton);

      card.append(header, body, actions);
      backdrop.appendChild(card);

      const restoreBackground = () => {
        inertStates.forEach(({element, inert}) => {
          if (inert) element.setAttribute('inert', '');
          else element.removeAttribute('inert');
        });
      };
      const cleanup = () => {
        documentRef.removeEventListener('keydown', onKeydown, true);
        backdrop.remove();
        restoreBackground();
        if (opener?.isConnected && typeof opener.focus === 'function') {
          setTimeout(() => opener.focus(), 0);
        }
      };
      const settle = createDialogSettlement(value => {
        primaryButton.disabled = true;
        if (cancelButton) cancelButton.disabled = true;
        cleanup();
        resolve(value);
      });
      const cancel = () => settle(false);

      const onKeydown = event => {
        if (event.key === 'Escape' && options.allowEscape) {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancel();
          return;
        }
        if (event.key !== 'Tab') return;
        event.stopImmediatePropagation();
        const focusable = focusableElements(card);
        if (!focusable.length) {
          event.preventDefault();
          card.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && documentRef.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && documentRef.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      primaryButton.addEventListener('click', () => settle(true));
      cancelButton?.addEventListener('click', cancel);
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop && options.allowBackdropCancel) cancel();
      });
      documentRef.addEventListener('keydown', onKeydown, true);

      [...documentRef.body.children].forEach(element => {
        inertStates.push({element, inert: element.hasAttribute('inert')});
        element.setAttribute('inert', '');
      });
      documentRef.body.appendChild(backdrop);
      setTimeout(() => {
        const initialFocus = options.focusPrimary || !cancelButton ? primaryButton : cancelButton;
        initialFocus.focus();
      }, 0);
    });
  }

  function pump() {
    if (active || !pending.length) return;
    active = true;
    const request = pending.shift();
    renderRequest(request.options).then(value => {
      request.resolve(value);
      active = false;
      pump();
    });
  }

  function enqueue(options) {
    return new Promise(resolve => {
      pending.push({options, resolve});
      pump();
    });
  }

  return {
    ask(options = {}) {
      return enqueue({...options, showCancel: true});
    },
    notice(options = {}) {
      return enqueue({...options, showCancel: false});
    },
  };
}
