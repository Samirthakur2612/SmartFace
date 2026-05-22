const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    clerkId: { type: String, required: true, unique: true }, // Clerk user ID
    email: { type: String, required: true },
    name: { type: String, required: true },
    role: {
        type: String,
        enum: ['student', 'admin', 'pending'],
        default: 'pending'
    },
    requestedRole: {
        type: String,
        enum: ['student', 'admin'],
        default: 'student'
    },
    approvalStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    approvalToken: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedDate: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    studentId: { type: String, default: null }, // Linked student record for student role
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
