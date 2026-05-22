/**
 * Clerk Express v2 attaches req.auth as a function: req.auth()
 * Use this helper everywhere instead of req.auth.userId
 */
function getClerkAuth(req) {
    if (!req.auth) return null;
    try {
        if (typeof req.auth === 'function') {
            return req.auth({ treatPendingAsSignedOut: false });
        }
        return req.auth;
    } catch (err) {
        console.warn('[ClerkAuth] getAuth failed:', err.message);
        return null;
    }
}

module.exports = { getClerkAuth };
