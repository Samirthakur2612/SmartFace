// Common utilities
const LOGIN_PAGES = ['/', '/index.html', '/waiting-approval', '/admin-approval', '/link-student'];

// API Configuration — change this to your deployed backend URL
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : 'https://your-backend-url.render.com';  // Replace with actual Render URL after deployment

function isLoginPage() {
    return LOGIN_PAGES.includes(window.location.pathname);
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeIn 0.3s ease-in reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

function clearUserSession() {
    sessionStorage.removeItem('loginRole');
    sessionStorage.removeItem('postLoginDone');
    sessionStorage.removeItem('authRedirectDone');
    localStorage.removeItem('studentInfo');
}

async function logout() {
    clearUserSession();
    window.__authRedirecting = false;
    if (window.Clerk) {
        try {
            await window.Clerk.signOut();
        } catch (e) {
            console.warn('Sign out:', e);
        }
    }
    window.location.replace('/');
}

function getClerkUserInfo() {
    const user = window.Clerk?.user;
    if (!user) return null;

    let email = '';
    const primary = user.primaryEmailAddress;
    if (primary) {
        email = primary.emailAddress || primary.email_address || (typeof primary === 'string' ? primary : '');
    }
    if (!email && Array.isArray(user.emailAddresses)) {
        for (const entry of user.emailAddresses) {
            const e = entry?.emailAddress || entry?.email_address || (typeof entry === 'string' ? entry : '');
            if (e) { email = e; break; }
        }
    }
    if (!email && user.email) email = user.email;

    let name = (user.fullName || user.full_name || '').trim();
    if (!name) name = [user.firstName, user.lastName, user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (!name && email) name = email.split('@')[0];
    if (!name) name = 'User';

    return { email: email.trim().toLowerCase(), name };
}

/** Wait until Clerk session can produce a JWT for API calls */
async function waitForClerkSession(maxMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        if (window.Clerk?.session) {
            try {
                const token = await window.Clerk.session.getToken();
                if (token) return true;
            } catch (_) { /* retry */ }
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

function userCanAccess(user) {
    return user && (user.canAccess === true || user.approvalStatus === 'approved' || user.isOwner);
}

function getHomePathForUser(user) {
    if (!user) return null;
    if (!userCanAccess(user)) return '/waiting-approval';
    if (user.approvalStatus === 'rejected') return '/waiting-approval';
    if (user.role === 'pending' && user.requestedRole === 'admin') return '/admin-approval';
    if (user.role === 'admin' || user.isOwner) return '/dashboard';
    if (user.role === 'student') {
        return user.studentId ? '/student-dashboard' : '/link-student';
    }
    return '/waiting-approval';
}

function navigateTo(path) {
    if (!path || window.location.pathname === path) return;
    window.__authRedirecting = true;
    sessionStorage.setItem('authRedirectDone', path);
    window.location.replace(path);
}

function setLoginRole(role) {
    sessionStorage.setItem('loginRole', role);
    const studentBtn = document.getElementById('roleStudent');
    const adminBtn = document.getElementById('roleAdmin');
    const hint = document.getElementById('roleHint');
    const label = document.getElementById('selectedRoleLabel');
    const step2 = document.getElementById('step2-section');

    if (studentBtn) studentBtn.classList.toggle('active', role === 'student');
    if (adminBtn) adminBtn.classList.toggle('active', role === 'admin');
    if (step2) step2.classList.add('visible');
    if (hint) hint.style.display = 'none';
    if (label) {
        label.textContent = role === 'admin'
            ? 'You chose Admin — sign in or register below'
            : 'You chose Student — sign in or register below';
    }
}

async function fetchCurrentUser() {
    try {
        const res = await apiFetch('/api/users/me', {}, { skipAuthRedirect: true });
        if (res.status === 404) return null;
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

async function syncUserOnLogin() {
    if (window.Clerk?.load && !window.Clerk.loaded) {
        try { await window.Clerk.load(); } catch (_) { /* ignore */ }
    }

    const hasSession = await waitForClerkSession();
    if (!hasSession) {
        showToast('Session not ready. Wait a moment and try again.', 'error');
        return null;
    }

    const info = getClerkUserInfo();
    const loginRole = sessionStorage.getItem('loginRole');
    if (!loginRole) {
        showToast('Select Student or Admin first (Step 1)', 'error');
        return null;
    }

    const payload = {
        loginRole,
        email: info?.email || '',
        name: info?.name || 'User'
    };

    const res = await apiFetch('/api/users/create-or-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, { skipAuthRedirect: true });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data.message || (res.status === 401
            ? 'Sign in expired — sign out and sign in again'
            : 'Server error — is the backend running?');
        showToast(msg, 'error');
        return null;
    }

    if (data.needsApproval) {
        showToast('Request sent to samirthakur829@gmail.com for approval', 'success');
    }

    return data.user;
}

async function ensureDbUser() {
    let user = await fetchCurrentUser();
    if (!user && window.Clerk?.user) {
        user = await syncUserOnLogin();
    }
    return user;
}

let finishLoginRunning = false;

/** Call only when user clicks Continue or after fresh Google sign-in — never auto-loop */
async function finishLoginAndRedirect() {
    if (finishLoginRunning) return null;
    if (!window.Clerk?.user) {
        showToast('Not signed in with Google', 'error');
        return null;
    }
    if (!sessionStorage.getItem('loginRole')) {
        showToast('Scroll up and click Student or Admin first', 'error');
        document.getElementById('login-flow')?.scrollIntoView({ behavior: 'smooth' });
        return null;
    }

    finishLoginRunning = true;
    try {
        const user = await syncUserOnLogin();
        if (!user) {
            const existing = await fetchCurrentUser();
            if (existing) {
                const home = getHomePathForUser(existing);
                if (home && home !== '/') navigateTo(home);
                return existing;
            }
            return null;
        }

        const home = getHomePathForUser(user);
        if (home && home !== '/') {
            navigateTo(home);
        }
        return user;
    } finally {
        finishLoginRunning = false;
    }
}

async function requirePageRole(expectedRole) {
    if (!window.Clerk?.user) {
        if (isLoginPage()) return null;
        window.Clerk?.redirectToSignIn({ returnBackUrl: window.location.href });
        return null;
    }

    const user = await ensureDbUser();
    if (!user) {
        if (!isLoginPage()) showToast('Account not found', 'error');
        return null;
    }

    if (!userCanAccess(user)) {
        if (window.location.pathname !== '/waiting-approval') {
            navigateTo('/waiting-approval');
        }
        return null;
    }

    if (expectedRole === 'admin' && user.role !== 'admin' && !user.isOwner) {
        const home = getHomePathForUser(user);
        if (home && home !== window.location.pathname) navigateTo(home);
        return null;
    }
    if (expectedRole === 'student' && user.role !== 'student') {
        const home = getHomePathForUser(user);
        if (home && home !== window.location.pathname) navigateTo(home);
        return null;
    }
    if (expectedRole === 'student' && user.role === 'student' && !user.studentId
        && !window.location.pathname.includes('link-student')) {
        navigateTo('/link-student');
        return null;
    }
    return user;
}

async function requireOwnerOrAdmin() {
    const user = await ensureDbUser();
    if (!user || !userCanAccess(user)) {
        navigateTo('/waiting-approval');
        return null;
    }
    if (!user.isOwner && user.role !== 'admin') {
        const home = getHomePathForUser(user);
        if (home) navigateTo(home);
        return null;
    }
    return user;
}

async function getAuthHeaders() {
    if (!window.Clerk?.session) return {};
    try {
        const token = await window.Clerk.session.getToken();
        if (token) return { Authorization: `Bearer ${token}` };
    } catch (e) {
        console.warn('Could not get Clerk token:', e);
    }
    return {};
}

async function apiFetch(url, options = {}, config = {}) {
    const authHeaders = await getAuthHeaders();
    const headers = { ...(options.headers || {}), ...authHeaders };

    // Prepend API_BASE_URL if url is a path (starts with /)
    const fullUrl = url.startsWith('http') ? url : API_BASE_URL + url;

    let res;
    try {
        res = await fetch(fullUrl, { ...options, headers });
    } catch (err) {
        console.error('Network error:', fullUrl, err);
        throw err;
    }

    if (res.status === 401 && !config.skipAuthRedirect) {
        if (isLoginPage()) {
            return res;
        }
        if (!window.__authLoggingOut) {
            window.__authLoggingOut = true;
            showToast('Session expired — please sign in again', 'error');
            clearUserSession();
            if (window.Clerk) {
                try {
                    await window.Clerk.signOut();
                } catch (_) { /* ignore */ }
            }
            window.location.replace('/');
        }
    }

    return res;
}

async function loadFaceAPIModels() {
    const modelPath = '/models';
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
            faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
            faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)
        ]);
        return true;
    } catch (error) {
        console.error('Error loading Face API models:', error);
        showToast('Error loading AI models.', 'error');
        return false;
    }
}
