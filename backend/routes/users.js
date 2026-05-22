const express = require('express');
const User = require('../models/User');
const Student = require('../models/Student');
const auth = require('../middleware/auth');
const { getAuthUser } = require('../middleware/roles');
const { getClerkAuth } = require('../middleware/clerkAuth');
const { isOwnerEmail, isOwner, isApproved } = require('../utils/accessControl');
const {
    generateApprovalToken,
    sendAccessRequestEmail,
    sendApprovedEmail,
    getAppBaseUrl
} = require('../utils/emailService');

const router = express.Router();

function serializeUser(user) {
    const u = user.toObject ? user.toObject() : { ...user };
    u.isOwner = isOwner(user);
    u.canAccess = isApproved(user);
    return u;
}

async function tryLinkStudentByEmail(user) {
    if (user.role !== 'student' || user.studentId) return user;
    const student = await Student.findOne({ email: user.email.toLowerCase() });
    if (student) {
        user.studentId = student.studentId;
        await user.save();
        console.log(`[Users] Auto-linked ${user.email} to student ${student.studentId}`);
    }
    return user;
}

async function approveUser(user, approvedBy = 'owner') {
    user.approvalStatus = 'approved';
    user.approvalToken = null;
    user.approvedBy = approvedBy;
    user.approvedDate = new Date();
    user.role = user.requestedRole === 'admin' ? 'admin' : 'student';
    user.rejectionReason = null;
    await user.save();
    if (user.role === 'student') {
        await tryLinkStudentByEmail(user);
    }
    try {
        await sendApprovedEmail(user);
    } catch (e) {
        console.warn('[Email] Could not notify user:', e.message);
    }
    return user;
}

function profileFromAuth(req) {
    const auth = getClerkAuth(req);
    const claims = auth?.sessionClaims || {};
    const body = req.body || {};
    let email = (
        body.email ||
        claims.email ||
        claims.primary_email_address ||
        claims.primaryEmailAddress ||
        (Array.isArray(claims.email_addresses) && claims.email_addresses[0]) ||
        ''
    ).toString().toLowerCase().trim();

    if (!email && claims && typeof claims === 'object') {
        for (const val of Object.values(claims)) {
            if (typeof val === 'string' && val.includes('@')) {
                email = val.toLowerCase().trim();
                break;
            }
        }
    }

    let name = (body.name || claims.name || claims.full_name || '').toString().trim();
    if (!name) {
        const parts = [claims.first_name, claims.last_name, claims.given_name, claims.family_name].filter(Boolean);
        name = parts.join(' ').trim();
    }
    if (!name && email) name = email.split('@')[0];
    if (!name) name = 'User';

    return {
        clerkId: auth?.userId,
        email,
        name,
        loginRole: body.loginRole
    };
}

