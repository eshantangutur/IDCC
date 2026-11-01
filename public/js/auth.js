import { api, setButtonLoading, toast } from './core.js';

const form = document.getElementById('loginForm') || document.getElementById('registerForm');
const errorBox = document.getElementById('formError');
const errorText = errorBox?.querySelector('[data-error-text]');
const submitButton = document.getElementById('submitButton');

function safeNext(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return '/dashboard.html';
}

const nextTarget = safeNext(new URLSearchParams(window.location.search).get('next'));

if (nextTarget !== '/dashboard.html') {
  const registerLink = document.querySelector('[data-register-link]');
  const loginLink = document.querySelector('[data-login-link]');
  if (registerLink) registerLink.href = `/register.html?next=${encodeURIComponent(nextTarget)}`;
  if (loginLink) loginLink.href = `/login.html?next=${encodeURIComponent(nextTarget)}`;
}

function showError(message) {
  if (!errorBox || !errorText) return;
  errorText.textContent = message;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearError() {
  if (errorBox) errorBox.hidden = true;
}

function markInvalid(input, invalid) {
  input?.classList.toggle('input-error', Boolean(invalid));
  if (input) input.setAttribute('aria-invalid', String(Boolean(invalid)));
}

async function redirectIfSignedIn() {
  try {
    const session = await api.get('/api/auth/me', { timeout: 15000 });
    if (session?.user) {
      window.location.replace(nextTarget);
      return true;
    }
  } catch {
    /* expected: no active session */
  }
  return false;
}

(async () => {
  const alreadyIn = await redirectIfSignedIn();
  if (alreadyIn || !form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    if (document.body.dataset.page === 'login') {
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!email || !password) {
        markInvalid(form.email, !email);
        markInvalid(form.password, !password);
        return showError('Enter your email address and password.');
      }
      setButtonLoading(submitButton, true, 'Signing in…');
      try {
        await api.post('/api/auth/login', { email, password });
        toast('Signed in. Opening your workspace…', 'success', { duration: 2000 });
        window.location.replace(nextTarget);
      } catch (error) {
        setButtonLoading(submitButton, false);
        showError(error.message || 'Could not sign in.');
        markInvalid(form.password, true);
      }
      return;
    }

    const displayName = form.displayName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const agree = form.agree.checked;

    let invalid = false;
    markInvalid(form.email, !email);
    markInvalid(form.password, false);
    markInvalid(form.confirmPassword, false);
    if (!email) invalid = true;
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      markInvalid(form.password, true);
      invalid = true;
    }
    if (password !== confirmPassword) {
      markInvalid(form.confirmPassword, true);
      invalid = true;
    }
    if (!agree) invalid = true;
    if (invalid) {
      return showError(
        password !== confirmPassword
          ? 'Passwords do not match.'
          : !agree
            ? 'Please accept the terms and privacy policy to continue.'
            : 'Use a password with at least 10 characters, including a letter and a number.'
      );
    }

    setButtonLoading(submitButton, true, 'Creating account…');
    try {
      await api.post('/api/auth/register', { email, password, displayName: displayName || null });
      toast('Account created. Welcome to Argument Forensics.', 'success', { duration: 2500 });
      window.location.replace(nextTarget);
    } catch (error) {
      setButtonLoading(submitButton, false);
      showError(error.message || 'Could not create your account.');
      if (error.status === 409) markInvalid(form.email, true);
    }
  });
})();
