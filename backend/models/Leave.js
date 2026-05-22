const mongoose = require('mongoose');

const LeaveSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    name: { type: String, required: true },
    startDate: { type: String, required: true }, // Format: YYYY-MM-DD
    endDate: { type: String, required: true },   // Format: YYYY-MM-DD
    reason: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected'], 
        default: 'pending' 
    },
    leaveType: {
        type: String,
        enum: ['sick', 'casual', 'familyEmergency', 'other'],
        default: 'casual'
    },
    appliedDate: { type: Date, default: Date.now },
    reviewedDate: { type: Date, default: null },
    reviewedBy: { type: String, default: null }, // Admin user ID
    reviewComments: { type: String, default: null },
    numberOfDays: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Leave', LeaveSchema);