// Create or update user (called after Clerk sign-in)
router.post('/create-or-update', auth, async (req, res) => {
    try {
        const { clerkId, email, name, loginRole } = profileFromAuth(req);

        if (!clerkId) {
            console.error('[Users] create-or-update: no userId in Clerk auth', {
                hasAuthFn: typeof req.auth === 'function',
                bodyEmail: !!req.body?.email
            });
            return res.status(401).json({ message: 'Not signed in. Sign in with Google again.' });
        }
        if (!email) {
            return res.status(400).json({
                message: 'Could not read your email. Add email to your Google account or try again.'
            });
        }

        const normalizedEmail = email;
        const requestedRole = loginRole === 'admin' ? 'admin' : 'student';
        let user = await User.findOne({ clerkId });
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            const ownerAccount = isOwnerEmail(normalizedEmail);

            user = new User({
                clerkId,
                email: normalizedEmail,
                name,
                requestedRole,
                role: ownerAccount ? 'admin' : (requestedRole === 'admin' ? 'pending' : 'student'),
                approvalStatus: ownerAccount ? 'approved' : 'pending',
                approvalToken: ownerAccount ? null : generateApprovalToken(),
                lastLogin: new Date()
            });
            await user.save();

            if (!ownerAccount) {
                await sendAccessRequestEmail(user);
            } else if (user.role === 'student') {
                user = await tryLinkStudentByEmail(user);
            }

            console.log(`[Users] New user: ${normalizedEmail} (${requestedRole}, ${user.approvalStatus})`);
            return res.status(201).json({
                message: ownerAccount
                    ? 'Owner account ready'
                    : 'Request sent. Wait for approval from samirthakur829@gmail.com',
                user: serializeUser(user),
                isNewUser: true,
                needsApproval: !ownerAccount
            });
        }

        user.email = normalizedEmail;
        user.name = name;
        user.lastLogin = new Date();

        if (isOwnerEmail(normalizedEmail)) {
            user.approvalStatus = 'approved';
            user.role = 'admin';
            user.requestedRole = 'admin';
        } else if (user.approvalStatus === 'pending') {
            if (user.requestedRole !== requestedRole) {
                user.requestedRole = requestedRole;
                user.role = requestedRole === 'admin' ? 'pending' : 'student';
                user.approvalToken = generateApprovalToken();
                await sendAccessRequestEmail(user);
            }
        }

        await user.save();
        if (user.role === 'student' && user.approvalStatus === 'approved') {
            user = await tryLinkStudentByEmail(user);
        }

        return res.json({
            message: isApproved(user) ? 'Welcome back' : 'Waiting for approval',
            user: serializeUser(user),
            isNewUser: false,
            needsApproval: !isApproved(user)
        });
    } catch (err) {
        console.error('[Users] Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Email link: approve access (no login required)
router.get('/approve-access/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            approvalToken: req.params.token,
            approvalStatus: 'pending'
        });
        if (!user) {
            return res.status(404).send(resultPage('Invalid or expired approval link', false));
        }
        await approveUser(user, 'email-link');
        res.send(resultPage(`${user.name} (${user.email}) approved as ${user.requestedRole}. They can sign in now.`, true));
    } catch (err) {
        console.error('[Users] Approve error:', err);
        res.status(500).send(resultPage('Server error', false));
    }
});

router.get('/reject-access/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            approvalToken: req.params.token,
            approvalStatus: 'pending'
        });
        if (!user) {
            return res.status(404).send(resultPage('Invalid or expired link', false));
        }
        user.approvalStatus = 'rejected';
        user.approvalToken = null;
        user.rejectionReason = 'Rejected via email';
        await user.save();
        res.send(resultPage(`Access denied for ${user.email}.`, true));
    } catch (err) {
        res.status(500).send(resultPage('Server error', false));
    }
});

