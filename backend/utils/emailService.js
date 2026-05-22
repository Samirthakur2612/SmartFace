const crypto = require('crypto');
const { OWNER_EMAIL } = require('./accessControl');

let transporter = null;

async function getTransporter() {
    if (transporter) return transporter;
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;

    try {
        const nodemailer = require('nodemailer');
        transporter = nodemailer.createTransport({
            host,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user, pass }
        });
        return transporter;
    } catch (err) {
        console.warn('[Email] nodemailer not available:', err.message);
        return null;
    }
}

function getAppBaseUrl() {
    return (process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function generateApprovalToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function sendAccessRequestEmail(user) {
    const baseUrl = getAppBaseUrl();
    const approveUrl = `${baseUrl}/api/users/approve-access/${user.approvalToken}`;
    const rejectUrl = `${baseUrl}/api/users/reject-access/${user.approvalToken}`;
    const roleLabel = user.requestedRole === 'admin' ? 'Admin' : 'Student';

    const subject = `[SmartFace] New ${roleLabel} login request — ${user.name}`;
    const text = `
New access request for SmartFace

Name: ${user.name}
Email: ${user.email}
Requested role: ${roleLabel}
Time: ${new Date().toLocaleString()}

Approve (grant login access):
${approveUrl}

Reject:
${rejectUrl}

You can also approve requests in the app: ${baseUrl}/access-requests
`.trim();

    const html = `
<h2>New SmartFace login request</h2>
<p><strong>Name:</strong> ${user.name}<br>
<strong>Email:</strong> ${user.email}<br>
<strong>Role:</strong> ${roleLabel}</p>
<p>
  <a href="${approveUrl}" style="background:#10B981;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;margin-right:8px;">Approve</a>
  <a href="${rejectUrl}" style="background:#EF4444;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;">Reject</a>
</p>
<p>Or open <a href="${baseUrl}/access-requests">Access Requests</a> in the admin panel.</p>
`.trim();

    const mail = await getTransporter();
    if (!mail) {
        console.log('\n========== ACCESS REQUEST (configure SMTP to email) ==========');
        console.log(`To: ${OWNER_EMAIL}`);
        console.log(`User: ${user.email} wants ${roleLabel}`);
        console.log(`Approve: ${approveUrl}`);
        console.log(`Reject: ${rejectUrl}`);
        console.log('============================================================\n');
        return { sent: false, logged: true };
    }

    await mail.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: OWNER_EMAIL,
        subject,
        text,
        html
    });
    console.log(`[Email] Access request sent to ${OWNER_EMAIL} for ${user.email}`);
    return { sent: true };
}

async function sendApprovedEmail(user) {
    const mail = await getTransporter();
    if (!mail) return;
    await mail.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: user.email,
        subject: '[SmartFace] Your account was approved',
        text: `Hi ${user.name},\n\nYour SmartFace account has been approved. You can sign in now at ${getAppBaseUrl()}\n`,
        html: `<p>Hi ${user.name},</p><p>Your SmartFace account has been <strong>approved</strong>. <a href="${getAppBaseUrl()}">Sign in now</a>.</p>`
    });
}

module.exports = {
    generateApprovalToken,
    sendAccessRequestEmail,
    sendApprovedEmail,
    getAppBaseUrl
};
