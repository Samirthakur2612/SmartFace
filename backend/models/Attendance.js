const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    name: { type: String, required: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    status: {
        type: String,
        enum: ['present', 'absent', 'leave'],
        default: 'absent'
    },
    leaveId: { type: mongoose.Schema.Types.ObjectId, ref: 'Leave', default: null },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
    className: { type: String, default: null },
    classStartTime: { type: String, default: null }, // Store for reference
    classEndTime: { type: String, default: null },
    scanTime: { type: String, default: null }, // Format: HH:MM
    timingStatus: {
        type: String,
        enum: ['on-time', 'late', 'early-leave', 'absent-missed', 'no-class'],
        default: null
    },
    minutesLate: { type: Number, default: 0 },
    minutesEarlyLeave: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

// Compound index to ensure a student can only be marked present once per day
AttendanceSchema.index({ studentId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
