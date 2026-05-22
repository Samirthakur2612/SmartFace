const User = require('../models/User');
const { getClerkAuth } = require('./clerkAuth');
const { isApproved } = require('../utils/accessControl');

async function getAuthUser(req) {
    const auth = getClerkAuth(req);
    if (!auth?.userId) return null;
    return User.findOne({ clerkId: auth.userId });
}

function requireRole(...roles) {
    return async (req, res, next) => {
        try {
            const user = await getAuthUser(req);
            if (!user) {
                return res.status(404).json({ message: 'User not found. Please sign in again.' });
            }
            if (!roles.includes(user.role)) {
                return res.status(403).json({ message: 'Access denied for your role.' });
            }
            req.dbUser = user;
            next();
        } catch (err) {
            console.error('[Roles] Error:', err);
            res.status(500).json({ message: 'Server error' });
        }
    };
}

const requireAdmin = requireRole('admin');
const requireStudent = requireRole('student');

module.exports = { getAuthUser, requireRole, requireAdmin, requireStudent, getClerkAuth, isApproved };