function resultPage(message, success) {
    const color = success ? '#10B981' : '#EF4444';
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;">
    <div style="max-width:480px;padding:2rem;background:#1a1a2e;border-radius:12px;text-align:center;">
    <h2 style="color:${color}">SmartFace</h2><p>${message}</p>
    <a href="${getAppBaseUrl()}/access-requests" style="color:#3B82F6;">Open Access Requests</a> · 
    <a href="${getAppBaseUrl()}/" style="color:#3B82F6;">Login</a></div></body></html>`;
}

router.post('/link-student', auth, async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) {
            return res.status(400).json({ message: 'Student ID is required' });
        }

        const user = await getAuthUser(req);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (!isApproved(user)) {
            return res.status(403).json({ message: 'Your account is not approved yet' });
        }
        if (user.role !== 'student') {
            return res.status(403).json({ message: 'Only students can link a student ID' });
        }

        const student = await Student.findOne({ studentId: studentId.trim() });
        if (!student) {
            return res.status(404).json({ message: 'Student ID not found. Ask admin to register you first.' });
        }

        const alreadyLinked = await User.findOne({
            studentId: student.studentId,
            clerkId: { $ne: user.clerkId }
        });
        if (alreadyLinked) {
            return res.status(409).json({ message: 'This student ID is already linked to another account' });
        }

        if (student.email && student.email.toLowerCase() !== user.email.toLowerCase()) {
            return res.status(403).json({
                message: 'This Student ID is registered to a different email. Contact admin.'
            });
        }

        if (!student.email) {
            student.email = user.email.toLowerCase();
            await student.save();
        }

        user.studentId = student.studentId;
        await user.save();

        res.json({
            message: 'Account linked successfully',
            user: serializeUser(user),
            student: { studentId: student.studentId, name: student.name }
        });
    } catch (err) {
        console.error('[Users] Link error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/me', auth, async (req, res) => {
    try {
        const authData = getClerkAuth(req);
        const user = await User.findOne({ clerkId: authData?.userId });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(serializeUser(user));
    } catch (err) {
        console.error('[Users] Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Pending access requests (owner / admin only)
router.get('/access-requests/pending', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || (!isOwner(requester) && requester.role !== 'admin')) {
            return res.status(403).json({ message: 'Only the app owner or admins can view requests' });
        }
        const pending = await User.find({ approvalStatus: 'pending' }).sort({ createdAt: -1 });
        res.json(pending.map(serializeUser));
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/access-requests/approve/:clerkId', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || (!isOwner(requester) && requester.role !== 'admin')) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        const user = await User.findOne({ clerkId: req.params.clerkId, approvalStatus: 'pending' });
        if (!user) {
            return res.status(404).json({ message: 'Request not found' });
        }
        await approveUser(user, requester.email);
        res.json({ message: 'Approved', user: serializeUser(user) });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/access-requests/reject/:clerkId', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || (!isOwner(requester) && requester.role !== 'admin')) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        const user = await User.findOneAndUpdate(
            { clerkId: req.params.clerkId, approvalStatus: 'pending' },
            {
                approvalStatus: 'rejected',
                approvalToken: null,
                rejectionReason: req.body.reason || 'Rejected by admin'
            },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: 'Request not found' });
        res.json({ message: 'Rejected', user: serializeUser(user) });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/select-role', auth, async (req, res) => {
    try {
        const { role } = req.body;
        if (!['student', 'admin'].includes(role)) {
            return res.status(400).json({ message: 'Invalid role' });
        }
        const authData = getClerkAuth(req);
        const user = await User.findOne({ clerkId: authData?.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.requestedRole = role;
        if (user.approvalStatus !== 'approved') {
            user.role = role === 'admin' ? 'pending' : 'student';
            await user.save();
            return res.json({ message: 'Role saved. Waiting for approval.', user: serializeUser(user) });
        }
        user.role = role === 'student' ? 'student' : 'admin';
        await user.save();
        res.json({ message: 'Role updated', user: serializeUser(user) });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/admin/pending', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || requester.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const pendingRequests = await User.find({
            role: 'pending',
            requestedRole: 'admin',
            approvalStatus: 'approved'
        }).sort({ createdAt: -1 });
        res.json(pendingRequests);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/admin/approve/:userId', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || requester.role !== 'admin') {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        const user = await User.findOneAndUpdate(
            { clerkId: req.params.userId, role: 'pending', requestedRole: 'admin' },
            { role: 'admin', approvedBy: getClerkAuth(req)?.userId, approvedDate: new Date() },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'Admin role granted', user: serializeUser(user) });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/admin/reject/:userId', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || requester.role !== 'admin') {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        const user = await User.findOneAndUpdate(
            { clerkId: req.params.userId, role: 'pending', requestedRole: 'admin' },
            {
                role: 'student',
                rejectionReason: req.body.reason || 'Rejected',
                requestedRole: 'student'
            },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'Rejected', user: serializeUser(user) });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/admin/all', auth, async (req, res) => {
    try {
        const requester = await getAuthUser(req);
        if (!requester || requester.role !== 'admin') {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        const users = await User.find({}).sort({ createdAt: -1 });
        res.json(users.map(serializeUser));
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
