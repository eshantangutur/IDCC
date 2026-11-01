import {
  api,
  escapeHtml,
  formatDate,
  icons,
  setButtonLoading,
  toast,
  openModal,
  confirmDialog,
} from './core.js';
import { mountShell } from './shell.js';

const shell = await mountShell({
  page: 'settings',
  title: 'Settings',
  subtitle: 'Account, security and data controls',
});

if (shell) {
  const { user, meta } = shell;

  // ---------- profile ----------
  document.getElementById('profileEmail').textContent = user.email;
  document.getElementById('profileName').textContent = user.displayName || 'Not set';
  document.getElementById('profileCreated').textContent = formatDate(user.createdAt, { time: false });
  document.getElementById('profileId').textContent = `#${user.id}`;

  document.getElementById('signOutButton').addEventListener('click', async () => {
    try {
      await api.post('/api/auth/logout');
      window.location.replace('/index.html');
    } catch (error) {
      toast(error.message || 'Could not sign out.', 'error');
    }
  });

  // ---------- AI configuration ----------
  const isDemo = meta.ai.mode === 'demo';
  document.getElementById('aiModeChip').className = `chip ${isDemo ? 'chip-demo' : 'chip-live'}`;
  document.getElementById('aiModeChip').textContent = isDemo ? 'Demo mode' : 'Live AI';
  document.getElementById('aiMode').textContent = isDemo ? 'Local structural heuristics' : 'Language model';
  document.getElementById('aiProvider').textContent = meta.ai.provider || '—';
  document.getElementById('aiModel').textContent = meta.ai.model || 'Not applicable in demo mode';
  document.getElementById('aiLimit').textContent = `${Number(meta.limits.maxSpeechChars).toLocaleString()} characters per speech`;
  const reasonBox = document.getElementById('aiReason');
  if (meta.ai.reason) {
    reasonBox.textContent = meta.ai.reason;
  } else {
    reasonBox.textContent = 'Live analysis is configured. Speech text is sent to the configured provider for analysis.';
    reasonBox.style.display = 'block';
  }

  // ---------- password ----------
  const passwordForm = document.getElementById('passwordForm');
  const passwordButton = document.getElementById('passwordButton');
  const feedback = document.getElementById('passwordFeedback');

  function setFeedback(message, type = 'error') {
    feedback.className = `banner banner--${type}`;
    feedback.innerHTML = `${type === 'error' ? icons.alert : icons.check}<span>${escapeHtml(message)}</span>`;
    feedback.hidden = false;
  }

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.hidden = true;
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword) return setFeedback('Enter your current password.');
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return setFeedback('The new password must be at least 10 characters and include a letter and a number.');
    }
    if (newPassword !== confirmPassword) return setFeedback('The new passwords do not match.');
    if (newPassword === currentPassword) return setFeedback('Choose a new password that differs from the current one.');

    setButtonLoading(passwordButton, true, 'Updating…');
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      passwordForm.reset();
      setFeedback('Password updated. Other sessions have been signed out.', 'success');
      toast('Password updated.', 'success');
    } catch (error) {
      setFeedback(error.message || 'Could not update the password.');
    } finally {
      setButtonLoading(passwordButton, false);
    }
  });

  // ---------- delete account ----------
  document.getElementById('deleteAccountButton').addEventListener('click', () => {
    const confirmedFirst = confirmDialog({
      title: 'Delete your account?',
      message: 'This permanently deletes every case, speech, version, analysis, finding and argument map in your account. It cannot be undone.',
      confirmLabel: 'Continue',
      danger: true,
    }).then((accepted) => {
      if (!accepted) return;
      const dialog = openModal({
        title: 'Confirm account deletion',
        body: `<div class="stack-sm">
          <div class="banner banner--error">${icons.alert}<div><strong>This cannot be undone.</strong> There is no recovery, export or grace period.</div></div>
          <div class="field">
            <label for="deletePassword">Enter your password to confirm</label>
            <input class="input" id="deletePassword" type="password" autocomplete="current-password" maxlength="200">
          </div>
          <div class="banner banner--error" id="deleteError" hidden><span></span></div>
        </div>`,
        footer: `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
          <button type="button" class="btn btn-danger" data-confirm-delete>Delete everything</button>`,
      });

      const passwordInput = dialog.body.querySelector('#deletePassword');
      const errorBox = dialog.body.querySelector('#deleteError');
      const deleteButton = dialog.footer.querySelector('[data-confirm-delete]');
      dialog.footer.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

      deleteButton.addEventListener('click', async () => {
        const password = passwordInput.value;
        if (!password) {
          errorBox.querySelector('span').textContent = 'Enter your password.';
          errorBox.hidden = false;
          return;
        }
        setButtonLoading(deleteButton, true, 'Deleting…');
        try {
          await api.delete('/api/auth/account', { password });
          dialog.close();
          window.location.replace('/index.html');
        } catch (error) {
          setButtonLoading(deleteButton, false);
          errorBox.querySelector('span').textContent = error.message || 'Could not delete the account.';
          errorBox.hidden = false;
        }
      });
    });
    return confirmedFirst;
  });
}
