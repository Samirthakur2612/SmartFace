const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'samirthakur829@gmail.com').toLowerCase().trim();

function isOwnerEmail(email) {
    return email && email.toLowerCase().trim() === OWNER_EMAIL;
}

function isOwner(user) {
    return user && isOwnerEmail(user.email);
}

function isApproved(user) {
    if (!user) return false;
    if (isOwner(user)) return true;
    if (user.approvalStatus === 'approved') return true;
    // Legacy accounts created before approval flow
    if (!user.approvalStatus && (user.role === 'student' || user.role === 'admin')) {
        return true;
    }
    return false;
}

function effectiveRole(user) {
    if (!user) return null;
    if (isOwner(user)) return 'admin';
    if (!isApproved(user)) return 'pending';
    if (user.role === 'pending' && user.requestedRole === 'admin') return 'pending';
    return user.role;
}

module.exports = {
    OWNER_EMAIL,
    isOwnerEmail,
    isOwner,
    isApproved,
    effectiveRole
};
